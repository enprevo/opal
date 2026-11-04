import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, promises as fsp } from 'node:fs'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import * as path from 'node:path'
import type { ModelState, SemanticHit, SemanticMatch, SemanticSearchOptions, SemanticSearchResult, SemanticStatus } from '../../shared/types'
import { Bm25, chunkText, dot, focusWindow, isProse, makeSnippet, normalizeWhitespace, pageAt, queryTerms, rrf, sigmoid, similarityCutoff, titleFor } from './core'
import type { Embedder, Reranker } from './embedders'
import { extractText, isIndexable } from './extract'

interface ChunkRecord {
  /** Text (trimmed to 1200 characters). */
  t: string
  /** Character offset in the extracted text. */
  o: number
  /** Page (PDF). */
  p?: number
  /** 0 when the chunk is not prose and has no meaningful vector (tables, numbers, code). */
  e?: 0
}

interface DocRecord {
  path: string
  name: string
  mtime: number
  size: number
  /** Content hash, used to fold duplicate files into one result and to reuse their vectors. */
  hash: string
  chunks: ChunkRecord[]
  /** Index of the first vector of this document in the vector store. */
  v: number
}

/** index.json: header only. Documents are stored one per line in docs.ndjson (streamed: no giant strings). */
interface IndexFile {
  version: 3
  embedder: string
  dims: number
  folders: string[]
  options: SemanticOptions
}

export interface SemanticOptions {
  includeCode: boolean
  rerank: boolean
}

const SKIP_DIRS = new Set([
  'node_modules', 'bower_components', '.git', '.svn', '.hg', '__pycache__', '.venv', 'venv', 'env', '.tox', '.mypy_cache', '.pytest_cache',
  'dist', 'build', 'out', 'bin', 'obj', 'target', 'Debug', 'Release', 'x64', 'x86', '.vs', '.idea', '.vscode', '.gradle', '.next', '.nuxt',
  'coverage', 'Pods', 'DerivedData', 'CMakeFiles', '.pio', '.metadata', '.settings', 'site-packages', 'vendor', 'packages', '__MACOSX',
  '.cache', '.Trash', '$RECYCLE.BIN', 'System Volume Information', 'AppData', 'Library'
])
const MAX_FILES = 50_000
const MAX_CHUNKS = 64
/**
 * Passages embedded per document. The model runs at roughly 40 passages/s on a laptop CPU, so long manuals get
 * their opening plus an even sample of the rest; every passage stays searchable by keyword.
 */
const EMBED_BUDGET = 24
const EMBED_BATCH = 16
/**
 * Precise ranking: cross-encoder logit + COS_WEIGHT * (cosine - COS_PIVOT) + NAME_BONUS when the file name holds
 * every query word. Results need RANK_FLOOR and must be within RANK_GAP of the best one. Tuned on the
 * tests/quality benchmark (mixed Italian/English documents inside ~450 real unrelated files).
 */
const COS_WEIGHT = 10
const COS_PIVOT = 0.82
const NAME_BONUS = 2
const RANK_FLOOR = -4
const RANK_GAP = 3
/** Documents sent to the cross-encoder, by meaning and by keywords. */
const RERANK_SEMANTIC = 12
const RERANK_KEYWORD = 6
/** Passage length given to the cross-encoder (~20 ms per pair on a laptop CPU). */
const RERANK_CHARS = 600
/** How long a search waits for a model that is still loading before answering without it. */
const MODEL_WAIT_MS = 4000

export class SemanticIndex {
  private docs = new Map<string, DocRecord>()
  private ids = new Map<string, number>()
  private byId: DocRecord[] = []
  private hashes = new Map<string, string>()
  private bm25 = new Bm25()
  private vectors = new Float32Array(0)
  private vectorCount = 0
  private folders: string[] = []
  private options: SemanticOptions = { includeCode: false, rerank: true }
  private queue: string[] = []
  private running = false
  private cancelled = false
  private truncated = false
  private done = 0
  private startedAt: number | undefined
  private currentFile: string | undefined
  private modelState: ModelState = 'idle'
  private modelError: string | undefined
  private rerankState: ModelState = 'idle'
  private rerankError: string | undefined
  private modelReady: Promise<void> | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private emitTimer: NodeJS.Timeout | null = null
  private loaded: Promise<void> | null = null
  /** Searches in progress: indexing yields the CPU to them. */
  private searching = 0
  private cache: { key: string; at: number; result: SemanticSearchResult } | null = null
  /** Per-candidate ranking signals of the last search run with `explain` (used to tune the ranking). */
  lastExplain: { path: string; cos: number; centred: number; semRank: number; best: number; logit: number; bm25: number; coverage: number; name: number }[] = []

  constructor(
    private readonly dir: string,
    private readonly embedder: Embedder,
    private readonly onStatus: (s: SemanticStatus) => void = () => {},
    private readonly reranker: Reranker | null = null
  ) {}

  setModelState(state: ModelState, error?: string): void {
    this.modelState = state
    this.modelError = error
    this.emit()
  }

  setRerankState(state: ModelState, error?: string): void {
    this.rerankState = state
    this.rerankError = error
    this.emit()
  }

  status(): SemanticStatus {
    let chunks = 0
    for (const d of this.docs.values()) chunks += d.chunks.length
    return {
      ready: this.docs.size > 0,
      model: this.embedder.id,
      modelState: this.modelState,
      modelError: this.modelError,
      rerankState: this.options.rerank && this.reranker ? this.rerankState : 'idle',
      rerankError: this.rerankError,
      indexing: this.running,
      queued: this.queue.length,
      done: this.done,
      total: this.done + this.queue.length + (this.currentFile ? 1 : 0),
      startedAt: this.startedAt,
      indexedFiles: this.docs.size,
      indexedChunks: chunks,
      currentFile: this.currentFile,
      folders: [...this.folders],
      truncated: this.truncated
    }
  }

  /** Status updates are coalesced: indexing thousands of files must not flood the UI. */
  private emit(): void {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.onStatus(this.status())
    }, 120)
  }

  // ---------------------------------------------------------------- storage

  load(): Promise<void> {
    if (!this.loaded) this.loaded = this.doLoad()
    return this.loaded
  }

  private async doLoad(): Promise<void> {
    // Temporary files left by an interrupted save.
    for (const f of await fsp.readdir(this.dir).catch(() => [] as string[])) {
      if (!f.endsWith('.tmp')) continue
      const full = path.join(this.dir, f)
      const st = await fsp.stat(full).catch(() => null)
      if (st && Date.now() - st.mtimeMs > 10 * 60_000) await fsp.unlink(full).catch(() => undefined)
    }
    try {
      const manifest = JSON.parse(await fsp.readFile(path.join(this.dir, 'index.json'), 'utf8')) as IndexFile
      this.folders = manifest.folders ?? []
      if (manifest.options) this.options = { ...this.options, ...manifest.options }
      // Older format or another model: vectors are incompatible, everything is re-indexed.
      if (manifest.version !== 3 || manifest.embedder !== this.embedder.id || manifest.dims !== this.embedder.dims) return
      const buf = await fsp.readFile(path.join(this.dir, 'vectors.bin'))
      this.vectors = Float32Array.from(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)))
      this.vectorCount = Math.floor(this.vectors.length / this.embedder.dims)
      const lines = createInterface({ input: createReadStream(path.join(this.dir, 'docs.ndjson'), 'utf8'), crlfDelay: Infinity })
      for await (const line of lines) if (line) this.put(JSON.parse(line) as DocRecord)
    } catch {
      // No index yet.
    }
  }

  private put(d: DocRecord): void {
    this.docs.set(d.path, d)
    let id = this.ids.get(d.path)
    if (id === undefined) {
      id = this.byId.length
      this.ids.set(d.path, id)
    }
    this.byId[id] = d
    if (d.chunks.length) this.hashes.set(d.hash, d.path)
    this.bm25.add(id, { name: titleFor(d.path), chunks: d.chunks.map((c) => c.t) })
  }

  private drop(p: string): void {
    const d = this.docs.get(p)
    if (d && this.hashes.get(d.hash) === p) this.hashes.delete(d.hash)
    this.docs.delete(p)
    const id = this.ids.get(p)
    if (id !== undefined) this.bm25.remove(id)
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save().catch(() => undefined)
    }, 3000)
  }

  private saving: Promise<void> = Promise.resolve()

  /** Saves are serialised: the periodic and the debounced save must never write the same temp files at once. */
  save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this.saving = this.saving.catch(() => undefined).then(() => this.doSave())
    return this.saving
  }

  private async doSave(): Promise<void> {
    await fsp.mkdir(this.dir, { recursive: true })
    // Compact: rewrite vectors contiguously, dropping orphans left by re-indexed files.
    const dims = this.embedder.dims
    let total = 0
    for (const d of this.docs.values()) total += d.chunks.length
    const packed = new Float32Array(total * dims)
    let next = 0
    // Unique temporary names: another process (or a second index on the same folder) can never rename ours.
    const tag = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const tmp = (name: string): string => path.join(this.dir, `${name}.${tag}.tmp`)
    const out = createWriteStream(tmp('docs.ndjson'), 'utf8')
    for (const d of this.docs.values()) {
      packed.set(this.vectors.subarray(d.v * dims, (d.v + d.chunks.length) * dims), next * dims)
      d.v = next
      next += d.chunks.length
      if (!out.write(JSON.stringify(d) + '\n')) await once(out, 'drain')
    }
    out.end()
    // 'close' (not 'finish'): on Windows the file must be closed before it can be renamed.
    await once(out, 'close')
    this.vectors = packed
    this.vectorCount = next
    const manifest: IndexFile = { version: 3, embedder: this.embedder.id, dims, folders: this.folders, options: this.options }
    await fsp.writeFile(tmp('vectors.bin'), Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength))
    await fsp.writeFile(tmp('index.json'), JSON.stringify(manifest))
    // index.json goes last: it is what marks the three files as a consistent set.
    await renameRetry(tmp('vectors.bin'), path.join(this.dir, 'vectors.bin'))
    await renameRetry(tmp('docs.ndjson'), path.join(this.dir, 'docs.ndjson'))
    await renameRetry(tmp('index.json'), path.join(this.dir, 'index.json'))
  }

  private meanCache: { count: number; v: Float32Array } | null = null

  /** Mean of all passage vectors (recomputed when the index grows or shrinks by more than 2%). */
  private meanVector(): Float32Array {
    const dims = this.embedder.dims
    let count = 0
    for (const d of this.docs.values()) count += d.chunks.length
    if (this.meanCache && Math.abs(this.meanCache.count - count) <= count * 0.02) return this.meanCache.v
    const sum = new Float64Array(dims)
    let n = 0
    for (const d of this.docs.values()) {
      for (let i = 0; i < d.chunks.length; i++) {
        if (d.chunks[i].e === 0) continue
        const off = (d.v + i) * dims
        for (let k = 0; k < dims; k++) sum[k] += this.vectors[off + k]
        n++
      }
    }
    const v = new Float32Array(dims)
    if (n) for (let k = 0; k < dims; k++) v[k] = sum[k] / n
    this.meanCache = { count, v }
    return v
  }

  private appendVectors(vecs: Float32Array[]): number {
    const dims = this.embedder.dims
    const start = this.vectorCount
    const needed = (start + vecs.length) * dims
    if (needed > this.vectors.length) {
      const grown = new Float32Array(Math.max(needed, this.vectors.length * 2, 1024 * dims))
      grown.set(this.vectors.subarray(0, this.vectorCount * dims))
      this.vectors = grown
    }
    vecs.forEach((v, i) => this.vectors.set(v, (start + i) * dims))
    this.vectorCount += vecs.length
    return start
  }

  // ------------------------------------------------------------ models

  /** Loads the embedding model (and, in the background, the reranker). */
  private ensureModels(): Promise<void> {
    if (!this.modelReady) {
      this.modelReady = this.embedder.embedQuery('warm up').then(() => {
        if (this.options.rerank && this.reranker) void this.reranker.score('warm up', ['warm up']).catch(() => undefined)
      })
      this.modelReady.catch(() => {
        this.modelReady = null
      })
    }
    return this.modelReady
  }

  // --------------------------------------------------------------- indexing

  /** Loads the models in the background so the first search doesn't pay for it (search window opened). */
  warm(): void {
    if (this.docs.size) void this.ensureModels().catch(() => undefined)
  }

  getOptions(): SemanticOptions {
    return { ...this.options }
  }

  /** Returns true when the set of indexable files changed (a rescan is needed). */
  async setOptions(opts: Partial<SemanticOptions>): Promise<boolean> {
    await this.load()
    const before = this.options.includeCode
    this.options = { ...this.options, ...opts }
    this.scheduleSave()
    this.emit()
    return before !== this.options.includeCode
  }

  async setFolders(folders: string[]): Promise<void> {
    await this.load()
    this.folders = [...new Set(folders.map((f) => path.resolve(f)))]
    for (const p of [...this.docs.keys()]) if (!this.folders.some((f) => isInside(p, f))) this.drop(p)
    this.scheduleSave()
    this.emit()
  }

  /** Scans all folders breadth-first, queues new/changed files (newest first) and forgets deleted ones. */
  async rescan(): Promise<void> {
    await this.load()
    const seen = new Set<string>()
    const changed: { path: string; mtime: number }[] = []
    let truncated = false
    for (const root of this.folders) {
      const dirs = [root]
      for (let di = 0; di < dirs.length; di++) {
        if (seen.size >= MAX_FILES) {
          truncated = true
          break
        }
        let dirents
        try {
          dirents = await fsp.readdir(dirs[di], { withFileTypes: true })
        } catch {
          continue
        }
        for (const d of dirents) {
          if (d.name.startsWith('.') || d.name.startsWith('~$') || d.name.startsWith('$')) continue
          const full = path.join(dirs[di], d.name)
          if (d.isDirectory()) {
            if (!SKIP_DIRS.has(d.name)) dirs.push(full)
            continue
          }
          if (!d.isFile() || !isIndexable(d.name, 0, this.options)) continue
          try {
            const st = await fsp.stat(full)
            if (!isIndexable(d.name, st.size, this.options)) continue
            seen.add(full)
            const doc = this.docs.get(full)
            if (!doc || doc.mtime !== st.mtimeMs || doc.size !== st.size) changed.push({ path: full, mtime: st.mtimeMs })
          } catch {
            // unreadable
          }
        }
      }
    }
    this.truncated = truncated
    // With a truncated scan, files beyond the limit were not seen: keep them rather than forgetting them.
    if (!truncated) for (const p of [...this.docs.keys()]) if (!seen.has(p)) this.drop(p)
    changed.sort((a, b) => b.mtime - a.mtime)
    this.enqueue(changed.map((c) => c.path))
  }

  enqueue(paths: string[]): void {
    const set = new Set(this.queue)
    for (const p of paths) if (!set.has(p)) this.queue.push(p)
    this.emit()
    void this.run()
  }

  /** Resolves once the queue is empty and no file is being indexed. */
  async idle(): Promise<void> {
    while (this.running || this.queue.length) await new Promise((r) => setTimeout(r, 50))
  }

  cancel(): void {
    this.cancelled = true
    this.queue = []
    this.emit()
  }

  async clear(): Promise<void> {
    this.cancel()
    for (const p of [...this.docs.keys()]) this.drop(p)
    this.vectors = new Float32Array(0)
    this.vectorCount = 0
    await this.save()
    this.emit()
  }

  private async run(): Promise<void> {
    if (this.running) return
    this.running = true
    this.cancelled = false
    this.done = 0
    this.startedAt = Date.now()
    this.emit()
    let sinceSave = 0
    try {
      while (this.queue.length && !this.cancelled) {
        await this.yieldToSearch()
        const file = this.queue.shift()!
        this.currentFile = file
        this.emit()
        try {
          await this.indexFile(file)
        } catch (e) {
          if (this.modelState === 'error') break
          void e
        }
        this.done++
        if (++sinceSave >= 200) {
          sinceSave = 0
          // A failed save (disk full, file locked) must never stop indexing; the next save retries.
          await this.save().catch(() => undefined)
        }
      }
    } finally {
      this.running = false
      this.currentFile = undefined
      this.startedAt = undefined
      await this.save().catch(() => undefined)
      this.emit()
      // The embedder is warm after indexing; get the reranker ready too so the next search is quick.
      if (this.done && this.modelState === 'ready') void this.ensureModels().catch(() => undefined)
    }
  }

  private async yieldToSearch(): Promise<void> {
    while (this.searching > 0) await new Promise((r) => setTimeout(r, 25))
  }

  async indexFile(file: string): Promise<void> {
    const st = await fsp.stat(file)
    const name = path.basename(file)
    const raw = await extractText(file).catch(() => '')
    const clean = normalizeWhitespace(raw)
    const hash = createHash('sha1').update(clean).digest('hex')
    const base = { path: file, name, mtime: st.mtimeMs, size: st.size, hash }
    const pieces = chunkText(clean, 800, 150, MAX_CHUNKS)
    if (!pieces.length) {
      this.put({ ...base, chunks: [], v: 0 })
      this.scheduleSave()
      return
    }
    const chunks: ChunkRecord[] = pieces.map((c) => {
      const rec: ChunkRecord = { t: c.text.replace(/\f/g, '\n').slice(0, 900), o: c.offset }
      if (clean.includes('\f')) rec.p = pageAt(clean, c.offset + Math.min(40, c.text.length))
      if (!isProse(c.text)) rec.e = 0
      return rec
    })
    // Identical content elsewhere (copies, backups): reuse its vectors instead of running the model again.
    const twinPath = this.hashes.get(hash)
    const twin = twinPath && twinPath !== file ? this.docs.get(twinPath) : undefined
    let vecs: Float32Array[]
    if (twin && twin.chunks.length === chunks.length) {
      const dims = this.embedder.dims
      vecs = chunks.map((_, i) => this.vectors.slice((twin.v + i) * dims, (twin.v + i + 1) * dims))
    } else {
      vecs = chunks.map(() => new Float32Array(this.embedder.dims))
      const title = titleFor(file)
      const todo = embedSample(chunks.map((c, i) => ({ c, i })).filter(({ c }) => c.e !== 0), EMBED_BUDGET)
      const embedded = new Set(todo.map((x) => x.i))
      chunks.forEach((c, i) => {
        if (!embedded.has(i)) c.e = 0
      })
      for (let i = 0; i < todo.length; i += EMBED_BATCH) {
        if (this.cancelled) return
        await this.yieldToSearch()
        const batch = todo.slice(i, i + EMBED_BATCH)
        // The title gives every passage its context ("Contratto locazione via Roma" for an article deep inside).
        const out = await this.embedder.embedPassages(batch.map(({ c }) => `${title}\n${c.t}`))
        batch.forEach(({ i: ci }, k) => (vecs[ci] = out[k]))
      }
    }
    const v = this.appendVectors(vecs)
    this.put({ ...base, chunks, v })
    this.scheduleSave()
  }

  // ----------------------------------------------------------------- search

  async search(query: string, opts: SemanticSearchOptions = {}): Promise<SemanticSearchResult> {
    const key = JSON.stringify([query.trim(), opts, this.docs.size, this.options.rerank, this.modelState, this.rerankState])
    if (!opts.explain && this.cache?.key === key && Date.now() - this.cache.at < 60_000) return this.cache.result
    this.searching++
    try {
      const result = await this.doSearch(query, opts)
      if (!opts.explain) this.cache = { key, at: Date.now(), result }
      return result
    } finally {
      this.searching--
    }
  }

  private async doSearch(query: string, opts: SemanticSearchOptions): Promise<SemanticSearchResult> {
    const t0 = Date.now()
    await this.load()
    const q = query.trim()
    if (!q) return { hits: [], mode: 'keywords', ms: 0 }
    const limit = opts.limit ?? 50
    const scope = opts.folder ? path.resolve(opts.folder) : null
    const exts = opts.exts?.length ? new Set(opts.exts) : null
    const allowed = (d: DocRecord): boolean =>
      (!scope || isInside(d.path, scope)) && (!exts || exts.has(path.extname(d.name).slice(1).toLowerCase())) && (!opts.after || d.mtime >= opts.after)
    const terms = queryTerms(q)
    const dims = this.embedder.dims

    // Keywords (BM25). Short queries need every word; longer, descriptive ones at least half (weighted by rarity).
    const minCoverage = terms.length <= 2 ? 0.99 : 0.5
    const anyKeyword = this.bm25
      .search(q)
      .filter((k) => this.byId[k.doc] && this.docs.get(this.byId[k.doc].path) === this.byId[k.doc] && allowed(this.byId[k.doc]))
      .map((k) => ({ ...k, rec: this.byId[k.doc] }))
    const keyword = anyKeyword.filter((k) => k.coverage >= minCoverage).slice(0, 40)
    // Passages holding some of the query words, even when too few words match to make the document a candidate.
    const wordChunk = new Map(anyKeyword.map((k) => [k.rec.path, k.chunk]))

    // Meaning (vectors): best two passages per document.
    let semantic: { rec: DocRecord; score: number; centred: number; chunks: number[] }[] = []
    let modelOk = this.modelState === 'ready'
    if (!modelOk) {
      modelOk = await withTimeout(this.ensureModels(), MODEL_WAIT_MS)
        .then(() => true)
        .catch(() => false)
    }
    if (modelOk) {
      const qv = await this.embedder.embedQuery(q)
      // Centring (subtracting the mean passage vector) removes the "looks a bit like everything" bias of long,
      // generic documents (licences, contribution guides, prompts) when picking candidates.
      const mean = this.meanVector()
      const qm = dot(qv, mean)
      const mm = dot(mean, mean)
      const qNorm = Math.sqrt(Math.max(1e-9, 1 - 2 * qm + mm))
      for (const d of this.docs.values()) {
        if (!allowed(d)) continue
        let best = -1
        let second = -1
        let bi = -1
        let si = -1
        let centred = -1
        for (let i = 0; i < d.chunks.length; i++) {
          if (d.chunks[i].e === 0) continue
          const off = (d.v + i) * dims
          const s = dot(qv, this.vectors, off)
          const cm = dot(mean, this.vectors, off)
          const c = (s - qm - cm + mm) / (qNorm * Math.sqrt(Math.max(1e-9, 1 - 2 * cm + mm)))
          if (c > centred) centred = c
          if (s > best) {
            second = best
            si = bi
            best = s
            bi = i
          } else if (s > second) {
            second = s
            si = i
          }
        }
        if (bi >= 0) semantic.push({ rec: d, score: best, centred, chunks: si >= 0 ? [bi, si] : [bi] })
      }
      semantic.sort((a, b) => b.score - a.score)
    }

    const useRerank =
      modelOk &&
      !!this.reranker &&
      this.options.rerank &&
      (this.rerankState === 'ready' || (this.rerankState !== 'error' && (await withTimeout(this.reranker.score('warm up', ['warm up']), MODEL_WAIT_MS).then(() => true).catch(() => false))))

    const kwBy = new Map(keyword.map((k) => [k.rec.path, k]))
    const semBy = new Map(semantic.map((s) => [s.rec.path, s]))
    let ranked: { rec: DocRecord; score: number; chunk: number }[]
    let mode: SemanticSearchResult['mode']

    if (opts.explain) {
      const cands = new Map<string, DocRecord>()
      for (const s of semantic.slice(0, 30)) cands.set(s.rec.path, s.rec)
      for (const k of keyword.slice(0, 20)) cands.set(k.rec.path, k.rec)
      const list = [...cands.values()]
      const firstChunk = (rec: DocRecord): number => semBy.get(rec.path)?.chunks[0] ?? kwBy.get(rec.path)?.chunk ?? 0
      const logits = this.reranker && modelOk
        ? await this.reranker.score(q, list.map((rec) => `${titleFor(rec.path)}\n${rec.chunks[firstChunk(rec)]?.t.slice(0, 1000) ?? ''}`))
        : []
      this.lastExplain = list.map((rec, i) => ({
        path: rec.path,
        cos: semBy.get(rec.path)?.score ?? 0,
        centred: semBy.get(rec.path)?.centred ?? 0,
        semRank: semantic.findIndex((s) => s.rec === rec),
        best: semantic[0]?.score ?? 0,
        logit: logits[i] ?? 0,
        bm25: kwBy.get(rec.path)?.score ?? 0,
        coverage: kwBy.get(rec.path)?.coverage ?? 0,
        name: kwBy.get(rec.path)?.nameMatch ? 1 : 0
      }))
    }

    if (useRerank) {
      mode = 'precise'
      const candidates = new Map<string, DocRecord>()
      for (const c of [...semantic].sort((a, b) => b.centred - a.centred).slice(0, RERANK_SEMANTIC)) candidates.set(c.rec.path, c.rec)
      for (const c of semantic.slice(0, 5)) candidates.set(c.rec.path, c.rec)
      for (const k of keyword.slice(0, RERANK_KEYWORD)) candidates.set(k.rec.path, k.rec)
      const pairs: { rec: DocRecord; chunk: number }[] = []
      for (const rec of candidates.values()) {
        const sem = semBy.get(rec.path)
        const set = new Set<number>()
        // The cross-encoder reads the passage closest in meaning and the one holding the query words
        // ("deposit" → the "Deposito cauzionale" article of a long contract).
        if (sem) set.add(sem.chunks[0])
        if (wordChunk.has(rec.path)) set.add(wordChunk.get(rec.path)!)
        if (!set.size) set.add(rec.chunks.length ? 0 : -1)
        for (const c of set) pairs.push({ rec, chunk: c })
      }
      const logits = await this.reranker!.score(
        q,
        pairs.map(({ rec, chunk }) => `${titleFor(rec.path)}\n${chunk >= 0 ? focusWindow(rec.chunks[chunk].t, terms, RERANK_CHARS) : ''}`)
      )
      const best = new Map<string, { rec: DocRecord; score: number; chunk: number }>()
      pairs.forEach((p, i) => {
        const k = kwBy.get(p.rec.path)
        const cos = semBy.get(p.rec.path)?.score ?? COS_PIVOT - 0.04
        // Exact words in the file name are an explicit signal the models weigh too little.
        const score = logits[i] + COS_WEIGHT * (cos - COS_PIVOT) + (k?.nameMatch ? NAME_BONUS : 0)
        const cur = best.get(p.rec.path)
        if (!cur || score > cur.score) best.set(p.rec.path, { rec: p.rec, score, chunk: Math.max(0, p.chunk) })
      })
      const sorted = [...best.values()].sort((a, b) => b.score - a.score)
      const top = sorted[0]?.score ?? 0
      ranked = sorted.filter((r) => r.score >= RANK_FLOOR && r.score >= top - RANK_GAP).map((r) => ({ ...r, score: sigmoid(r.score + 2) }))
    } else if (modelOk) {
      mode = 'semantic'
      const cutoff = similarityCutoff(semantic, this.embedder.minSimilarity, this.embedder.margin)
      const sem = semantic.filter((s) => s.score >= cutoff).slice(0, 60)
      const fused = rrf([sem.map((s) => s.rec.path), keyword.map((k) => k.rec.path)])
      const semKept = new Map(sem.map((s) => [s.rec.path, s]))
      ranked = [...fused.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([p]) => {
          const s = semKept.get(p)
          const k = kwBy.get(p)
          const rec = (s ?? k)!.rec
          return { rec, score: s ? Math.max(0, Math.min(1, (s.score - 0.75) / 0.15)) : Math.min(1, 0.4 + (k?.coverage ?? 0) * 0.4), chunk: s ? s.chunks[0] : k!.chunk }
        })
    } else {
      mode = 'keywords'
      const top = keyword[0]?.score || 1
      ranked = keyword.map((k) => ({ rec: k.rec, score: Math.min(1, k.score / top), chunk: k.chunk }))
    }

    // Fold identical files into one result.
    const hits: SemanticHit[] = []
    const byHash = new Map<string, SemanticHit>()
    for (const r of ranked) {
      const twin = r.rec.hash && r.rec.chunks.length ? byHash.get(r.rec.hash) : undefined
      if (twin) {
        twin.duplicates.push(r.rec.path)
        continue
      }
      if (hits.length >= limit) continue
      const chunk = r.rec.chunks[r.chunk]
      const matched: SemanticMatch[] = []
      const s = semBy.get(r.rec.path)
      const k = kwBy.get(r.rec.path)
      if (s && (mode === 'precise' || s.score >= this.embedder.minSimilarity)) matched.push('meaning')
      if (k && k.coverage > 0) matched.push('words')
      if (k?.nameMatch) matched.push('name')
      const hit: SemanticHit = {
        path: r.rec.path,
        name: r.rec.name,
        score: r.score,
        snippet: chunk ? makeSnippet(chunk.t, terms, 260) : '',
        page: chunk?.p,
        matched,
        duplicates: [],
        mtime: r.rec.mtime,
        size: r.rec.size
      }
      hits.push(hit)
      if (r.rec.hash && r.rec.chunks.length) byHash.set(r.rec.hash, hit)
    }
    return { hits, mode, ms: Date.now() - t0 }
  }
}

/** The first half of the budget from the start of the document, the rest evenly spread over the remainder. */
export function embedSample<T>(items: T[], budget: number): T[] {
  if (items.length <= budget) return items
  const head = Math.ceil(budget / 2)
  const rest = items.slice(head)
  const picks = budget - head
  const out = items.slice(0, head)
  for (let k = 0; k < picks; k++) out.push(rest[Math.floor(((k + 0.5) * rest.length) / picks)])
  return out
}

/**
 * rename() that tolerates Windows briefly locking a file that was just written (antivirus, search indexer, backup
 * tools report EPERM/EBUSY/EACCES for a few milliseconds).
 */
async function renameRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(from, to)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw e
      if (attempt >= 20) {
        // Still locked: overwrite the contents instead of replacing the file.
        await fsp.copyFile(from, to)
        await fsp.unlink(from).catch(() => undefined)
        return
      }
      await new Promise((r) => setTimeout(r, Math.min(500, 25 * (attempt + 1))))
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

function isInside(child: string, parent: string): boolean {
  const fold = process.platform === 'win32' || process.platform === 'darwin'
  const rel = path.relative(fold ? parent.toLowerCase() : parent, fold ? child.toLowerCase() : child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}
