/**
 * Validation and normalisation of persisted settings. Used when loading the settings file and when importing
 * a file exported on another computer (possibly another OS or an older version): unknown keys are dropped,
 * values of the wrong type fall back to defaults, and older shapes are migrated.
 */
import { DEFAULT_PREFS, type Favorite, type FolderStyle, type LabelDef, type PersistedState, type Prefs, type UiState, type WindowState } from './types'

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

/** A colour as the colour picker writes it: "#rrggbb". */
export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)
}

/**
 * Shortcuts a favorite may use: a function key, or any key with Ctrl or Alt. Plain letters and Shift+letter are left
 * to find-as-you-type.
 */
export function isFavoriteShortcut(combo: unknown): combo is string {
  if (typeof combo !== 'string') return false
  const mods = /^(?:(?:Ctrl|Alt|Shift)\+)*/.exec(combo)?.[0] ?? ''
  const key = combo.slice(mods.length)
  if (!key || ['Ctrl', 'Alt', 'Shift', 'Meta'].includes(key)) return false
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(key)) return true
  return mods.includes('Ctrl+') || mods.includes('Alt+')
}

/** Accepts the current shape and the older plain list of paths; drops duplicates and invalid entries. */
export function normalizeFavorites(raw: unknown): Favorite[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  // A key combination opens one folder only: the first favorite that claims it keeps it.
  const shortcutOwner = new Map<string, string>()
  const out: Favorite[] = []
  for (const item of raw) {
    const fav: Favorite | null =
      typeof item === 'string'
        ? { path: item }
        : isObj(item) && typeof item.path === 'string'
          ? {
              path: item.path,
              ...(typeof item.label === 'string' && item.label.trim() ? { label: item.label.trim() } : {}),
              ...(typeof item.group === 'string' && item.group.trim() ? { group: item.group.trim() } : {}),
              ...(isFavoriteShortcut(typeof item.shortcut === 'string' ? item.shortcut.trim() : '') ? { shortcut: (item.shortcut as string).trim() } : {}),
              ...(item.file === true ? { file: true } : {})
            }
          : null
    if (!fav || !fav.path.trim()) continue
    if (fav.shortcut) {
      const owner = shortcutOwner.get(fav.shortcut)
      if (owner !== undefined && owner !== fav.path.toLowerCase()) delete fav.shortcut
      else shortcutOwner.set(fav.shortcut, fav.path.toLowerCase())
    }
    const key = `${fav.group ?? ''}\u0000${fav.path.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(fav)
  }
  return out
}

export function normalizeFolderStyles(raw: unknown): Record<string, FolderStyle> | undefined {
  if (!isObj(raw)) return undefined
  const out: Record<string, FolderStyle> = {}
  for (const [p, v] of Object.entries(raw)) {
    if (!p.trim() || !isObj(v)) continue
    const style: FolderStyle = {
      ...(isHexColor(v.color) ? { color: v.color.toLowerCase() } : {}),
      ...(isHexColor(v.bg) ? { bg: v.bg.toLowerCase() } : {})
    }
    if (style.color || style.bg) out[p] = style
  }
  return out
}

/** Colours of the favorites groups: group name → "#rrggbb" (anything else is dropped). */
export function normalizeGroupColors(raw: unknown): Record<string, string> | undefined {
  if (!isObj(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [g, c] of Object.entries(raw)) if (g.trim() && isHexColor(c)) out[g.trim()] = c.toLowerCase()
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

/** The remembered window: a sensible size (at least the window's minimum), an optional place, maximized / full screen. */
export function normalizeWindow(raw: unknown): WindowState | undefined {
  if (!isObj(raw)) return undefined
  const int = (v: unknown, min: number, max: number): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v))) : undefined
  const width = int(raw.width, 800, 20000)
  const height = int(raw.height, 500, 20000)
  if (width === undefined || height === undefined) return undefined
  const win: WindowState = { width, height }
  const x = int(raw.x, -20000, 20000)
  const y = int(raw.y, -20000, 20000)
  if (x !== undefined && y !== undefined) {
    win.x = x
    win.y = y
  }
  if (raw.maximized === true) win.maximized = true
  if (raw.fullScreen === true) win.fullScreen = true
  return win
}

export function normalizeState(raw: unknown): PersistedState {
  const r = isObj(raw) ? raw : {}
  const state: PersistedState = {
    prefs: normalizePrefs(r.prefs),
    favorites: normalizeFavorites(r.favorites),
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
  const folderStyles = normalizeFolderStyles(r.folderStyles)
  if (folderStyles) state.folderStyles = folderStyles
  const groupColors = normalizeGroupColors(r.favoriteGroupColors)
  if (groupColors) state.favoriteGroupColors = groupColors
  if (isObj(r.folderFormats)) state.folderFormats = r.folderFormats as PersistedState['folderFormats']
  if (isObj(r.session) && Array.isArray(r.session.panes)) state.session = r.session as unknown as PersistedState['session']
  if (r.hotkeys !== undefined) state.hotkeys = stringMap(r.hotkeys)
  if (Array.isArray(r.toolbar)) state.toolbar = r.toolbar.filter((b) => isObj(b) && typeof b.label === 'string' && typeof b.command === 'string') as PersistedState['toolbar']
  const ui = normalizeUi(r.ui)
  if (ui) state.ui = ui
  const win = normalizeWindow(r.window)
  if (win) state.window = win
  if (isObj(r.renamePresets)) {
    const presets: Record<string, Record<string, unknown>> = {}
    for (const [name, opts] of Object.entries(r.renamePresets)) if (isObj(opts)) presets[name] = opts
    state.renamePresets = presets
  }
  return state
}

export interface SettingsExport extends Omit<PersistedState, 'session' | 'recent' | 'window'> {
  format: typeof SETTINGS_FORMAT
  version: string
  exportedAt: string
  platform: string
}

/** What goes into an exported file: everything except machine-specific state (open tabs, recent folders, window). */
export function toExport(state: PersistedState, version: string, platform: string): SettingsExport {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { session, recent, window, ...rest } = state
  return { format: SETTINGS_FORMAT, version, exportedAt: new Date().toISOString(), platform, ...rest }
}

/**
 * Reads an exported file (or a raw settings file) and merges it over the current state. Open tabs and recent
 * folders and the window of this computer are kept.
 */
export function fromImport(raw: unknown, current: PersistedState): PersistedState {
  if (!isObj(raw) || (raw.format !== SETTINGS_FORMAT && !isObj(raw.prefs))) throw new Error('This is not an Opal settings file')
  const imported = normalizeState(raw)
  const merged: PersistedState = { ...imported, session: current.session, recent: current.recent }
  if (current.window) merged.window = current.window
  else delete merged.window
  return merged
}
