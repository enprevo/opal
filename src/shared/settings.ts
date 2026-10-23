/**
 * Validation and normalisation of persisted settings. Used when loading the settings file and when importing
 * a file exported on another computer (possibly another OS or an older version): unknown keys are dropped,
 * values of the wrong type fall back to defaults, and older shapes are migrated.
 */
import { DEFAULT_PREFS, type LabelDef, type PersistedState, type Prefs, type UiState } from './types'
import { normalizeFavorites } from './favorites'

export { normalizeFavorites }

export const SETTINGS_FORMAT = 'opal-settings'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

const ENUMS: Partial<Record<keyof Prefs, readonly string[]>> = {
  theme: ['dark', 'light', 'system'],
  density: ['compact', 'normal', 'comfortable'],
  folderPlacement: ['first', 'mixed', 'last'],
  spaceAction: ['quicklook', 'select'],
  startup: ['restore', 'folders'],
  defaultViewMode: ['details', 'list', 'icons', 'thumbnails', 'columns'],
  dateFormat: ['locale', 'iso', 'relative', 'custom'],
  sizeUnits: ['auto', 'bytes'],
  keymap: ['standard', 'commander']
}

export function normalizePrefs(raw: unknown): Prefs {
  const out: Prefs = { ...DEFAULT_PREFS, toolbarButtons: [...DEFAULT_PREFS.toolbarButtons], columns: [...DEFAULT_PREFS.columns] }
  if (!isObj(raw)) return out
  const target = out as unknown as Obj
  for (const [key, def] of Object.entries(DEFAULT_PREFS)) {
    const v = raw[key]
    if (v === undefined) continue
    if (Array.isArray(def)) {
      if (Array.isArray(v)) target[key] = strings(v)
    } else if (typeof v === typeof def) {
      const allowed = ENUMS[key as keyof Prefs]
      if (!allowed || allowed.includes(v as string)) target[key] = v
    }
  }
  if (!out.columns.length) out.columns = [...DEFAULT_PREFS.columns]
  out.fontScale = Math.min(300, Math.max(50, out.fontScale))
  out.helperDelay = Math.min(5000, Math.max(0, out.helperDelay))
  return out
}

function normalizeLabelDefs(raw: unknown): LabelDef[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const defs = raw.filter((d): d is LabelDef => isObj(d) && typeof d.id === 'string' && typeof d.name === 'string' && typeof d.color === 'string')
  return defs.length ? defs : undefined
}

function stringMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (isObj(raw)) for (const [k, v] of Object.entries(raw)) if (typeof v === 'string' && k.trim()) out[k] = v
  return out
}

function numberMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (isObj(raw)) for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v
  return out
}

function normalizeUi(raw: unknown): UiState | undefined {
  if (!isObj(raw)) return undefined
  const ui: UiState = {}
  const num = (v: unknown, min: number, max: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined)
  const sw = num(raw.sidebarWidth, 140, 600)
  const vw = num(raw.viewerWidth, 200, 1000)
  const ratio = num(raw.paneRatio, 0.15, 0.85)
  if (sw !== undefined) ui.sidebarWidth = sw
  if (vw !== undefined) ui.viewerWidth = vw
  if (ratio !== undefined) ui.paneRatio = ratio
  if (isObj(raw.columnWidths)) ui.columnWidths = numberMap(raw.columnWidths)
  return ui
}

export function normalizeState(raw: unknown): PersistedState {
  const r = isObj(raw) ? raw : {}
  const state: PersistedState = {
    prefs: normalizePrefs(r.prefs),
    // Older versions kept collapsed favorite groups in the preferences.
    favorites: normalizeFavorites(r.favorites, isObj(r.prefs) ? strings(r.prefs.favoritesCollapsed) : []),
    recent: strings(r.recent).slice(0, 50)
  }
  if (isObj(r.labels)) {
    const labels: Record<string, string[]> = {}
    for (const [p, ids] of Object.entries(r.labels)) {
      const list = strings(ids)
      if (list.length) labels[p] = list
    }
    state.labels = labels
  }
  const defs = normalizeLabelDefs(r.labelDefs)
  if (defs) state.labelDefs = defs
  if (isObj(r.folderFormats)) state.folderFormats = r.folderFormats as PersistedState['folderFormats']
  if (isObj(r.session) && Array.isArray(r.session.panes)) state.session = r.session as unknown as PersistedState['session']
  if (r.hotkeys !== undefined) state.hotkeys = stringMap(r.hotkeys)
  if (Array.isArray(r.toolbar)) state.toolbar = r.toolbar.filter((b) => isObj(b) && typeof b.label === 'string' && typeof b.command === 'string') as PersistedState['toolbar']
  const ui = normalizeUi(r.ui)
  if (ui) state.ui = ui
  if (isObj(r.renamePresets)) {
    const presets: Record<string, Record<string, unknown>> = {}
    for (const [name, opts] of Object.entries(r.renamePresets)) if (isObj(opts)) presets[name] = opts
    state.renamePresets = presets
  }
  return state
}

export interface SettingsExport extends Omit<PersistedState, 'session' | 'recent'> {
  format: typeof SETTINGS_FORMAT
  version: string
  exportedAt: string
  platform: string
}

/** What goes into an exported file: everything except machine-specific state (open tabs, recent folders). */
export function toExport(state: PersistedState, version: string, platform: string): SettingsExport {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { session, recent, ...rest } = state
  return { format: SETTINGS_FORMAT, version, exportedAt: new Date().toISOString(), platform, ...rest }
}

/**
 * Reads an exported file (or a raw settings file) and merges it over the current state. Open tabs and recent
 * folders of this computer are kept.
 */
export function fromImport(raw: unknown, current: PersistedState): PersistedState {
  if (!isObj(raw) || (raw.format !== SETTINGS_FORMAT && !isObj(raw.prefs))) throw new Error('This is not an Opal settings file')
  const imported = normalizeState(raw)
  return { ...imported, session: current.session, recent: current.recent }
}
