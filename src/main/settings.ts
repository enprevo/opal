import { promises as fsp } from 'node:fs'
import * as path from 'node:path'
import { DEFAULT_PREFS, type PersistedState } from '../shared/types'
import { normalizeState } from '../shared/settings'

export function defaultState(): PersistedState {
  return { prefs: { ...DEFAULT_PREFS }, favorites: [], recent: [] }
}

/**
 * rename() that tolerates Windows briefly locking a file that was just written (antivirus, search indexer,
 * cloud sync clients report EPERM/EBUSY/EACCES for a few milliseconds).
 */
export async function renameRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(from, to)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? ''
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(code)) throw e
      if (attempt >= 20) {
        await fsp.copyFile(from, to)
        await fsp.unlink(from).catch(() => undefined)
        return
      }
      await new Promise((r) => setTimeout(r, Math.min(500, 25 * (attempt + 1))))
    }
  }
}

export class SettingsStore {
  private state: PersistedState = defaultState()
  private writeTimer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()
  private backedUp = false

  constructor(private readonly file: string) {}

  private get backup(): string {
    return this.file.replace(/\.json$/, '') + '.bak.json'
  }

  async load(): Promise<PersistedState> {
    let text: string | null = null
    try {
      text = await fsp.readFile(this.file, 'utf8')
      this.state = normalizeState(JSON.parse(text))
      return this.state
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && text !== null) {
        // Unreadable file: keep it for the user instead of overwriting it with defaults.
        await fsp.copyFile(this.file, this.file.replace(/\.json$/, '') + `.corrupt-${Date.now()}.json`).catch(() => undefined)
      }
    }
    try {
      this.state = normalizeState(JSON.parse(await fsp.readFile(this.backup, 'utf8')))
    } catch {
      this.state = defaultState()
    }
    return this.state
  }

  get(): PersistedState {
    return this.state
  }

  update(patch: Partial<PersistedState>): PersistedState {
    this.state = { ...this.state, ...patch }
    this.scheduleWrite()
    return this.state
  }

  /** Replaces everything (settings import). */
  replace(state: PersistedState): PersistedState {
    this.state = state
    this.scheduleWrite()
    return this.state
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => void this.flush().catch(() => undefined), 300)
  }

  /** Writes are serialised so two flushes never write the same temporary file at once. */
  flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    this.writing = this.writing.catch(() => undefined).then(() => this.write())
    return this.writing
  }

  private async write(): Promise<void> {
    await fsp.mkdir(path.dirname(this.file), { recursive: true })
    // Once per session, keep the previous good file as a backup.
    if (!this.backedUp) {
      this.backedUp = true
      await fsp.copyFile(this.file, this.backup).catch(() => undefined)
    }
    const tmp = this.file + '.tmp'
    await fsp.writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf8')
    await renameRetry(tmp, this.file)
  }
}
