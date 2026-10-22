import { useState } from 'react'
import {
  Palette,
  MousePointerClick,
  Columns3,
  PanelTop,
  Keyboard,
  Sparkles,
  ArchiveRestore,
  Check as CheckIcon,
  ChevronUp,
  ChevronDown,
  FolderPlus,
  X,
  Monitor,
  Moon,
  Sun,
  Rows2,
  Columns2,
  FolderTree,
  PanelRight,
  Image,
  LayoutPanelLeft
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { closeDialog, useStore } from '../state/store'
import * as A from '../state/actions'
import { comboFromEvent, defaultHotkeys } from '../state/commands'
import type { GroupBy, LayoutPreset, Prefs, ViewMode } from '@shared/types'
import { formatDate } from '@shared/format'
import { basename } from '@shared/paths'
import { ALL_COLUMNS, COLS, GROUP_OPTIONS } from './FileList'
import { DEFAULT_TOOLBAR, TOOLBAR_BUTTONS } from './Toolbar'
import { Check, Modal } from './Dialogs'

export const ACCENTS = ['#4c8dff', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f', '#ff9f0a', '#30d158', '#64d2ff', '#ac8e68', '#8e8e93']

const FONTS: { id: string; label: string }[] = [
  { id: '', label: 'System default' },
  { id: "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif", label: 'Segoe UI' },
  { id: "-apple-system, 'SF Pro Text', system-ui, sans-serif", label: 'San Francisco' },
  { id: "Inter, 'Helvetica Neue', Arial, sans-serif", label: 'Inter / Helvetica' },
  { id: "Ubuntu, Cantarell, 'Noto Sans', sans-serif", label: 'Ubuntu / Noto' },
  { id: "'Cascadia Code', 'JetBrains Mono', Consolas, Menlo, monospace", label: 'Monospace' }
]

type Section = 'appearance' | 'behaviour' | 'lists' | 'toolbar' | 'keys' | 'search' | 'backup'

const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'behaviour', label: 'Behaviour', icon: MousePointerClick },
  { id: 'lists', label: 'Folders & columns', icon: Columns3 },
  { id: 'toolbar', label: 'Toolbar', icon: PanelTop },
  { id: 'keys', label: 'Keyboard', icon: Keyboard },
  { id: 'search', label: 'Semantic search', icon: Sparkles },
  { id: 'backup', label: 'Backup & reset', icon: ArchiveRestore }
]

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="pref-row" data-help-title={desc ? label : undefined} data-help-desc={desc}>
      <div className="pref-label">
        <div>{label}</div>
        {desc && <div className="muted small">{desc}</div>}
      </div>
      <div className="pref-control">{children}</div>
    </div>
  )
}

function Segmented<T extends string>({ value, options, onChange, testId }: { value: T; options: { id: T; label: string; icon?: LucideIcon }[]; onChange: (v: T) => void; testId?: string }) {
  return (
    <div className="segmented" data-testid={testId}>
      {options.map((o) => (
        <button key={o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.icon && <o.icon size={13} />} {o.label}
        </button>
      ))}
    </div>
  )
}

export function AccentPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="accent-picker" data-testid="accent-picker">
      {ACCENTS.map((c) => (
        <button key={c} className={`swatch${value.toLowerCase() === c ? ' on' : ''}`} style={{ background: c }} title={c} onClick={() => onChange(c)}>
          {value.toLowerCase() === c && <CheckIcon size={12} />}
        </button>
      ))}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} title="Custom colour" />
    </div>
  )
}

export function PrefsDialog() {
  const prefs = useStore((s) => s.prefs)
  const hotkeys = useStore((s) => s.hotkeys)
  const semantic = useStore((s) => s.semantic)
  const folderFormats = useStore((s) => s.folderFormats)
  const snapshot = useStore((s) => s)
  const [section, setSection] = useState<Section>('appearance')
  const [hk, setHk] = useState(() => Object.entries(hotkeys))
  const [hkFilter, setHkFilter] = useState('')
  const set = (patch: Partial<Prefs>): void => A.setPrefs(patch)
  const saveHotkeys = (): void => {
    A.saveHotkeys(Object.fromEntries(hk.filter(([k, v]) => k.trim() && v.trim())))
  }
  const toolbarIds = prefs.toolbarButtons.length ? prefs.toolbarButtons : DEFAULT_TOOLBAR
  const moveTb = (id: string, d: number): void => {
    const ids = [...toolbarIds]
    const i = ids.indexOf(id)
    const j = i + d
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    set({ toolbarButtons: ids })
  }

  return (
    <Modal
      title="Preferences"
      wide
      testId="prefs-dialog"
      footer={
        <>
          <span className="muted small">Changes apply immediately.</span>
          <span className="spacer" />
          <button
            className="btn primary"
            data-testid="prefs-close"
            onClick={() => {
              if (section === 'keys') saveHotkeys()
              closeDialog(true)
            }}
          >
            Done
          </button>
        </>
      }
    >
      <div className="prefs-layout">
        <nav className="prefs-nav">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              data-testid={`prefs-tab-${s.id}`}
              className={section === s.id ? 'on' : ''}
              onClick={() => {
                if (section === 'keys') saveHotkeys()
                setSection(s.id)
              }}
            >
              <s.icon size={15} /> {s.label}
            </button>
          ))}
        </nav>
        <div className="prefs-body">
          {section === 'appearance' && (
            <>
              <Row label="Theme" desc="System follows the light/dark setting of your operating system">
                <Segmented
                  testId="theme-select"
                  value={prefs.theme}
                  onChange={(v) => set({ theme: v })}
                  options={[
                    { id: 'system', label: 'System', icon: Monitor },
                    { id: 'dark', label: 'Dark', icon: Moon },
                    { id: 'light', label: 'Light', icon: Sun }
                  ]}
                />
              </Row>
              <Row label="Accent colour" desc="Used for selection, focus and highlights">
                <AccentPicker value={prefs.accent} onChange={(c) => set({ accent: c })} />
              </Row>
              <Row label="Density" desc="Height of rows in lists and the tree">
                <Segmented
                  value={prefs.density}
                  onChange={(v) => set({ density: v })}
                  options={[
                    { id: 'compact', label: 'Compact' },
                    { id: 'normal', label: 'Normal' },
                    { id: 'comfortable', label: 'Comfortable' }
                  ]}
                />
              </Row>
              <Row label="Interface font">
                <select value={prefs.uiFont} onChange={(e) => set({ uiFont: e.target.value })}>
                  {FONTS.map((f) => (
                    <option key={f.label} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Text size in file lists" desc="Same as Ctrl+= / Ctrl+- / Ctrl+0">
                <input type="range" min={70} max={180} step={5} value={prefs.fontScale} onChange={(e) => set({ fontScale: Number(e.target.value) })} />
                <span className="muted"> {prefs.fontScale}%</span>
              </Row>
              <Row label="List decorations">
                <Check label="Alternating row stripes" checked={prefs.stripes} onChange={(v) => set({ stripes: v })} />
                <Check label="Grid lines between columns" checked={prefs.gridLines} onChange={(v) => set({ gridLines: v })} />
                <Check label="Status bar under each file display" checked={prefs.showStatusBar} onChange={(v) => set({ showStatusBar: v })} />
              </Row>
              <Row label="Window layout" desc="Quick presets for panes, tree and viewer">
                <LayoutPicker onPick={(l) => A.applyLayout(l)} />
              </Row>
            </>
          )}
          {section === 'behaviour' && (
            <>
              <Row label="Space bar" desc="Finder-style Quick Look, or toggle selection like classic file managers (Shift+Space / Insert always toggle)">
                <Segmented
                  value={prefs.spaceAction}
                  onChange={(v) => set({ spaceAction: v })}
                  options={[
                    { id: 'quicklook', label: 'Quick Look' },
                    { id: 'select', label: 'Toggle selection' }
                  ]}
                />
              </Row>
              <Row label="Opening items">
                <Check label="Single click opens files and folders" checked={prefs.singleClickOpen} onChange={(v) => set({ singleClickOpen: v })} />
              </Row>
              <Row label="Helpers" desc="Cards that appear beside buttons, menu items and files, never on top of them">
                <Check label="Explain buttons, columns and menu items" checked={prefs.helpers} onChange={(v) => set({ helpers: v })} />
                <Check label="File infotips (kind, size, dates, dimensions)" checked={prefs.infotips} onChange={(v) => set({ infotips: v })} />
                <label className="mini">
                  delay{' '}
                  <input type="number" min={0} max={3000} step={50} value={prefs.helperDelay} onChange={(e) => set({ helperDelay: Number(e.target.value) })} /> ms
                </label>
              </Row>
              <Row label="Deleting">
                <Check label="Ask for confirmation" checked={prefs.confirmDelete} onChange={(v) => set({ confirmDelete: v })} />
                <Check label="Move to trash / recycle bin instead of deleting" checked={prefs.useTrash} onChange={(v) => set({ useTrash: v })} />
              </Row>
              <Row label="Expandable folders" desc="Open folders in place inside Details view with → and ←">
                <Check label="Make folders expandable" checked={prefs.expandableFolders} onChange={(v) => set({ expandableFolders: v })} />
                <Check label="Clear selections within collapsed folders" checked={prefs.collapseClearsSelection} onChange={(v) => set({ collapseClearsSelection: v })} />
                <Check label="Collapse sub-folders within collapsed folders" checked={prefs.collapseSubfolders} onChange={(v) => set({ collapseSubfolders: v })} />
              </Row>
              <Row label="At startup">
                <Segmented
                  value={prefs.startup}
                  onChange={(v) => set({ startup: v })}
                  options={[
                    { id: 'restore', label: 'Restore last session' },
                    { id: 'folders', label: 'Open these folders' }
                  ]}
                />
                {prefs.startup === 'folders' && (
                  <div className="startup-folders">
                    <FolderField label="Left" value={prefs.startupLeft} onChange={(v) => set({ startupLeft: v })} />
                    <FolderField label="Right" value={prefs.startupRight} onChange={(v) => set({ startupRight: v })} />
                  </div>
                )}
              </Row>
            </>
          )}
          {section === 'lists' && (
            <>
              <Row label="Default view for new tabs">
                <select value={prefs.defaultViewMode} onChange={(e) => set({ defaultViewMode: e.target.value as ViewMode })}>
                  <option value="details">Details</option>
                  <option value="list">List</option>
                  <option value="icons">Icons</option>
                  <option value="thumbnails">Thumbnails</option>
                  <option value="columns">Columns (Finder)</option>
                </select>
              </Row>
              <Row label="Folders" desc="Where folders appear relative to files">
                <Segmented
                  value={prefs.folderPlacement}
                  onChange={(v) => set({ folderPlacement: v })}
                  options={[
                    { id: 'first', label: 'Before files' },
                    { id: 'mixed', label: 'Mixed' },
                    { id: 'last', label: 'After files' }
                  ]}
                />
              </Row>
              <Row label="Sorting">
                <Check label="Natural number order (file2 before file10)" checked={prefs.naturalSort} onChange={(v) => set({ naturalSort: v })} />
                <Check label="Remember view, sorting and grouping per folder" checked={prefs.rememberFolderFormats} onChange={(v) => set({ rememberFolderFormats: v })} />
                <button className="btn" disabled={!Object.keys(folderFormats).length} onClick={() => A.clearFolderFormats()}>
                  Forget {Object.keys(folderFormats).length} remembered folder format(s)
                </button>
              </Row>
              <Row label="Names">
                <Check label="Show file extensions" checked={prefs.showExtensions} onChange={(v) => set({ showExtensions: v })} />
                <Check label="Show hidden and system files" checked={prefs.showHidden} onChange={(v) => set({ showHidden: v })} />
              </Row>
              <Row label="Dates" desc={`Example: ${formatDate(Date.now() - 3_600_000 * 5, prefs.dateFormat, prefs.customDateFormat)}`}>
                <select value={prefs.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as Prefs['dateFormat'] })}>
                  <option value="locale">System locale</option>
                  <option value="relative">Relative (Today 14:05, Yesterday…)</option>
                  <option value="iso">ISO (2026-10-20 14:05)</option>
                  <option value="custom">Custom…</option>
                </select>
                {prefs.dateFormat === 'custom' && (
                  <input value={prefs.customDateFormat} onChange={(e) => set({ customDateFormat: e.target.value })} title="Tokens: yyyy yy MM M dd d HH H hh h mm ss tt" />
                )}
              </Row>
              <Row label="Sizes">
                <select value={prefs.sizeUnits} onChange={(e) => set({ sizeUnits: e.target.value as Prefs['sizeUnits'] })}>
                  <option value="auto">Automatic (KB, MB, GB)</option>
                  <option value="bytes">Exact bytes</option>
                </select>
              </Row>
              <Row label="Columns in Details view" desc="Drag column headers to reorder them; double-click a header edge to fit its width">
                <div className="col-grid">
                  {ALL_COLUMNS.filter((c) => c !== 'name').map((c) => (
                    <label key={c} className="check" data-help-title={COLS[c].label} data-help-desc={COLS[c].desc}>
                      <input
                        type="checkbox"
                        checked={prefs.columns.includes(c)}
                        onChange={(e) => set({ columns: e.target.checked ? [...prefs.columns, c] : prefs.columns.filter((x) => x !== c) })}
                      />{' '}
                      {COLS[c].label}
                    </label>
                  ))}
                </div>
              </Row>
              <Row label="Group current folder by">
                <select onChange={(e) => A.setFormat(A.sourcePaneIndex(), { groupBy: e.target.value as GroupBy })} defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {GROUP_OPTIONS.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </Row>
            </>
          )}
          {section === 'toolbar' && (
            <>
              <Row label="Button labels">
                <Check label="Show text under the icons" checked={prefs.toolbarLabels} onChange={(v) => set({ toolbarLabels: v })} />
              </Row>
              <div className="tb-editor" data-testid="toolbar-editor">
                {TOOLBAR_BUTTONS.map((b) => {
                  const on = toolbarIds.includes(b.id)
                  const Icon = b.icon(snapshot)
                  return (
                    <div key={b.id} className={`tb-edit-row${on ? ' on' : ''}`}>
                      <label className="check">
                        <input type="checkbox" checked={on} onChange={(e) => set({ toolbarButtons: e.target.checked ? [...toolbarIds, b.id] : toolbarIds.filter((x) => x !== b.id) })} />
                        <Icon size={15} /> <b>{b.label}</b>
                      </label>
                      <span className="muted small">{b.desc}</span>
                      {on && (
                        <span className="tb-move">
                          <button className="icon-btn" title="Move left" onClick={() => moveTb(b.id, -1)}>
                            <ChevronUp size={13} />
                          </button>
                          <button className="icon-btn" title="Move right" onClick={() => moveTb(b.id, 1)}>
                            <ChevronDown size={13} />
                          </button>
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              <button className="btn" onClick={() => set({ toolbarButtons: [] })}>
                Restore default toolbar
              </button>
            </>
          )}
          {section === 'keys' && (
            <>
              <Row label="Keymap" desc="Default key bindings; you can still change any key below">
                <select
                  data-testid="keymap-select"
                  value={prefs.keymap}
                  onChange={(e) => {
                    set({ keymap: e.target.value as Prefs['keymap'] })
                    setHk(Object.entries(defaultHotkeys(e.target.value as Prefs['keymap'])))
                  }}
                >
                  <option value="standard">Standard (Ctrl+1/2/3 copy/move/rename, F6 dual, F7 viewer…)</option>
                  <option value="commander">Commander style (F5/F6 copy, F7 new folder, F8 delete…)</option>
                </select>
              </Row>
              <input className="hk-filter" placeholder="Filter keys or commands…" value={hkFilter} onChange={(e) => setHkFilter(e.target.value)} />
              <div className="hotkey-table">
                {hk.map(([k, v], i) =>
                  hkFilter && !`${k} ${v}`.toLowerCase().includes(hkFilter.toLowerCase()) ? null : (
                    <div key={i} className="hk-row">
                      <KeyCapture value={k} onChange={(nk) => setHk((prev) => prev.map((p, j) => (j === i ? [nk, p[1]] : p)))} />
                      <input value={v} onChange={(e) => setHk((prev) => prev.map((p, j) => (j === i ? [p[0], e.target.value] : p)))} />
                      <button className="icon-btn" title="Remove" onClick={() => setHk((prev) => prev.filter((_, j) => j !== i))}>
                        <X size={13} />
                      </button>
                    </div>
                  )
                )}
              </div>
              <div className="field-row">
                <button className="btn" onClick={() => setHk((prev) => [...prev, ['', '']])}>
                  Add key
                </button>
                <button className="btn" onClick={() => setHk(Object.entries(defaultHotkeys(prefs.keymap)))}>
                  Restore defaults
                </button>
                <button className="btn primary" onClick={saveHotkeys}>
                  Save keys
                </button>
              </div>
            </>
          )}
          {section === 'search' && (
            <>
              <div className="sem-intro">
                <Sparkles size={18} />
                <div>
                  <b>Search documents by meaning.</b> A small multilingual AI model runs on this computer and understands what your documents are about, so
                  “boiler invoice” finds “fattura manutenzione caldaia”. Nothing is sent online; the models (≈120 MB, plus ≈115 MB for precise ranking) are downloaded once.
                </div>
              </div>
              <Row label="Indexed folders" desc="PDF, Word, Excel, PowerPoint, OpenDocument, RTF, EPUB, e-mail (.eml), web pages, text and Markdown">
                <div className="sem-folders">
                  {prefs.semanticFolders.length === 0 && <span className="muted">None yet</span>}
                  {prefs.semanticFolders.map((f) => (
                    <span key={f} className="chip" title={f}>
                      {basename(f) || f}
                      <button className="chip-x" onClick={() => void A.setSemanticFolders(prefs.semanticFolders.filter((x) => x !== f))}>
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  <button
                    className="btn"
                    onClick={() => void window.opal.pickFolder().then((p) => (p ? A.addSemanticFolder(p) : undefined))}
                  >
                    <FolderPlus size={14} /> Add folder…
                  </button>
                </div>
              </Row>
              <Row label="Keep the index up to date">
                <Check label="Re-scan the folders when Opal starts" checked={prefs.semanticAutoIndex} onChange={(v) => set({ semanticAutoIndex: v })} />
              </Row>
              <Row label="Precise ranking" desc="A second model reads the query together with each candidate passage. Far fewer wrong results; searches take about a second.">
                <Check
                  label="Rerank results with the precision model"
                  testId="pref-semantic-precise"
                  checked={prefs.semanticPrecise}
                  onChange={(v) => {
                    set({ semanticPrecise: v })
                    void window.opal.semanticSetOptions({ rerank: v })
                  }}
                />
              </Row>
              <Row label="Source code" desc="Off by default: code, logs and data files drown real documents in the results.">
                <Check
                  label="Also index source code files"
                  checked={prefs.semanticIncludeCode}
                  onChange={(v) => {
                    set({ semanticIncludeCode: v })
                    void window.opal.semanticSetOptions({ includeCode: v })
                  }}
                />
              </Row>
              <Row label="Status">
                <div className="small">
                  {semantic
                    ? `${semantic.indexedFiles} documents, ${semantic.indexedChunks} passages · model ${semantic.modelState}${prefs.semanticPrecise ? ` · precision model ${semantic.rerankState}` : ''}${semantic.indexing ? ` · indexing ${semantic.done} of ${semantic.total}` : ''}`
                    : '—'}
                </div>
                <div className="field-row">
                  <button className="btn" onClick={() => void window.opal.semanticRescan()}>
                    Update now
                  </button>
                  <button className="btn" onClick={() => void window.opal.semanticCancel()} disabled={!semantic?.indexing}>
                    Stop
                  </button>
                  <button className="btn danger" onClick={() => void window.opal.semanticClear()}>
                    Delete index
                  </button>
                </div>
              </Row>
            </>
          )}
          {section === 'backup' && (
            <>
              <Row
                label="Export settings"
                desc="Preferences, keys, toolbar, favorites, labels, folder formats, rename presets, semantic search folders and window layout in one file. Works across Windows, macOS and Linux."
              >
                <button
                  className="btn"
                  data-testid="prefs-export"
                  onClick={() =>
                    void window.opal
                      .exportSettings()
                      .then((p) => p && A.toastMsg(`Settings saved to ${p}`))
                      .catch((e) => A.toastMsg(`Export failed: ${A.cleanError(e)}`, 'error'))
                  }
                >
                  Export…
                </button>
              </Row>
              <Row label="Import settings" desc="Replaces the current settings (open tabs and recent folders are kept) and reloads the window">
                <button
                  className="btn"
                  data-testid="prefs-import"
                  onClick={() => void window.opal.importSettings().catch((e) => A.toastMsg(`Import failed: ${A.cleanError(e)}`, 'error'))}
                >
                  Import…
                </button>
              </Row>
              <Row label="Setup assistant" desc="Run the first-start wizard again">
                <button
                  className="btn"
                  onClick={() => {
                    closeDialog(true)
                    setTimeout(() => void A.runSetup(), 0)
                  }}
                >
                  Run setup…
                </button>
              </Row>
              <Row label="Reset" desc="Restore every preference to its default (favorites and labels are kept)">
                <button className="btn danger" onClick={() => A.resetToDefaults()}>
                  Reset preferences
                </button>
              </Row>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

function FolderField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="row-flex">
      <span className="muted small" style={{ width: 40 }}>
        {label}
      </span>
      <input value={value} placeholder="Home folder" onChange={(e) => onChange(e.target.value)} />
      <button className="btn" onClick={() => void window.opal.pickFolder().then((p) => p && onChange(p))}>
        …
      </button>
    </div>
  )
}

/** Click, then press a key combination to record it. */
function KeyCapture({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false)
  return (
    <button
      className={`key-capture${recording ? ' rec' : ''}`}
      title="Click and press a key combination"
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(e) => {
        if (!recording) return
        e.preventDefault()
        e.stopPropagation()
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
        // Same rules as the live key handler, so a recorded key always matches.
        onChange(comboFromEvent(e.nativeEvent))
        setRecording(false)
      }}
    >
      {recording ? 'Press keys…' : value || '—'}
    </button>
  )
}

const LAYOUTS: { id: LayoutPreset; label: string; icon: LucideIcon; desc: string }[] = [
  { id: 'dualVertical', label: 'Dual side by side', icon: Columns2, desc: 'Two panes next to each other, with the folder tree' },
  { id: 'dualHorizontal', label: 'Dual stacked', icon: Rows2, desc: 'Two panes one above the other, with the folder tree' },
  { id: 'commander', label: 'Commander', icon: LayoutPanelLeft, desc: 'Two panes only, no tree: classic orthodox file manager' },
  { id: 'single', label: 'Single + tree', icon: FolderTree, desc: 'One pane with the folder tree, like Explorer' },
  { id: 'explorer', label: 'Single + preview', icon: PanelRight, desc: 'One pane, tree and preview pane' },
  { id: 'images', label: 'Images', icon: Image, desc: 'Thumbnails with a large preview' }
]

export function LayoutPicker({ onPick, value }: { onPick: (l: LayoutPreset) => void; value?: LayoutPreset }) {
  return (
    <div className="layout-picker" data-testid="layout-picker">
      {LAYOUTS.map((l) => (
        <button key={l.id} className={`layout-card${value === l.id ? ' on' : ''}`} data-help-title={l.label} data-help-desc={l.desc} onClick={() => onPick(l.id)}>
          <l.icon size={22} strokeWidth={1.5} />
          <span>{l.label}</span>
        </button>
      ))}
    </div>
  )
}

/** First-run assistant: layout, keys, look and semantic search in four quick steps. */
export function SetupDialog() {
  const prefs = useStore((s) => s.prefs)
  const home = useStore((s) => s.info.home)
  const [step, setStep] = useState(0)
  const [layout, setLayout] = useState<LayoutPreset>('dualVertical')
  const steps = ['Welcome', 'Layout', 'Keys', 'Look', 'Search']
  const last = step === steps.length - 1
  return (
    <Modal
      title="Welcome to Opal"
      wide
      testId="setup-dialog"
      footer={
        <>
          <div className="steps">
            {steps.map((s, i) => (
              <span key={s} className={`step${i === step ? ' on' : ''}${i < step ? ' done' : ''}`}>
                {s}
              </span>
            ))}
          </div>
          <span className="spacer" />
          <button className="btn" data-testid="setup-skip" onClick={() => closeDialog(true)}>
            Skip
          </button>
          {step > 0 && (
            <button className="btn" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <button className="btn primary" data-testid="setup-next" onClick={() => (last ? closeDialog(true) : setStep(step + 1))}>
            {last ? 'Start using Opal' : 'Next'}
          </button>
        </>
      }
    >
      {step === 0 && (
        <div className="setup-hero">
          <div className="setup-logo">◆</div>
          <h2>A fast, keyboard-friendly file manager</h2>
          <p className="muted">
            Two panes, tabs, folders that expand in place, Quick Look on Space, batch rename, sync, duplicates, and search by meaning. Let&apos;s set it up the
            way you like in a few seconds — you can change everything later in Preferences.
          </p>
        </div>
      )}
      {step === 1 && (
        <>
          <p>How do you want to arrange the window?</p>
          <LayoutPicker
            value={layout}
            onPick={(l) => {
              setLayout(l)
              A.applyLayout(l)
            }}
          />
        </>
      )}
      {step === 2 && (
        <>
          <p>Which keyboard shortcuts feel like home?</p>
          <div className="choice-cards">
            <button className={`choice${prefs.keymap === 'standard' ? ' on' : ''}`} onClick={() => A.setPrefs({ keymap: 'standard' })}>
              <b>Standard</b>
              <span className="muted small">Ctrl+1 copy · Ctrl+2 move · Ctrl+3 rename · F6 dual · F7 viewer · F8 tree</span>
            </button>
            <button className={`choice${prefs.keymap === 'commander' ? ' on' : ''}`} onClick={() => A.setPrefs({ keymap: 'commander' })}>
              <b>Commander style</b>
              <span className="muted small">F3 view · F5/F6 copy · Shift+F6 move · F7 new folder · F8 delete</span>
            </button>
          </div>
          <Check label="Space opens Quick Look (like macOS Finder)" checked={prefs.spaceAction === 'quicklook'} onChange={(v) => A.setPrefs({ spaceAction: v ? 'quicklook' : 'select' })} />
        </>
      )}
      {step === 3 && (
        <>
          <Row label="Theme">
            <Segmented
              value={prefs.theme}
              onChange={(v) => A.setPrefs({ theme: v })}
              options={[
                { id: 'system', label: 'System', icon: Monitor },
                { id: 'dark', label: 'Dark', icon: Moon },
                { id: 'light', label: 'Light', icon: Sun }
              ]}
            />
          </Row>
          <Row label="Accent colour">
            <AccentPicker value={prefs.accent} onChange={(c) => A.setPrefs({ accent: c })} />
          </Row>
          <Row label="Density">
            <Segmented
              value={prefs.density}
              onChange={(v) => A.setPrefs({ density: v })}
              options={[
                { id: 'compact', label: 'Compact' },
                { id: 'normal', label: 'Normal' },
                { id: 'comfortable', label: 'Comfortable' }
              ]}
            />
          </Row>
          <Check label="Show helper cards beside buttons and files" checked={prefs.helpers} onChange={(v) => A.setPrefs({ helpers: v, infotips: v })} />
        </>
      )}
      {step === 4 && (
        <>
          <div className="sem-intro">
            <Sparkles size={18} />
            <div>
              <b>Search by meaning</b> — describe a document (“the rental contract”, “budget meeting notes”) and Opal finds it, in any language. It runs locally;
              choose which folders to index.
            </div>
          </div>
          <div className="choice-cards">
            {['Documents', 'Desktop', 'Downloads'].map((name) => {
              const p = `${home}${home.includes('\\') ? '\\' : '/'}${name}`
              const on = prefs.semanticFolders.includes(p)
              return (
                <button
                  key={name}
                  className={`choice${on ? ' on' : ''}`}
                  onClick={() => void A.setSemanticFolders(on ? prefs.semanticFolders.filter((f) => f !== p) : [...prefs.semanticFolders, p])}
                >
                  <b>{name}</b>
                  <span className="muted small">{p}</span>
                </button>
              )
            })}
          </div>
          <p className="muted small">You can skip this and add folders later from the ✦ Ask button or Preferences → Semantic search.</p>
        </>
      )}
    </Modal>
  )
}
