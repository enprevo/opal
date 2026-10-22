import { utilityProcess, type UtilityProcess } from 'electron'
import * as path from 'node:path'
import type { SemanticSearchOptions, SemanticSearchResult, SemanticStatus } from '../../shared/types'
import type { SemanticOptions } from './index'
import type { WorkerInit } from './worker'

const EMPTY: SemanticStatus = {
  ready: false,
  model: '',
  modelState: 'idle',
  rerankState: 'idle',
  indexing: false,
  queued: 0,
  done: 0,
  total: 0,
  indexedFiles: 0,
  indexedChunks: 0,
  folders: []
}

/**
 * Main-process proxy for the semantic index running in a utility process (see worker.ts).
 * The worker is started lazily and restarted on the next call if it crashes.
 */
export class SemanticClient {
  private child: UtilityProcess | null = null
  private seq = 0
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private last: SemanticStatus = EMPTY
  private crashes = 0

  constructor(
    private readonly init: WorkerInit,
    private readonly onStatus: (s: SemanticStatus) => void
  ) {}

  get running(): boolean {
    return !!this.child
  }

  private start(): UtilityProcess {
    if (this.child) return this.child
    const child = utilityProcess.fork(path.join(__dirname, 'semanticWorker.js'), [], { serviceName: 'Opal semantic index', stdio: 'inherit' })
    child.on('message', (msg: { type: string; id?: number; result?: unknown; error?: string; status?: SemanticStatus }) => {
      if (msg.type === 'status' && msg.status) {
        this.last = msg.status
        this.onStatus(msg.status)
      } else if (msg.type === 'result' && msg.id !== undefined) {
        const p = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error !== undefined) p?.reject(new Error(msg.error))
        else p?.resolve(msg.result)
      }
    })
    child.on('exit', (code) => {
      if (this.child !== child) return
      this.child = null
      for (const p of this.pending.values()) p.reject(new Error(`Semantic index stopped (exit code ${code})`))
      this.pending.clear()
      if (code !== 0) this.crashes++
      this.last = { ...this.last, indexing: false, currentFile: undefined, modelState: code === 0 ? this.last.modelState : 'error', modelError: code === 0 ? undefined : 'The indexing process stopped unexpectedly; it restarts automatically.' }
      this.onStatus(this.last)
    })
    child.postMessage({ type: 'init', init: this.init })
    this.child = child
    return child
  }

  private call<T>(method: string, ...args: unknown[]): Promise<T> {
    if (this.crashes > 5) return Promise.reject(new Error('Semantic index keeps crashing; restart Opal'))
    const child = this.start()
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      child.postMessage({ type: 'call', id, method, args })
    })
  }

  status(): Promise<SemanticStatus> {
    return this.call<SemanticStatus>('status')
  }

  warm(): Promise<void> {
    return this.call('warm')
  }

  lastStatus(): SemanticStatus {
    return this.last
  }

  setFolders(folders: string[]): Promise<void> {
    return this.call('setFolders', folders)
  }

  /** Returns true when the change requires a rescan. */
  setOptions(opts: Partial<SemanticOptions>): Promise<boolean> {
    return this.call('setOptions', opts)
  }

  rescan(): Promise<void> {
    return this.call('rescan')
  }

  enqueue(paths: string[]): Promise<void> {
    return this.call('enqueue', paths)
  }

  cancel(): Promise<void> {
    return this.call('cancel')
  }

  clear(): Promise<void> {
    return this.call('clear')
  }

  search(q: string, opts: SemanticSearchOptions): Promise<SemanticSearchResult> {
    return this.call('search', q, opts)
  }

  /** Saves the index and stops the worker (used on quit). */
  async stop(): Promise<void> {
    if (!this.child) return
    await Promise.race([this.call('save').catch(() => undefined), new Promise((r) => setTimeout(r, 2000))])
    const c = this.child
    this.child = null
    c?.kill()
  }
}
