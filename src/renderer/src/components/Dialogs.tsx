import { useEffect, useMemo, useRef, useState } from 'react'
import { closeDialog, getState, toast, useStore } from '../state/store'
import * as A from '../state/actions'
import { COMMAND_DOCS } from '../state/commands'
import type { ConflictPolicy, FileEntry, SyncItem } from '@shared/types'
import { previewRename, type CaseMode, type RenameMode, type RenameOptions } from '@shared/rename'
import { basename, dirname, join, validateFileName } from '@shared/paths'
import { formatDate, formatSize } from '@shared/format'
import { fileTypeLabel } from '@shared/filetypes'
import { PrefsDialog, SetupDialog } from './Settings'
import { SemanticDialog, TaggedDialog } from './SemanticSearch'
import { FileIcon } from './FileIcon'
import { FavoriteEditDialog, FavoritesManager } from './Favorites'
import type { FavoriteGroup, FavoriteItem } from '@shared/favorites'

export function DialogHost() {
  const dialog = useStore((s) => s.dialog)
  if (!dialog) return null
  const p = dialog.props as never
  let body: React.ReactElement | null = null
  switch (dialog.type) {
    case 'confirm':
      body = <ConfirmDialog {...(p as ConfirmProps)} />
      break
    case 'prompt':
      body = <PromptDialog {...(p as PromptProps)} />
      break
    case 'conflict':
      body = <ConflictDialog {...(p as ConflictProps)} />
      break
    case 'rename':
      body = <RenameDialog {...(p as { entries: FileEntry[] })} />
      break
    case 'find':
      body = (p as { semantic?: boolean }).semantic ? <SemanticDialog {...(p as { root: string })} /> : <FindDialog {...(p as { root: string; pattern: string; autostart?: boolean })} />
      break
    case 'semantic':
      body = <SemanticDialog {...(p as { root: string })} />
      break
    case 'setup':
      body = <SetupDialog />
      break
    case 'tagged':
      body = <TaggedDialog {...(p as { label: string })} />
      break
    case 'properties':
      body = <PropertiesDialog {...(p as { entries: FileEntry[] })} />
      break
    case 'prefs':
      body = <PrefsDialog />
      break
    case 'sync':
      body = <SyncDialog {...(p as { left: string; right: string })} />
      break
    case 'help':
      body = <HelpDialog />
      break
    case 'nested':
      body = <NestedDialog {...(p as { op: string; count: number })} />
      break
    case 'favoriteEdit':
      body = <FavoriteEditDialog {...(p as { node: FavoriteItem | FavoriteGroup; focus?: 'key' })} />
      break
    case 'favorites':
      body = <FavoritesManager {...(p as { select?: string })} />
      break
    case 'duplicates':
      body = <DuplicatesDialog {...(p as { root: string })} />
      break
  }
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeDialog(null)}>
      {body}
    </div>
  )
}

export function Modal({ title, children, footer, wide, testId }: { title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean; testId?: string }) {
  return (
    <div
      className={`modal${wide ? ' wide' : ''}`}
      role="dialog"
      data-testid={testId ?? 'dialog'}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          closeDialog(null)
        }
      }}
    >
      <div className="modal-title">{title}</div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </div>
  )
}

interface ConfirmProps {
  title: string
  message: string
  danger?: boolean
  okLabel?: string
}

function ConfirmDialog({ title, message, danger, okLabel }: ConfirmProps) {
  const ok = useRef<HTMLButtonElement>(null)
  useEffect(() => ok.current?.focus(), [])
  return (
    <Modal
      title={title}
      testId="confirm-dialog"
      footer={
        <>
          <button className="btn" onClick={() => closeDialog(false)}>
            Cancel
          </button>
          <button ref={ok} className={`btn ${danger ? 'danger' : 'primary'}`} data-testid="confirm-ok" onClick={() => closeDialog(true)}>
            {okLabel ?? 'OK'}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  )
}

interface PromptProps {
  title: string
  label: string
  value: string
  validateName?: boolean
  browse?: boolean
  /** An empty answer is valid (e.g. "no group"). */
  allowEmpty?: boolean
}

function PromptDialog({ title, label, value, validateName, browse, allowEmpty }: PromptProps) {
  const [v, setV] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  const style = getState().info.platform === 'win32' ? 'win' : 'posix'
  const error = validateName ? validateFileName(v, style) : null
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = validateName ? v.lastIndexOf('.') : -1
    el.setSelectionRange(0, dot > 0 ? dot : v.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const submit = (): void => {
    if (!error && (allowEmpty || v.trim())) closeDialog(v.trim())
  }
  return (
    <Modal
      title={title}
      testId="prompt-dialog"
      footer={
        <>
          <button className="btn" onClick={() => closeDialog(null)}>
            Cancel
          </button>
          <button className="btn primary" data-testid="prompt-ok" disabled={!!error || (!allowEmpty && !v.trim())} onClick={submit}>
            OK
          </button>
        </>
      }
    >
      <label className="field">
        <span>{label}</span>
        <div className="row-flex">
          <input
            ref={ref}
            data-testid="prompt-input"
            value={v}
            spellCheck={false}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          {browse && (
            <button className="btn" onClick={() => void window.opal.pickFolder().then((p) => p && setV(p))}>
              Browse…
            </button>
          )}
        </div>
      </label>
      {error && v && <div className="error small">{error}</div>}
    </Modal>
  )
}

interface ConflictProps {
  conflicts: string[]
  op: string
}

function ConflictDialog({ conflicts, op }: ConflictProps) {
  const choose = (p: ConflictPolicy) => () => closeDialog(p)
  return (
    <Modal
      title="Files already exist"
      testId="conflict-dialog"
      footer={
        <>
          <button className="btn" onClick={() => closeDialog(null)}>
            Cancel
          </button>
          <button className="btn" data-testid="conflict-skip" onClick={choose('skip')}>
            Skip
          </button>
          <button className="btn" data-testid="conflict-rename" onClick={choose('rename')}>
            Keep both
          </button>
          <button className="btn" data-testid="conflict-newer" onClick={choose('newer')}>
            Replace if newer
          </button>
          <button className="btn primary" data-testid="conflict-overwrite" onClick={choose('overwrite')}>
            Replace all
          </button>
        </>
      }
    >
      <p>
        {conflicts.length} item(s) already exist in the destination. How should the {op} proceed?
      </p>
      <ul className="conflict-list">
        {conflicts.slice(0, 12).map((c) => (
          <li key={c}>{c}</li>
        ))}
        {conflicts.length > 12 && <li className="muted">…and {conflicts.length - 12} more</li>}
      </ul>
    </Modal>
  )
}


const BUILTIN_PRESETS: Record<string, RenameOptions> = {
  'Capitalize Words': { mode: 'standard', oldPattern: '*', newPattern: '*', caseMode: 'title' },
  'Make Web-safe': { mode: 'regex', oldPattern: '(.*)([^-0-9a-zA-Z._]+)(.*)#', newPattern: '\\1_\\3' },
  'Number Files': { mode: 'regex', oldPattern: '(.*)', newPattern: '[####]', ignoreExtension: true, numberStart: 1, numberStep: 1 },
  'Time-Stamp Names': { mode: 'standard', oldPattern: '*', newPattern: '* - {date|yyyy-MM-dd} {time|HH-mm-ss}', ignoreExtension: true },
  'Underscores to Spaces': { mode: 'findreplace', oldPattern: '_', newPattern: ' ', ignoreExtension: true, replaceAll: true }
}

function RenameDialog({ entries }: { entries: FileEntry[] }) {
  const style = getState().info.platform === 'win32' ? 'win' : 'posix'
  const [opts, setOpts] = useState<RenameOptions>({
    mode: 'standard',
    oldPattern: '*',
    newPattern: '*',
    caseMode: 'none',
    ignoreExtension: false,
    numberStart: 1,
    numberStep: 1,
    numberPad: 0,
    replaceAll: true
  })
  const [presets, setPresets] = useState<Record<string, RenameOptions>>(() => {
    try {
      return getState().renamePresets as unknown as Record<string, RenameOptions>
    } catch {
      return {}
    }
  })
  const [presetName, setPresetName] = useState('')
  const preview = useMemo(() => previewRename(entries.map((e) => ({ name: e.name, mtime: e.mtime })), opts, style), [entries, opts, style])
  const changed = preview.filter((p) => p.changed && !p.error)
  const hasErrors = preview.some((p) => p.error)
  const set = (patch: Partial<RenameOptions>): void => setOpts((o) => ({ ...o, ...patch }))

  const apply = (): void => {
    const pairs = preview
      .map((p, i) => ({ p, e: entries[i] }))
      .filter(({ p }) => p.changed && !p.error)
      .map(({ p, e }) => ({ from: e.path, to: join(dirname(e.path) ?? '', p.newName) }))
    closeDialog(pairs)
  }

  return (
    <Modal
      title={`Advanced Rename — ${entries.length} item(s)`}
      wide
      testId="rename-dialog"
      footer={
        <>
          <select
            className="preset-select"
            value=""
            onChange={(e) => {
              const v = e.target.value
              const pr = presets[v] ?? BUILTIN_PRESETS[v]
              if (pr) setOpts({ ...opts, caseMode: 'none', ignoreExtension: false, ...pr })
            }}
          >
            <option value="">Presets…</option>
            {Object.keys(BUILTIN_PRESETS).map((k) => (
              <option key={`b-${k}`} value={k}>
                {k}
              </option>
            ))}
            {Object.keys(presets).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input className="preset-name" placeholder="Preset name" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
          <button
            className="btn"
            disabled={!presetName.trim()}
            onClick={() => {
              const next = { ...presets, [presetName.trim()]: opts }
              setPresets(next)
              A.saveRenamePresets(next as unknown as Record<string, Record<string, unknown>>)
              setPresetName('')
            }}
          >
            Save preset
          </button>
          <span className="spacer" />
          <span className="muted">{changed.length} will be renamed</span>
          <button className="btn" onClick={() => closeDialog(null)}>
            Cancel
          </button>
          <button className="btn primary" data-testid="rename-ok" disabled={!changed.length} onClick={apply}>
            Rename
          </button>
        </>
      }
    >
      <div className="rename-grid">
        <label className="field">
          <span>Mode</span>
          <select data-testid="rename-mode" value={opts.mode} onChange={(e) => set({ mode: e.target.value as RenameMode })}>
            <option value="standard">Standard wildcard (* and ?)</option>
            <option value="regex">Regular expression</option>
            <option value="findreplace">Find and replace</option>
          </select>
        </label>
        <label className="field">
          <span>Case</span>
          <select value={opts.caseMode} onChange={(e) => set({ caseMode: e.target.value as CaseMode })}>
            <option value="none">Unchanged</option>
            <option value="lower">lowercase</option>
            <option value="upper">UPPERCASE</option>
            <option value="title">Title Case</option>
            <option value="sentence">Sentence case</option>
            <option value="lowerExt">lowercase extension</option>
            <option value="upperExt">UPPERCASE extension</option>
          </select>
        </label>
        <label className="field">
          <span>{opts.mode === 'findreplace' ? 'Find' : 'Old name'}</span>
          <input data-testid="rename-old" value={opts.oldPattern} spellCheck={false} onChange={(e) => set({ oldPattern: e.target.value })} />
        </label>
        <label className="field">
          <span>{opts.mode === 'findreplace' ? 'Replace with' : 'New name'}</span>
          <input data-testid="rename-new" value={opts.newPattern} spellCheck={false} onChange={(e) => set({ newPattern: e.target.value })} />
        </label>
        <div className="field-row">
          <label className="check">
            <input type="checkbox" checked={!!opts.ignoreExtension} onChange={(e) => set({ ignoreExtension: e.target.checked })} /> Ignore extension
          </label>
          <label className="check">
            <input type="checkbox" checked={!!opts.caseSensitive} onChange={(e) => set({ caseSensitive: e.target.checked })} /> Case sensitive
          </label>
          {opts.mode === 'findreplace' && (
            <label className="check">
              <input type="checkbox" checked={opts.replaceAll !== false} onChange={(e) => set({ replaceAll: e.target.checked })} /> Replace all
            </label>
          )}
        </div>
        <div className="field-row">
          <span className="muted">Numbering [#]:</span>
          <label className="mini">
            start <input type="number" value={opts.numberStart} onChange={(e) => set({ numberStart: Number(e.target.value) })} />
          </label>
          <label className="mini">
            step <input type="number" value={opts.numberStep} onChange={(e) => set({ numberStep: Number(e.target.value) })} />
          </label>
          <label className="mini">
            pad <input type="number" min={0} max={10} value={opts.numberPad} onChange={(e) => set({ numberPad: Number(e.target.value) })} />
          </label>
        </div>
      </div>
      <div className="muted small">
        Macros: <code>[#]</code> counter (<code>[###]</code> = 3 digits), <code>{'{name}'}</code>, <code>{'{ext}'}</code>, <code>{'{date}'}</code>. Regex replacements use <code>$1</code>.
      </div>
      <div className="rename-preview" data-testid="rename-preview">
        <div className="rp-head">
          <span>Old name</span>
          <span>New name</span>
        </div>
        {preview.map((p, i) => (
          <div key={i} className={`rp-row${p.changed ? ' changed' : ''}${p.error ? ' err' : ''}`}>
            <span>{p.oldName}</span>
            <span title={p.error}>{p.error ? `⚠ ${p.error}` : p.newName}</span>
          </div>
        ))}
      </div>
      {hasErrors && <div className="error small">Some names have errors and will be skipped.</div>}
    </Modal>
  )
}

function FindDialog({ root: initialRoot, pattern: initialPattern, autostart }: { root: string; pattern: string; autostart?: boolean }) {
  const [root, setRoot] = useState(initialRoot)
  const [pattern, setPattern] = useState(initialPattern || '*')
  const [contains, setContains] = useState('')
  const [recursive, setRecursive] = useState(true)
  const [includeDirs, setIncludeDirs] = useState(true)
  const [minSize, setMinSize] = useState('')
  const [results, setResults] = useState<FileEntry[]>([])
  const [running, setRunning] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const prefs = getState().prefs
  const patternRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    patternRef.current?.focus()
    patternRef.current?.select()
    if (autostart) setTimeout(() => document.querySelector<HTMLButtonElement>('[data-testid="find-start"]')?.click(), 0)
    return window.opal.onFindResults((r) => {
      if (r.jobId === currentJob.current) setResults((prev) => [...prev, ...r.entries])
    })
  }, [])
  const currentJob = useRef<string | null>(null)

  const start = async (): Promise<void> => {
    if (running) await window.opal.cancelJob(running)
    const jobId = A.newJobId()
    currentJob.current = jobId
    setResults([])
    setDone(false)
    setRunning(jobId)
    const min = minSize ? Number(minSize) * 1024 : undefined
    try {
      await window.opal.find({ root, pattern, recursive, includeDirs, contains: contains || undefined, minSize: min, limit: 10000 }, jobId)
    } finally {
      if (currentJob.current === jobId) {
        setRunning(null)
        setDone(true)
      }
    }
  }

  const reveal = (e: FileEntry): void => {
    if (running) void window.opal.cancelJob(running)
    closeDialog(null)
    void A.navigate(getState().activePane, dirname(e.path) ?? e.path, { focusName: e.name })
  }

  return (
    <Modal
      title="Find Files"
      wide
      testId="find-dialog"
      footer={
        <>
          <span className="muted">
            {running ? 'Searching… ' : done ? 'Done. ' : ''}
            {results.length} result(s)
          </span>
          <span className="spacer" />
          {running && (
            <button className="btn" onClick={() => void window.opal.cancelJob(running)}>
              Stop
            </button>
          )}
          <button className="btn" onClick={() => closeDialog(null)}>
            Close
          </button>
          <button
            className="btn"
            data-help-title="Search by meaning"
            data-help-desc="Semantic search finds documents by what they are about, even with different words or in another language."
            onClick={() => {
              closeDialog(null)
              setTimeout(() => void A.openSemantic(root), 0)
            }}
          >
            ✦ By meaning…
          </button>
          <button className="btn primary" data-testid="find-start" onClick={() => void start()}>
            Search
          </button>
        </>
      }
    >
      <div className="find-grid">
        <label className="field">
          <span>Look in</span>
          <div className="row-flex">
            <input value={root} spellCheck={false} onChange={(e) => setRoot(e.target.value)} />
            <button className="btn" onClick={() => void window.opal.pickFolder().then((p) => p && setRoot(p))}>
              …
            </button>
          </div>
        </label>
        <label className="field">
          <span>Name (wildcard)</span>
          <input ref={patternRef} data-testid="find-pattern" value={pattern} spellCheck={false} onChange={(e) => setPattern(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void start()} />
        </label>
        <label className="field">
          <span>Containing text</span>
          <input value={contains} spellCheck={false} onChange={(e) => setContains(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void start()} />
        </label>
        <label className="field">
          <span>Min size (KB)</span>
          <input type="number" min={0} value={minSize} onChange={(e) => setMinSize(e.target.value)} />
        </label>
        <div className="field-row">
          <label className="check">
            <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} /> Search subfolders
          </label>
          <label className="check">
            <input type="checkbox" checked={includeDirs} onChange={(e) => setIncludeDirs(e.target.checked)} /> Include folders
          </label>
        </div>
      </div>
      <div className="find-results" data-testid="find-results">
        {results.slice(0, 2000).map((e) => (
          <div key={e.path} className="fr-row" title={e.path} onDoubleClick={() => reveal(e)}>
            <FileIcon path={e.path} isDir={e.isDir} />
            <span className="fr-name">{e.name}</span>
            <span className="fr-dir muted">{dirname(e.path)}</span>
            <span className="fr-size">{e.isDir ? '' : formatSize(e.size, prefs.sizeUnits)}</span>
          </div>
        ))}
        {results.length > 2000 && <div className="muted pad">Showing first 2000 results</div>}
      </div>
      <div className="muted small">Double-click a result to show it in the source pane.</div>
    </Modal>
  )
}

function toLocalInput(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function PropertiesDialog({ entries }: { entries: FileEntry[] }) {
  const prefs = getState().prefs
  const single = entries.length === 1 ? entries[0] : null
  const [size, setSize] = useState<{ bytes: number; files: number; dirs: number } | null>(null)
  const [readonly, setReadonly] = useState<boolean | 'mixed'>(() => {
    const ro = entries.filter((e) => e.readonly).length
    return ro === 0 ? false : ro === entries.length ? true : 'mixed'
  })
  const [mtime, setMtime] = useState(single ? toLocalInput(single.mtime) : '')
  const [error, setError] = useState<string | null>(null)
  const [hash, setHash] = useState<{ algo: string; value: string } | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      let bytes = 0
      let files = 0
      let dirs = 0
      for (const e of entries) {
        if (e.isDir) {
          const r = await window.opal.folderSize(e.path, A.newJobId())
          bytes += r.bytes
          files += r.files
          dirs += r.dirs + 1
        } else {
          bytes += e.size
          files++
        }
      }
      if (alive) setSize({ bytes, files, dirs })
    })()
    return () => {
      alive = false
    }
  }, [entries])

  const apply = async (): Promise<void> => {
    try {
      for (const e of entries) {
        const attrs: { readonly?: boolean; mtime?: number } = {}
        if (readonly !== 'mixed' && readonly !== e.readonly) attrs.readonly = readonly
        if (single && mtime && toLocalInput(single.mtime) !== mtime) attrs.mtime = new Date(mtime).getTime()
        if (Object.keys(attrs).length) await window.opal.setAttr(e.path, attrs)
      }
      closeDialog(true)
    } catch (e) {
      setError(A.cleanError(e))
    }
  }

  return (
    <Modal
      title={single ? `Properties — ${single.name}` : `Properties — ${entries.length} items`}
      testId="properties-dialog"
      footer={
        <>
          <button className="btn" onClick={() => closeDialog(null)}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void apply()}>
            Apply
          </button>
        </>
      }
    >
      <table className="props-table">
        <tbody>
          {single && (
            <>
              <tr>
                <th>Name</th>
                <td>{single.name}</td>
              </tr>
              <tr>
                <th>Location</th>
                <td className="selectable">{dirname(single.path)}</td>
              </tr>
              <tr>
                <th>Type</th>
                <td>{fileTypeLabel(single)}{single.isSymlink ? ' (link)' : ''}</td>
              </tr>
            </>
          )}
          <tr>
            <th>Size</th>
            <td>
              {size ? `${formatSize(size.bytes, prefs.sizeUnits)} (${size.bytes.toLocaleString()} bytes)` : 'Calculating…'}
              {size && (size.dirs > 0 || entries.length > 1) && <div className="muted">{size.files} files, {size.dirs} folders</div>}
            </td>
          </tr>
          {single && (
            <>
              <tr>
                <th>Created</th>
                <td>{formatDate(single.ctime, prefs.dateFormat)}</td>
              </tr>
              <tr>
                <th>Modified</th>
                <td>
                  <input type="datetime-local" value={mtime} onChange={(e) => setMtime(e.target.value)} />
                </td>
              </tr>
              <tr>
                <th>Accessed</th>
                <td>{formatDate(single.atime, prefs.dateFormat)}</td>
              </tr>
            </>
          )}
          <tr>
            <th>Attributes</th>
            <td>
              <label className="check">
                <input
                  type="checkbox"
                  checked={readonly === true}
                  ref={(el) => {
                    if (el) el.indeterminate = readonly === 'mixed'
                  }}
                  onChange={(e) => setReadonly(e.target.checked)}
                />{' '}
                Read-only
              </label>
              {entries.some((e) => e.hidden) && <span className="muted"> · hidden</span>}
            </td>
          </tr>
          {single && !single.isDir && (
            <tr>
              <th>Checksum</th>
              <td>
                <div className="field-row">
                  {(['md5', 'sha1', 'sha256'] as const).map((algo) => (
                    <button
                      key={algo}
                      className="btn"
                      onClick={() => {
                        setHash({ algo, value: 'Calculating…' })
                        void window.opal.hash(single.path, algo).then((value) => setHash({ algo, value }), (e) => setHash({ algo, value: A.cleanError(e) }))
                      }}
                    >
                      {algo.toUpperCase()}
                    </button>
                  ))}
                </div>
                {hash && (
                  <div className="selectable mono small" data-testid="hash-value">
                    {hash.algo.toUpperCase()}: {hash.value}
                  </div>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {error && <div className="error small">{error}</div>}
    </Modal>
  )
}

export function Check({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <label className="check" data-testid={testId}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  )
}

const STATUS_LABEL: Record<SyncItem['status'], string> = {
  leftOnly: 'Only in source',
  rightOnly: 'Only in destination',
  leftNewer: 'Source newer',
  rightNewer: 'Destination newer',
  sizeDiffers: 'Size differs',
  same: 'Identical'
}

function SyncDialog({ left, right }: { left: string; right: string }) {
  const [recursive, setRecursive] = useState(true)
  const [items, setItems] = useState<SyncItem[] | null>(null)
  const [hideSame, setHideSame] = useState(true)
  const [busy, setBusy] = useState(false)
  const sep = getState().info.sep

  const compare = async (): Promise<void> => {
    setBusy(true)
    try {
      setItems(await window.opal.compare(left, right, recursive))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void compare()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recursive])

  const shown = (items ?? []).filter((i) => !hideSame || i.status !== 'same')

  const copyDirection = async (dir: 'ltr' | 'rtl'): Promise<void> => {
    if (!items) return
    const [from, to] = dir === 'ltr' ? [left, right] : [right, left]
    const want = dir === 'ltr' ? ['leftOnly', 'leftNewer', 'sizeDiffers'] : ['rightOnly', 'rightNewer']
    const selected = items.filter((i) => want.includes(i.status))
    // Skip children of folders that are copied whole.
    const wholeDirs = selected.filter((i) => i.isDir).map((i) => i.rel + sep)
    const effective = selected.filter((i) => !wholeDirs.some((d) => i.rel.startsWith(d)))
    const groups = new Map<string, string[]>()
    for (const i of effective) {
      const relDir = i.rel.includes(sep) ? i.rel.slice(0, i.rel.lastIndexOf(sep)) : ''
      const destDir = relDir ? join(to, relDir) : to
      const arr = groups.get(destDir) ?? []
      arr.push(join(from, i.rel))
      groups.set(destDir, arr)
    }
    setBusy(true)
    try {
      for (const [destDir, sources] of groups) await A.transferItems('copy', sources, destDir, 'overwrite')
    } finally {
      setBusy(false)
    }
    await compare()
  }

  return (
    <Modal
      title="Synchronize"
      wide
      testId="sync-dialog"
      footer={
        <>
          <label className="check">
            <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} /> Subfolders
          </label>
          <label className="check">
            <input type="checkbox" checked={hideSame} onChange={(e) => setHideSame(e.target.checked)} /> Hide identical
          </label>
          <span className="spacer" />
          <button className="btn" disabled={busy} data-testid="sync-ltr" onClick={() => void copyDirection('ltr')}>
            Copy source → dest
          </button>
          <button className="btn" disabled={busy} data-testid="sync-rtl" onClick={() => void copyDirection('rtl')}>
            Copy dest → source
          </button>
          <button className="btn primary" onClick={() => closeDialog(null)}>
            Close
          </button>
        </>
      }
    >
      <div className="sync-paths">
        <div>
          <b>Source:</b> {left}
        </div>
        <div>
          <b>Destination:</b> {right}
        </div>
      </div>
      <div className="sync-list" data-testid="sync-list">
        {busy && !items && <div className="muted pad">Comparing…</div>}
        {items && shown.length === 0 && <div className="muted pad">Folders are in sync</div>}
        {shown.slice(0, 3000).map((i) => (
          <div key={i.rel} className={`sync-row st-${i.status}`}>
            <span className="sync-rel">{i.rel}{i.isDir ? sep : ''}</span>
            <span className="sync-status">{STATUS_LABEL[i.status]}</span>
            <span className="muted">{i.leftSize !== undefined && !i.isDir ? formatSize(i.leftSize) : ''}</span>
            <span className="muted">{i.rightSize !== undefined && !i.isDir ? formatSize(i.rightSize) : ''}</span>
          </div>
        ))}
      </div>
      <div className="muted small">{basename(left)} ⇄ {basename(right)}</div>
    </Modal>
  )
}

function DuplicatesDialog({ root }: { root: string }) {
  const [minKb, setMinKb] = useState('0')
  const [groups, setGroups] = useState<{ size: number; hash: string; paths: string[] }[] | null>(null)
  const [job, setJob] = useState<string | null>(null)
  const [marked, setMarked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const scan = async (): Promise<void> => {
    const id = A.newJobId()
    setJob(id)
    setGroups(null)
    setMarked(new Set())
    try {
      const res = await window.opal.duplicates(root, { minSize: Math.max(1, Number(minKb) * 1024 || 1), recursive: true }, id)
      setGroups(res)
    } finally {
      setJob(null)
    }
  }
  useEffect(() => {
    void scan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const wasted = (groups ?? []).reduce((a, g) => a + g.size * (g.paths.length - 1), 0)
  const toggle = (p: string): void =>
    setMarked((prev) => {
      const n = new Set(prev)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })
  const markAllButFirst = (): void => setMarked(new Set((groups ?? []).flatMap((g) => g.paths.slice(1))))

  const deleteMarked = async (): Promise<void> => {
    if (!marked.size) return
    setBusy(true)
    const errors = await window.opal.remove([...marked], getState().prefs.useTrash)
    setBusy(false)
    if (errors.length) toast(`Delete: ${errors.length} error(s): ${errors[0]}`, 'error')
    await scan()
  }

  return (
    <Modal
      title="Duplicate File Finder"
      wide
      testId="duplicates-dialog"
      footer={
        <>
          <span className="muted">
            {job ? 'Scanning…' : groups ? `${groups.length} group(s) · ${formatSize(wasted)} reclaimable` : ''}
          </span>
          <span className="spacer" />
          <button className="btn" disabled={!groups?.length} onClick={markAllButFirst}>
            Mark all but first
          </button>
          <button className="btn danger" disabled={!marked.size || busy} data-testid="dupes-delete" onClick={() => void deleteMarked()}>
            Delete {marked.size || ''} marked
          </button>
          <button className="btn primary" onClick={() => closeDialog(null)}>
            Close
          </button>
        </>
      }
    >
      <div className="field-row">
        <span className="muted">Folder:</span> <span className="selectable">{root}</span>
        <span className="spacer" />
        <label className="mini">
          min size (KB) <input type="number" min={0} value={minKb} onChange={(e) => setMinKb(e.target.value)} />
        </label>
        <button className="btn" disabled={!!job} onClick={() => void scan()}>
          Rescan
        </button>
      </div>
      <div className="sync-list" data-testid="dupes-list">
        {groups && groups.length === 0 && <div className="muted pad">No duplicates found</div>}
        {(groups ?? []).slice(0, 500).map((g) => (
          <div key={g.hash} className="dupe-group">
            <div className="dupe-head">
              {formatSize(g.size)} × {g.paths.length} <span className="muted">{g.hash.slice(0, 12)}…</span>
            </div>
            {g.paths.map((p) => (
              <label key={p} className="check dupe-row">
                <input type="checkbox" checked={marked.has(p)} onChange={() => toggle(p)} />
                <span className="selectable">{p}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  )
}

function NestedDialog({ op, count }: { op: string; count: number }) {
  return (
    <Modal
      title={op === 'move' ? 'Moving nested items' : 'Copying nested items'}
      testId="nested-dialog"
      footer={
        <>
          <button className="btn" onClick={() => closeDialog(null)}>
            Cancel
          </button>
          <button className="btn" data-testid="nested-single" onClick={() => closeDialog('single')}>
            Single level
          </button>
          <button className="btn primary" data-testid="nested-structure" onClick={() => closeDialog('structure')}>
            Recreate folder structure
          </button>
        </>
      }
    >
      <p>
        You are {op === 'move' ? 'moving' : 'copying'} {count} items from different folders (Flat View or expanded folders).
      </p>
      <p className="muted">Recreate the source folder structure in the destination, or put all items into a single folder?</p>
    </Modal>
  )
}

function HelpDialog() {
  const hotkeys = useStore((s) => s.hotkeys)
  return (
    <Modal title="Commands & Hotkeys" wide testId="help-dialog" footer={<button className="btn primary" onClick={() => closeDialog(null)}>Close</button>}>
      <div className="help-cols">
        <div>
          <h4>Hotkeys</h4>
          <table className="help-table">
            <tbody>
              {Object.entries(hotkeys).map(([k, v]) => (
                <tr key={k}>
                  <td>
                    <kbd>{k}</kbd>
                  </td>
                  <td>
                    <code>{v}</code>
                  </td>
                </tr>
              ))}
              <tr>
                <td><kbd>Arrows / PgUp / PgDn / Home / End</kbd></td>
                <td>Move (Shift extends, Ctrl moves focus only)</td>
              </tr>
              <tr>
                <td><kbd>Space</kbd></td>
                <td>Toggle selection</td>
              </tr>
              <tr>
                <td><kbd>Enter</kbd></td>
                <td>Open (folder or file)</td>
              </tr>
              <tr>
                <td><kbd>Typing</kbd></td>
                <td>Find-as-you-type; <kbd>&gt;</kbd> opens the command line</td>
              </tr>
              <tr>
                <td><kbd>Details: → ← (Alt+↓ Alt+↑)</kbd></td>
                <td>Expand / collapse folders in place (expandable folders)</td>
              </tr>
              <tr>
                <td><kbd>Tree: ← → ↑ ↓ + - * Enter</kbd></td>
                <td>Collapse / expand / move / expand / collapse / expand all / open</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h4>Internal commands</h4>
          {COMMAND_DOCS.map((d) => (
            <div key={d.name} className="help-cmd">
              <code>{d.usage}</code>
              <div className="muted">{d.description}</div>
            </div>
          ))}
          <h4>Placeholders</h4>
          <div className="muted">
            <code>{'{sourcepath}'}</code> <code>{'{destpath}'}</code> <code>{'{filepath}'}</code> <code>{'{file}'}</code> <code>{'{allfilepath}'}</code>
          </div>
          <h4>Wildcards</h4>
          <div className="muted">
            <code>*</code> any · <code>?</code> one char · <code>[a-z]</code> set · <code>(a|b)</code> either · <code>~(x)</code> not · <code>#x</code> repeat ·{' '}
            <code>a;b</code> list · <code>regex:…</code>
          </div>
        </div>
      </div>
    </Modal>
  )
}
