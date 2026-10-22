import Module from 'node:module'
import { l2normalize } from './core'

type TransformersModule = typeof import('@huggingface/transformers')

/**
 * Loads transformers.js through CommonJS so that its optional `sharp` dependency (image processing, unused by
 * Opal) can be replaced by a stub when the native binary is missing for this platform/CPU. Text embeddings
 * only need onnxruntime-node.
 */
export function loadTransformers(): TransformersModule {
  const M = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown }
  const original = M._load
  const sharpStub = Object.assign(
    () => {
      throw new Error('Image processing is not available in this build')
    },
    { cache: () => undefined, concurrency: () => 1, simd: () => false }
  )
  M._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === 'sharp') {
      try {
        return original.call(this, request, parent, isMain)
      } catch {
        return sharpStub
      }
    }
    return original.call(this, request, parent, isMain)
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@huggingface/transformers') as TransformersModule
  } finally {
    M._load = original
  }
}

export interface Embedder {
  readonly id: string
  readonly dims: number
  /** Cosine threshold below which semantic hits are dropped. */
  readonly minSimilarity: number
  /** Keep hits within this distance of the best hit. */
  readonly margin: number
  embedPassages(texts: string[]): Promise<Float32Array[]>
  embedQuery(text: string): Promise<Float32Array>
}

/**
 * Local multilingual E5 model, run with
 * transformers.js + ONNX Runtime. Downloaded once (~120 MB, quantised) into `cacheDir`.
 */
export class TransformersEmbedder implements Embedder {
  readonly id = 'Xenova/multilingual-e5-small'
  readonly dims = 384
  readonly minSimilarity = 0.8
  readonly margin = 0.04
  private extractor: Promise<(texts: string[], opts: Record<string, unknown>) => Promise<{ data: Float32Array; dims: number[] }>> | null = null

  constructor(
    private readonly cacheDir: string,
    private readonly onState: (state: 'loading' | 'ready' | 'error', error?: string) => void = () => {}
  ) {}

  private load() {
    if (!this.extractor) {
      this.onState('loading')
      this.extractor = (async () => {
        const tf = loadTransformers()
        tf.env.cacheDir = this.cacheDir
        tf.env.allowLocalModels = true
        const pipe = await tf.pipeline('feature-extraction', this.id, { dtype: 'q8' })
        this.onState('ready')
        return pipe as unknown as (texts: string[], opts: Record<string, unknown>) => Promise<{ data: Float32Array; dims: number[] }>
      })().catch((e: unknown) => {
        this.extractor = null
        this.onState('error', (e as Error).message)
        throw e
      })
    }
    return this.extractor
  }

  private async embed(texts: string[]): Promise<Float32Array[]> {
    const fe = await this.load()
    const out = await fe(texts, { pooling: 'mean', normalize: true })
    const [n, d] = out.dims
    const vecs: Float32Array[] = []
    for (let i = 0; i < n; i++) vecs.push(l2normalize(out.data.subarray(i * d, (i + 1) * d)))
    return vecs
  }

  embedPassages(texts: string[]): Promise<Float32Array[]> {
    return this.embed(texts.map((t) => `passage: ${t}`))
  }

  async embedQuery(text: string): Promise<Float32Array> {
    return (await this.embed([`query: ${text}`]))[0]
  }
}

/**
 * Deterministic hashing embedder (bag of words + character trigrams). Used by tests
 * and as an instant offline fallback; it captures lexical rather than semantic similarity.
 */
export class HashEmbedder implements Embedder {
  readonly id = 'hash-trigram-256'
  readonly dims = 256
  readonly minSimilarity = 0.05
  readonly margin = 1
  private vec(text: string): Float32Array {
    const v = new Float32Array(this.dims)
    const words = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
    const add = (s: string, w: number): void => {
      let h = 2166136261
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
      v[(h >>> 0) % this.dims] += w
    }
    for (const word of words) {
      add(word, 1)
      const p = `#${word}#`
      for (let i = 0; i + 3 <= p.length; i++) add(p.slice(i, i + 3), 0.3)
    }
    return l2normalize(v)
  }
  async embedPassages(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.vec(t))
  }
  async embedQuery(text: string): Promise<Float32Array> {
    return this.vec(text)
  }
}

export interface Reranker {
  readonly id: string
  /** Relevance logits of each passage for the query (higher = more relevant; ~0 is borderline). */
  score(query: string, passages: string[]): Promise<number[]>
}

/**
 * Multilingual cross-encoder (MiniLM trained on mMARCO, 14 languages incl. Italian and English). It reads the
 * query and a passage together, so it judges relevance far better than vector similarity alone, and its
 * logits give a usable "nothing relevant here" signal. About 115 MB (int8), downloaded on first use.
 */
export class TransformersReranker implements Reranker {
  readonly id = 'cross-encoder/mmarco-mMiniLMv2-L12-H384-v1'
  private loaded: Promise<{ tok: (a: string[], o: Record<string, unknown>) => unknown; model: (x: unknown) => Promise<{ logits: { data: Float32Array } }> }> | null = null

  constructor(
    private readonly cacheDir: string,
    private readonly onState: (state: 'loading' | 'ready' | 'error', error?: string) => void = () => {}
  ) {}

  load() {
    if (!this.loaded) {
      this.onState('loading')
      this.loaded = (async () => {
        const tf = loadTransformers()
        tf.env.cacheDir = this.cacheDir
        tf.env.allowLocalModels = true
        // The repository ships hardware-specific int8 builds instead of the usual model_quantized.onnx.
        const file = process.arch === 'arm64' ? 'model_qint8_arm64' : 'model_quint8_avx2'
        const [tok, model] = await Promise.all([
          tf.AutoTokenizer.from_pretrained(this.id),
          tf.AutoModelForSequenceClassification.from_pretrained(this.id, { dtype: 'fp32', model_file_name: file } as Record<string, unknown>)
        ])
        this.onState('ready')
        return { tok: tok as unknown as (a: string[], o: Record<string, unknown>) => unknown, model: model as unknown as (x: unknown) => Promise<{ logits: { data: Float32Array } }> }
      })().catch((e: unknown) => {
        this.loaded = null
        this.onState('error', (e as Error).message)
        throw e
      })
    }
    return this.loaded
  }

  async score(query: string, passages: string[]): Promise<number[]> {
    const { tok, model } = await this.load()
    const out: number[] = []
    for (let i = 0; i < passages.length; i += 16) {
      const batch = passages.slice(i, i + 16)
      const enc = tok(batch.map(() => query), { text_pair: batch, padding: true, truncation: true, max_length: 320 })
      const { logits } = await model(enc)
      out.push(...Array.from(logits.data))
    }
    return out
  }
}

/** Test stand-in: logit grows with the share of query words found in the passage. */
export class OverlapReranker implements Reranker {
  readonly id = 'overlap'
  async score(query: string, passages: string[]): Promise<number[]> {
    const fold = (s: string): string[] => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2)
    const q = new Set(fold(query))
    return passages.map((p) => {
      const words = new Set(fold(p))
      let hit = 0
      for (const w of q) if (words.has(w)) hit++
      return q.size ? (hit / q.size) * 8 - 4 : -4
    })
  }
}
