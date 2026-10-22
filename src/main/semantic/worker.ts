/**
 * Semantic index host. Runs in an Electron utility process so that text extraction and the ONNX model
 * (which blocks its JavaScript thread for hundreds of milliseconds per batch) never freeze the file manager.
 * The main process talks to it through SemanticClient (./client.ts).
 */
import { SemanticIndex } from './index'
import { HashEmbedder, OverlapReranker, TransformersEmbedder, TransformersReranker, type Embedder, type Reranker } from './embedders'

export interface WorkerInit {
  dir: string
  modelDir: string
  /** 'hash' = deterministic offline embedder for tests. */
  embedder: 'model' | 'hash'
}

interface ParentPort {
  on(event: 'message', cb: (e: { data: unknown }) => void): void
  postMessage(msg: unknown): void
}

const port = (process as unknown as { parentPort: ParentPort }).parentPort
// A stray rejection (e.g. a file that vanished mid-extraction) must not take the indexer down.
process.on('unhandledRejection', (e) => console.error('[semantic]', e))
let index: SemanticIndex | null = null

const METHODS = new Set(['warm', 'status', 'load', 'setFolders', 'setOptions', 'getOptions', 'rescan', 'enqueue', 'cancel', 'clear', 'search', 'save'])

function create(init: WorkerInit): SemanticIndex {
  let idx: SemanticIndex | null = null
  const test = init.embedder === 'hash'
  const embedder: Embedder = test ? new HashEmbedder() : new TransformersEmbedder(init.modelDir, (s, e) => idx?.setModelState(s, e))
  const reranker: Reranker = test ? new OverlapReranker() : new TransformersReranker(init.modelDir, (s, e) => idx?.setRerankState(s, e))
  idx = new SemanticIndex(init.dir, embedder, (status) => port.postMessage({ type: 'status', status }), reranker)
  if (test) {
    idx.setModelState('ready')
    idx.setRerankState('ready')
  }
  return idx
}

port.on('message', (e) => {
  const msg = e.data as { type: 'init'; init: WorkerInit } | { type: 'call'; id: number; method: string; args: unknown[] }
  if (msg.type === 'init') {
    index = create(msg.init)
    void index.load().then(() => port.postMessage({ type: 'status', status: index!.status() }))
    return
  }
  const { id, method, args } = msg
  void (async () => {
    try {
      if (!index) throw new Error('Semantic index not initialised')
      if (!METHODS.has(method)) throw new Error(`Unknown method ${method}`)
      const fn = (index as unknown as Record<string, (...a: unknown[]) => unknown>)[method]
      port.postMessage({ type: 'result', id, result: await fn.apply(index, args) })
    } catch (err) {
      port.postMessage({ type: 'result', id, error: (err as Error)?.message ?? String(err) })
    }
  })()
})
