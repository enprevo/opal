import {
  activeTab,
  findVisible,
  destPane,
  getState,
  newTabState,
  openDialog,
  setState,
  subscribe,
  toast,
  treeMode,
  updatePane,
  updateTab,
  visibleEntries,
  activeColumnDir,
  type PaneState,
  type TabState
} from './store'
import { DEFAULT_LABELS, DEFAULT_PREFS, type ConflictPolicy, type Favorite, type UiState, type FileEntry, type FolderFormat, type GroupBy, type LayoutPreset, type Prefs, type SessionPane, type SortSpec, type TransferOp, type ViewMode } from '@shared/types'
import { basename, dirname, isAncestor, join, normalize, samePath } from '@shared/paths'
import { compilePattern } from '@shared/wildcard'
import { defaultHotkeys, effectiveHotkeys, hotkeyOverrides, installKeyboard } from './commands'

const api = (): typeof window.opal => window.opal

let jobSeq = 0
export function newJobId(): string {
  return `job${Date.now()}-${++jobSeq}`
}

// ---------------------------------------------------------------------------
// Bootstrap & persistence
// ---------------------------------------------------------------------------

export async function bootstrap(): Promise<void> {
  const [info, persisted, roots] = await Promise.all([api().appInfo(), api().getSettings(), api().roots()])
  const prefs: Prefs = { ...DEFAULT_PREFS, ...persisted.prefs }
  const fallbackRight = roots.find((r) => r.kind === 'drive' || r.kind === 'root')?.path ?? info.home
  const starts = info.startPaths.length ? info.startPaths : info.argv
  let panes: [PaneState, PaneState]
  let activePane: 0 | 1 = 0
  if (starts.length) {
    panes = [
      { tabs: [newTabState(starts[0], prefs.defaultViewMode)], activeTab: 0 },
      { tabs: [newTabState(starts[1] ?? starts[0], prefs.defaultViewMode)], activeTab: 0 }
    ]
  } else if (info.primary && prefs.startup === 'folders') {
    panes = [
      { tabs: [newTabState(prefs.startupLeft || info.home, prefs.defaultViewMode)], activeTab: 0 },
      { tabs: [newTabState(prefs.startupRight || fallbackRight, prefs.defaultViewMode)], activeTab: 0 }
    ]
  } else if (info.primary && persisted.session?.panes?.length === 2) {
    panes = persisted.session.panes.map((p) => ({
      tabs: p.tabs.length ? p.tabs.map((t) => newTabState(t.path, t.viewMode, t.sort)) : [newTabState(info.home, prefs.defaultViewMode)],
      activeTab: Math.min(p.activeTab, Math.max(0, p.tabs.length - 1))
    })) as [PaneState, PaneState]
    activePane = persisted.session.activePane === 1 ? 1 : 0
  } else {
    panes = [
      { tabs: [newTabState(info.home, prefs.defaultViewMode)], activeTab: 0 },
      { tabs: [newTabState(fallbackRight, prefs.defaultViewMode)], activeTab: 0 }
    ]
  }

  const hotkeys = effectiveHotkeys(prefs.keymap, info.platform, persisted.hotkeys)
  setState({
    info,
    prefs,
    favorites: persisted.favorites ?? [],
    recent: persisted.recent ?? [],
    hotkeys,
    ui: persisted.ui ?? migrateLocalUi(),
    renamePresets: persisted.renamePresets ?? migrateLocalPresets(),
    labels: persisted.labels ?? {},
    labelDefs: persisted.labelDefs?.length ? persisted.labelDefs : DEFAULT_LABELS,
    folderFormats: persisted.folderFormats ?? {},
    roots,
    panes,
    activePane,
    ready: true
  })
  systemTheme = await api().systemTheme()
  applyAppearance(prefs)
  api().onSystemTheme((t) => {
    systemTheme = t
    applyAppearance(getState().prefs)
  })
  api().onSemanticStatus((st) => setState({ semantic: st }))
  void api().semanticStatus(false).then((st) => setState({ semantic: st }))

  api().onJobProgress((p) => setState((s) => ({ jobs: { ...s.jobs, [p.jobId]: p } })))
  api().onWatchChanged((dir) => {
    for (const pane of [0, 1] as const) {
      for (const t of getState().panes[pane].tabs) {
        if (t.listing && samePath(t.path, dir)) void loadTab(pane, t.id, t.path, { quiet: true })
      }
    }
  })
  installKeyboard()

  await Promise.all(
    ([0, 1] as const).map(async (pane) => {
      const tab = activeTab(pane)
      await navigate(pane, tab.path, { history: 'none', tabId: tab.id, fallbackHome: true })
    })
  )
  refreshUndo()
  updateWatches()
  persistSessionOnChange()
  // Older versions kept these in the browser storage, or saved the full key map: store them in the settings file.
  const compact = hotkeyOverrides(hotkeys, prefs.keymap, info.platform)
  if (JSON.stringify(compact) !== JSON.stringify(persisted.hotkeys ?? {})) void api().setSettings({ hotkeys: compact })
  if (!persisted.ui) void api().setSettings({ ui: getState().ui })
  if (!persisted.renamePresets && Object.keys(getState().renamePresets).length) void api().setSettings({ renamePresets: getState().renamePresets })
  if (!prefs.setupDone && info.primary && !info.noSetup && !info.startPaths.length) void runSetup()
}

function migrateLocalUi(): UiState {
  const ui: UiState = {}
  const num = (k: string): number | undefined => {
    const n = Number(localStorage.getItem(k))
    return Number.isFinite(n) && n > 0 ? n : undefined
  }
  const sw = num('opal.sidebarW')
  const vw = num('opal.viewerW')
  const ratio = num('opal.ratio')
  if (sw) ui.sidebarWidth = sw
  if (vw) ui.viewerWidth = vw
  if (ratio) ui.paneRatio = ratio
  try {
    const cw = JSON.parse(localStorage.getItem('opal.colw') ?? 'null') as Record<string, number> | null
    if (cw) ui.columnWidths = cw
  } catch {
    // ignore
  }
  return ui
}

function migrateLocalPresets(): Record<string, Record<string, unknown>> {
  try {
    return (JSON.parse(localStorage.getItem('opal.renamePresets') ?? 'null') as Record<string, Record<string, unknown>> | null) ?? {}
  } catch {
    return {}
  }
}

let uiTimer: ReturnType<typeof setTimeout> | null = null
/** Pane sizes and column widths: applied at once, saved shortly after the drag ends. */
export function setUi(patch: Partial<UiState>): void {
  setState((s) => ({ ui: { ...s.ui, ...patch } }))
  if (uiTimer) clearTimeout(uiTimer)
  uiTimer = setTimeout(() => void api().setSettings({ ui: getState().ui }), 400)
}

export function saveRenamePresets(presets: Record<string, Record<string, unknown>>): void {
  setState({ renamePresets: presets })
  void api().setSettings({ renamePresets: presets })
}

/** Saves the key map as changes relative to the defaults. */
export function saveHotkeys(map: Record<string, string>): void {
  setState({ hotkeys: map })
  const s = getState()
  void api().setSettings({ hotkeys: hotkeyOverrides(map, s.prefs.keymap, s.info.platform) })
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

let systemTheme: 'dark' | 'light' = 'dark'

export function resolvedTheme(prefs: Prefs = getState().prefs): 'dark' | 'light' {
  return prefs.theme === 'system' ? systemTheme : prefs.theme
}

export function applyAppearance(prefs: Prefs): void {
  const root = document.documentElement
  root.dataset.theme = resolvedTheme(prefs)
  root.dataset.density = prefs.density
  root.dataset.stripes = String(prefs.stripes)
  root.dataset.grid = String(prefs.gridLines)
  root.style.setProperty('--accent', prefs.accent || '#4c8dff')
  root.style.setProperty('--ui-font', prefs.uiFont || "system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, Cantarell, sans-serif")
}

export const ROW_HEIGHTS: Record<Prefs['density'], number> = { compact: 19, normal: 22, comfortable: 27 }

export function applyLayout(preset: LayoutPreset): void {
  const patches: Record<LayoutPreset, Partial<Prefs>> = {
    single: { dualDisplay: false, showTree: true, showViewer: false },
    dualVertical: { dualDisplay: true, dualVertical: true, showTree: true, showViewer: false },
    dualHorizontal: { dualDisplay: true, dualVertical: false, showTree: true, showViewer: false },
    explorer: { dualDisplay: false, showTree: true, showViewer: true },
    commander: { dualDisplay: true, dualVertical: true, showTree: false, showViewer: false },
    images: { dualDisplay: false, showTree: true, showViewer: true, defaultViewMode: 'thumbnails' },
    preview: { dualDisplay: true, dualVertical: true, showTree: false, showViewer: true }
  }
  setPrefs(patches[preset])
  if (preset === 'images') setFormat(getState().activePane, { viewMode: 'thumbnails' })
}

export async function runSetup(): Promise<void> {
  await openDialog('setup')
  setPrefs({ setupDone: true })
}

function persistSessionOnChange(): void {
  let lastPanes = getState().panes
  let lastActive = getState().activePane
  let timer: ReturnType<typeof setTimeout> | null = null
  subscribe(() => {
    const s = getState()
    if (s.panes === lastPanes && s.activePane === lastActive) return
    lastPanes = s.panes
    lastActive = s.activePane
    updateWatches()
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (!getState().info.primary) return
      const panes: SessionPane[] = getState().panes.map((p) => ({
        activeTab: p.activeTab,
        tabs: p.tabs.filter((t) => t.path).map((t) => ({ path: t.path, viewMode: t.viewMode, sort: t.sort }))
      }))
      void api().setSettings({ session: { panes, activePane: getState().activePane } })
    }, 500)
  })
}

let lastWatchKey = ''
function updateWatches(): void {
  const s = getState()
  const dirs = new Set<string>()
  for (const pane of [0, 1] as const) {
    if (pane === 1 && !s.prefs.dualDisplay) continue
    const t = activeTab(pane, s)
    if (t.listing) dirs.add(t.listing.path)
    if (treeMode(t, s.prefs)) for (const d of [...t.expanded].slice(0, 64)) dirs.add(d)
  }
  const key = [...dirs].sort().join('|')
  if (key === lastWatchKey) return
  lastWatchKey = key
  api().watch([...dirs])
}

export function setPrefs(patch: Partial<Prefs>): void {
  const prev = getState().prefs
  const prefs = { ...prev, ...patch }
  setState({ prefs })
  if (patch.keymap && patch.keymap !== prev.keymap) {
    // Switching keymap restores that keymap's defaults (custom overrides are cleared).
    setState({ hotkeys: { ...defaultHotkeys(prefs.keymap) } })
    void api().setSettings({ hotkeys: {} })
  }
  if (patch.expandableFolders === false) for (const pane of [0, 1] as const) for (const t of getState().panes[pane].tabs) updateTab(pane, t.id, () => ({ expanded: new Set(), children: {} }))
  applyAppearance(prefs)
  void api().setSettings({ prefs })
  if (patch.dualDisplay !== undefined) updateWatches()
}

export function refreshUndo(): void {
  void api()
    .undoInfo()
    .then((u) => setState({ undoLabel: u.available ? u.label : '' }))
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

const navSeq = new Map<string, number>()
const refreshSeq = new Map<string, number>()

interface NavOptions {
  history?: 'push' | 'none'
  tabId?: string
  focusName?: string
  fallbackHome?: boolean
  /** Restore folders that were expanded the last time this path was shown (back/forward). */
  restoreExpanded?: boolean
  /** Navigation triggered by Navigation Lock (don't propagate again). */
  fromLock?: boolean
}

export async function navigate(pane: 0 | 1, rawPath: string, opts: NavOptions = {}): Promise<boolean> {
  const tab = opts.tabId ? getState().panes[pane].tabs.find((t) => t.id === opts.tabId) : activeTab(pane)
  if (!tab) return false
  const tabId = tab.id
  // On Windows accept forward slashes too (e.g. //server/share or C:/Users).
  if (getState().info.platform === 'win32') rawPath = rawPath.replace(/\//g, '\\')
  let path = normalize(rawPath.trim())
  const seq = (navSeq.get(tabId) ?? 0) + 1
  navSeq.set(tabId, seq)
  const previousPath = tab.path
  updateTab(pane, tabId, () => ({ loading: true }))
  try {
    let listing
    let focusName = opts.focusName
    try {
      listing = await api().list(path)
    } catch (e) {
      const msg = (e as Error).message
      if (/ENOTDIR/.test(msg)) {
        focusName = basename(path)
        path = dirname(path) ?? path
        listing = await api().list(path)
      } else throw e
    }
    if (navSeq.get(tabId) !== seq) return false
    updateTab(pane, tabId, (t) => {
      const changed = !samePath(t.path, listing.path) || !t.listing
      let history = t.history
      let historyIndex = t.historyIndex
      if (opts.history !== 'none' && !samePath(t.history[t.historyIndex] ?? '', listing.path)) {
        history = [...t.history.slice(0, t.historyIndex + 1), listing.path].slice(-100)
        historyIndex = history.length - 1
      }
      const prevChild = t.listing && isAncestor(listing.path, t.listing.path) ? findChildOnPath(listing.path, t.listing.path) : null
      const focusPath = focusName ? join(listing.path, focusName) : prevChild ?? (changed ? null : t.focusPath)
      const expandedByPath = changed && t.listing ? { ...t.expandedByPath, [t.path]: [...t.expanded] } : t.expandedByPath
      const fmt = changed ? folderFormatFor(listing.path) : undefined
      const restored = changed && opts.restoreExpanded ? expandedByPath[listing.path] ?? [] : []
      return {
        expanded: changed ? new Set(restored) : t.expanded,
        children: changed ? {} : t.children,
        expandedByPath,
        prevFilter: changed && t.filter ? t.filter : t.prevFilter,
        path: listing.path,
        listing,
        loading: false,
        error: null,
        history,
        historyIndex,
        filter: changed ? '' : t.filter,
        selected: changed ? new Set() : t.selected,
        focusPath,
        anchorPath: changed ? null : t.anchorPath,
        sizes: changed ? {} : t.sizes,
        renaming: null,
        flat: false,
        ...(fmt ? { viewMode: fmt.viewMode, sort: fmt.sort, groupBy: fmt.groupBy } : {}),
        collapsedGroups: changed ? new Set() : t.collapsedGroups,
        scrollTick: t.scrollTick + 1
      }
    })
    ensureFocus(pane, tabId)
    addRecent(listing.path)
    const after = getState().panes[pane].tabs.find((t) => t.id === tabId)
    if (after && after.expanded.size && !after.children[[...after.expanded][0]]) await reloadExpanded(pane, tabId)
    if (!opts.fromLock) followNavLock(pane, previousPath, listing.path)
    return true
  } catch (e) {
    if (navSeq.get(tabId) !== seq) return false
    updateTab(pane, tabId, (t) => ({ loading: false, error: t.listing ? t.error : (e as Error).message }))
    toast(`Cannot open "${path}": ${cleanError(e)}`, 'error')
    if (opts.fallbackHome && !samePath(path, getState().info.home)) return navigate(pane, getState().info.home, { ...opts, fallbackHome: false })
    return false
  }
}

// ---------------------------------------------------------------------------
// Expandable folders (expand in place in the file display)
// ---------------------------------------------------------------------------

async function loadChildren(paths: string[]): Promise<Record<string, FileEntry[]>> {
  const out: Record<string, FileEntry[]> = {}
  await Promise.all(
    paths.map(async (p) => {
      try {
        out[p] = (await api().list(p)).entries
      } catch {
        // folder vanished or unreadable: drop it from the expanded set
      }
    })
  )
  return out
}

/** Folders whose listings back the column view: every loaded folder on the focus chain. */
function columnDirs(t: TabState): string[] {
  if (t.viewMode !== 'columns' || !t.focusPath) return []
  return Object.keys(t.children).filter((d) => !t.expanded.has(d) && isAncestor(t.path, d) && (samePath(d, t.focusPath!) || isAncestor(d, t.focusPath!)))
}

async function reloadExpanded(pane: 0 | 1, tabId: string): Promise<void> {
  const tab = getState().panes[pane].tabs.find((t) => t.id === tabId)
  if (!tab || (!tab.expanded.size && !columnDirs(tab).length)) return
  const requested = [...tab.expanded, ...columnDirs(tab)]
  const loaded = await loadChildren(requested)
  updateTab(pane, tabId, (t) => mergeExpanded(t, requested, loaded))
}

function mergeExpanded(
  t: TabState,
  requested: string[],
  loaded: Record<string, FileEntry[]>
): { expanded: ReadonlySet<string>; children: Record<string, FileEntry[]> } {
  const req = new Set(requested)
  const children: Record<string, FileEntry[]> = {}
  const keep: string[] = []
  for (const p of t.expanded) {
    const kids = req.has(p) ? loaded[p] : t.children[p]
    if (kids) {
      children[p] = kids
      keep.push(p)
    } else if (!req.has(p)) keep.push(p)
  }
  // Column view keeps its folder chain loaded even though those folders aren't "expanded".
  for (const p of columnDirs(t)) {
    const kids = req.has(p) ? loaded[p] : t.children[p]
    if (kids) children[p] = kids
  }
  return { expanded: keep.length === t.expanded.size ? t.expanded : new Set(keep), children }
}

function isWithin(child: string, folder: string): boolean {
  return isAncestor(folder, child)
}

/** Expands a folder in place. Returns false when the folder can't be read. */
export async function expandFolder(pane: 0 | 1, path: string, opts: { recursive?: boolean } = {}): Promise<boolean> {
  const tab = activeTab(pane)
  let kids: FileEntry[]
  try {
    kids = tab.children[path] ?? (await api().list(path)).entries
  } catch (e) {
    toast(cleanError(e), 'error')
    return false
  }
  updateTab(pane, tab.id, (t) => ({ expanded: new Set(t.expanded).add(path), children: { ...t.children, [path]: kids } }))
  if (opts.recursive) {
    for (const k of kids) if (k.isDir && !k.isSymlink && (getState().prefs.showHidden || !k.hidden)) await expandFolder(pane, k.path, opts)
  }
  updateWatches()
  return true
}

export function collapseFolder(pane: 0 | 1, path: string): void {
  const prefs = getState().prefs
  updateTab(pane, null, (t) => {
    const expanded = new Set(t.expanded)
    expanded.delete(path)
    const children = { ...t.children }
    if (prefs.collapseSubfolders) {
      for (const p of t.expanded) if (isWithin(p, path)) {
        expanded.delete(p)
        delete children[p]
      }
    }
    let selected = t.selected
    if (prefs.collapseClearsSelection) selected = new Set([...t.selected].filter((p) => !isWithin(p, path)))
    const focusPath = t.focusPath && isWithin(t.focusPath, path) ? path : t.focusPath
    return { expanded, children, selected, focusPath, scrollTick: t.scrollTick + 1 }
  })
  updateWatches()
}

/** Go EXPANDBRANCH[=toggle|collapse|toggleall]: acts on the focused folder (or selected folders). */
export async function expandBranch(pane: 0 | 1, mode: 'expand' | 'collapse' | 'toggle' | 'toggleall' = 'expand'): Promise<void> {
  const s = getState()
  const tab = activeTab(pane, s)
  if (!s.prefs.expandableFolders || tab.flat) return
  if (tab.viewMode !== 'details') A_setDetails(pane)
  const focused = findVisible(tab, s.prefs, tab.focusPath)
  const targets = selectedEntries(pane).filter((e) => e.isDir)
  const list = targets.length > 1 ? targets : focused?.isDir ? [focused] : []
  for (const e of list) {
    const open = activeTab(pane).expanded.has(e.path)
    if (mode === 'collapse' || ((mode === 'toggle' || mode === 'toggleall') && open)) collapseFolder(pane, e.path)
    else if (!open || mode === 'toggleall') await expandFolder(pane, e.path, { recursive: mode === 'toggleall' })
  }
  if (!list.length && mode === 'collapse' && focused?.depth) {
    // Collapsing from inside an expanded folder collapses its parent (tree behaviour).
    const parent = dirname(focused.path)
    if (parent) collapseFolder(pane, parent)
  }
}

function A_setDetails(pane: 0 | 1): void {
  updateTab(pane, null, () => ({ viewMode: 'details' }))
}

/** Right arrow: expand a collapsed folder, or move to its first child when already expanded. */
export async function arrowRight(pane: 0 | 1): Promise<void> {
  const s = getState()
  const tab = activeTab(pane, s)
  const e = findVisible(tab, s.prefs, tab.focusPath)
  if (!e || !e.isDir) return
  if (!tab.expanded.has(e.path)) await expandFolder(pane, e.path)
  else moveFocus(pane, 1, { shift: false, ctrl: false })
}

/** Left arrow: collapse an expanded folder, or move to the parent folder row. */
export function arrowLeft(pane: 0 | 1): void {
  const s = getState()
  const tab = activeTab(pane, s)
  const e = findVisible(tab, s.prefs, tab.focusPath)
  if (!e) return
  if (e.isDir && tab.expanded.has(e.path)) {
    collapseFolder(pane, e.path)
    return
  }
  if (e.depth) {
    const parent = dirname(e.path)
    if (parent) updateTab(pane, null, (t) => ({ focusPath: parent, anchorPath: parent, selected: new Set([parent]), scrollTick: t.scrollTick + 1 }))
  }
}

// ---------------------------------------------------------------------------
// Navigation Lock (Set NAVLOCK): the other display follows relative moves.
// ---------------------------------------------------------------------------

export function setNavLock(on: boolean): void {
  setState({ navLock: on })
  toast(on ? 'Navigation Lock on' : 'Navigation Lock off')
}

function followNavLock(pane: 0 | 1, from: string, to: string): void {
  const s = getState()
  if (!s.navLock || !s.prefs.dualDisplay || !from || samePath(from, to)) return
  const other: 0 | 1 = pane === 0 ? 1 : 0
  const otherPath = activeTab(other, s).path
  let target: string | null = null
  if (isAncestor(from, to)) {
    const rel = to.slice(normalize(from).replace(/[\\/]$/, '').length + 1)
    target = join(otherPath, rel)
  } else if (isAncestor(to, from)) {
    let up: string | null = otherPath
    let levels = from.split(/[\\/]/).filter(Boolean).length - to.split(/[\\/]/).filter(Boolean).length
    while (up && levels-- > 0) up = dirname(up)
    target = up
  }
  if (target) void navigate(other, target, { fromLock: true })
  else toast('Navigation Lock: folders are out of sync', 'error')
}

function findChildOnPath(parent: string, descendant: string): string | null {
  let cur: string | null = descendant
  while (cur) {
    const up = dirname(cur)
    if (up && samePath(up, parent)) return cur
    cur = up
  }
  return null
}

function ensureFocus(pane: 0 | 1, tabId: string): void {
  const s = getState()
  const tab = s.panes[pane].tabs.find((t) => t.id === tabId)
  if (!tab) return
  const entries = visibleEntries(tab, s.prefs)
  if (!tab.focusPath || !entries.some((e) => e.path === tab.focusPath)) {
    updateTab(pane, tabId, () => ({ focusPath: entries[0]?.path ?? null }))
  }
}

export function cleanError(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export async function loadTab(pane: 0 | 1, tabId: string, path: string, opts: { quiet?: boolean; focusName?: string } = {}): Promise<void> {
  const seq = navSeq.get(tabId) ?? 0
  const rseq = (refreshSeq.get(tabId) ?? 0) + 1
  refreshSeq.set(tabId, rseq)
  const stale = (): boolean => (navSeq.get(tabId) ?? 0) !== seq || refreshSeq.get(tabId) !== rseq
  try {
    const flat = getState().panes[pane].tabs.find((t) => t.id === tabId)?.flat ?? false
    const listing = await api().list(path, flat)
    // Drop stale refreshes: the tab navigated elsewhere while we were listing.
    const current = getState().panes[pane].tabs.find((t) => t.id === tabId)
    if (!current || stale() || !samePath(current.path, listing.path) || current.flat !== flat) return
    const requested = [...current.expanded, ...columnDirs(current)]
    const loaded = requested.length ? await loadChildren(requested) : {}
    if (stale()) return
    updateTab(pane, tabId, (t) => {
      // Merge: folders expanded while this refresh was running keep their own (newer) listings.
      const { expanded, children } = mergeExpanded(t, requested, loaded)
      const exists = new Set(listing.entries.map((e) => e.path))
      for (const kids of Object.values(children)) for (const k of kids) exists.add(k.path)
      const selected = new Set([...t.selected].filter((p) => exists.has(p)))
      return {
        listing,
        children,
        expanded,
        error: null,
        selected,
        focusPath: opts.focusName ? join(listing.path, opts.focusName) : t.focusPath,
        scrollTick: opts.focusName ? t.scrollTick + 1 : t.scrollTick
      }
    })
    ensureFocus(pane, tabId)
  } catch (e) {
    if (stale()) return
    // Folder vanished: walk up to the nearest existing parent.
    const up = dirname(path)
    if (up && /ENOENT|ENOTDIR/.test(String((e as Error)?.message))) {
      const ok = await navigate(pane, up, { tabId, history: 'none' })
      if (ok) return
    }
    if (!opts.quiet) toast(cleanError(e), 'error')
  }
}

export async function refreshPane(pane: 0 | 1, focusName?: string): Promise<void> {
  const t = activeTab(pane)
  await loadTab(pane, t.id, t.path, { focusName })
}

export async function refreshAll(): Promise<void> {
  const s = getState()
  await Promise.all(([0, 1] as const).map((p) => (p === 1 && !s.prefs.dualDisplay ? undefined : refreshPane(p))))
}

function addRecent(path: string): void {
  const recent = [path, ...getState().recent.filter((r) => !samePath(r, path))].slice(0, 25)
  setState({ recent })
  void api().setSettings({ recent })
}

export function goUp(pane: 0 | 1 = getState().activePane): void {
  const up = dirname(activeTab(pane).path)
  if (up) void navigate(pane, up)
}

export function goHistory(pane: 0 | 1, delta: number): void {
  const t = activeTab(pane)
  const idx = t.historyIndex + delta
  if (idx < 0 || idx >= t.history.length) return
  updateTab(pane, t.id, () => ({ historyIndex: idx }))
  void navigate(pane, t.history[idx], { history: 'none', restoreExpanded: true })
}

export function setActivePane(pane: 0 | 1): void {
  if (getState().activePane !== pane) setState({ activePane: pane })
}

export function newTab(pane: 0 | 1, path?: string): void {
  const p = path ?? activeTab(pane).path
  const tab = newTabState(p, getState().prefs.defaultViewMode)
  updatePane(pane, (ps) => ({ tabs: [...ps.tabs, tab], activeTab: ps.tabs.length }))
  void navigate(pane, p, { tabId: tab.id, history: 'none' })
}

export function closeTab(pane: 0 | 1, tabId?: string): void {
  const ps = getState().panes[pane]
  if (ps.tabs.length <= 1) return
  const idx = tabId ? ps.tabs.findIndex((t) => t.id === tabId) : ps.activeTab
  const closed = ps.tabs[idx]
  const tabs = ps.tabs.filter((_, i) => i !== idx)
  const active = Math.min(ps.activeTab > idx ? ps.activeTab - 1 : ps.activeTab, tabs.length - 1)
  updatePane(pane, (p) => ({ tabs, activeTab: active, closedTabs: [closed.path, ...(p.closedTabs ?? [])].slice(0, 20) }))
}

export function undoCloseTab(pane: 0 | 1): void {
  const ps = getState().panes[pane]
  const [path, ...rest] = ps.closedTabs ?? []
  if (!path) return toast('No closed tabs')
  updatePane(pane, () => ({ closedTabs: rest }))
  newTab(pane, path)
}

export function duplicateTab(pane: 0 | 1): void {
  newTab(pane, activeTab(pane).path)
}

export function switchTab(pane: 0 | 1, index: number): void {
  const ps = getState().panes[pane]
  const n = ps.tabs.length
  const idx = ((index % n) + n) % n
  updatePane(pane, () => ({ activeTab: idx }))
  const t = ps.tabs[idx]
  if (!t.listing) void navigate(pane, t.path, { tabId: t.id, history: 'none' })
}

export function swapPanes(): void {
  setState((s) => ({ panes: [s.panes[1], s.panes[0]] }))
}

export function mirrorToDest(): void {
  const s = getState()
  void navigate(destPane(s), activeTab(s.activePane).path)
}

export function setTabProps(pane: 0 | 1, patch: Partial<TabState>): void {
  updateTab(pane, null, () => patch)
}

export async function toggleFlatView(pane: 0 | 1, on?: boolean): Promise<void> {
  const t = activeTab(pane)
  const flat = on ?? !t.flat
  if (flat === t.flat) return
  updateTab(pane, t.id, () => ({ flat, loading: true, selected: new Set(), focusPath: null }))
  await loadTab(pane, t.id, t.path)
  updateTab(pane, t.id, () => ({ loading: false }))
}

export function openNewWindow(): void {
  void api().newWindow(sourceDir())
}

// ---------------------------------------------------------------------------
// Selection & focus
// ---------------------------------------------------------------------------

export function selectedEntries(pane: 0 | 1, includeFocused = true): FileEntry[] {
  const s = getState()
  const tab = activeTab(pane, s)
  const entries = visibleEntries(tab, s.prefs)
  const sel = entries.filter((e) => tab.selected.has(e.path))
  if (sel.length || !includeFocused) return sel
  const f = entries.find((e) => e.path === tab.focusPath)
  return f ? [f] : []
}

export function clickEntry(pane: 0 | 1, entry: FileEntry | null, mods: { ctrl: boolean; shift: boolean }): void {
  setActivePane(pane)
  const s = getState()
  const tab = activeTab(pane, s)
  if (!entry) {
    if (!mods.ctrl && !mods.shift) updateTab(pane, null, () => ({ selected: new Set() }))
    return
  }
  if (mods.shift) {
    selectRange(pane, tab.anchorPath ?? tab.focusPath ?? entry.path, entry.path, mods.ctrl)
    updateTab(pane, null, () => ({ focusPath: entry.path }))
  } else if (mods.ctrl) {
    const selected = new Set(tab.selected)
    if (selected.has(entry.path)) selected.delete(entry.path)
    else selected.add(entry.path)
    updateTab(pane, null, () => ({ selected, focusPath: entry.path, anchorPath: entry.path }))
  } else {
    updateTab(pane, null, () => ({ selected: new Set([entry.path]), focusPath: entry.path, anchorPath: entry.path }))
  }
}

function selectRange(pane: 0 | 1, from: string, to: string, additive: boolean): void {
  const s = getState()
  const tab = activeTab(pane, s)
  const entries = visibleEntries(tab, s.prefs)
  const a = entries.findIndex((e) => e.path === from)
  const b = entries.findIndex((e) => e.path === to)
  if (b < 0) return
  const [lo, hi] = a < 0 ? [b, b] : [Math.min(a, b), Math.max(a, b)]
  const selected = additive ? new Set(tab.selected) : new Set<string>()
  for (let i = lo; i <= hi; i++) selected.add(entries[i].path)
  updateTab(pane, null, () => ({ selected, anchorPath: a < 0 ? to : from }))
}

export function moveFocus(pane: 0 | 1, delta: number | 'home' | 'end', mods: { shift: boolean; ctrl: boolean }, pageSize = 20): void {
  const s = getState()
  const tab = activeTab(pane, s)
  const entries = visibleEntries(tab, s.prefs)
  if (!entries.length) return
  const cur = entries.findIndex((e) => e.path === tab.focusPath)
  let next: number
  if (delta === 'home') next = 0
  else if (delta === 'end') next = entries.length - 1
  else if (cur < 0) next = 0
  else next = Math.max(0, Math.min(entries.length - 1, cur + delta))
  void pageSize
  const target = entries[next]
  if (mods.shift) {
    selectRange(pane, tab.anchorPath ?? tab.focusPath ?? target.path, target.path, mods.ctrl)
    updateTab(pane, null, (t) => ({ focusPath: target.path, scrollTick: t.scrollTick + 1 }))
  } else if (mods.ctrl) {
    updateTab(pane, null, (t) => ({ focusPath: target.path, scrollTick: t.scrollTick + 1 }))
  } else {
    updateTab(pane, null, (t) => ({
      focusPath: target.path,
      anchorPath: target.path,
      selected: new Set([target.path]),
      scrollTick: t.scrollTick + 1
    }))
  }
}

export function focusByPrefix(pane: 0 | 1, prefix: string): boolean {
  const s = getState()
  const tab = activeTab(pane, s)
  const entries = visibleEntries(tab, s.prefs)
  const lower = prefix.toLowerCase()
  const cur = entries.findIndex((e) => e.path === tab.focusPath)
  const ordered = [...entries.slice(Math.max(cur, 0)), ...entries.slice(0, Math.max(cur, 0))]
  const hit = ordered.find((e) => e.name.toLowerCase().startsWith(lower))
  if (!hit) return false
  updateTab(pane, null, (t) => ({ focusPath: hit.path, anchorPath: hit.path, selected: new Set([hit.path]), scrollTick: t.scrollTick + 1 }))
  return true
}

export function toggleFocusedSelection(pane: 0 | 1): void {
  const tab = activeTab(pane)
  if (!tab.focusPath) return
  const selected = new Set(tab.selected)
  if (selected.has(tab.focusPath)) selected.delete(tab.focusPath)
  else selected.add(tab.focusPath)
  updateTab(pane, null, () => ({ selected }))
  moveFocus(pane, 1, { shift: false, ctrl: true })
}

export function selectAll(pane: 0 | 1): void {
  const s = getState()
  const entries = visibleEntries(activeTab(pane, s), s.prefs)
  updateTab(pane, null, () => ({ selected: new Set(entries.map((e) => e.path)) }))
}

export function selectNone(pane: 0 | 1): void {
  updateTab(pane, null, () => ({ selected: new Set() }))
}

export function invertSelection(pane: 0 | 1): void {
  const s = getState()
  const tab = activeTab(pane, s)
  const entries = visibleEntries(tab, s.prefs)
  updateTab(pane, null, () => ({ selected: new Set(entries.filter((e) => !tab.selected.has(e.path)).map((e) => e.path)) }))
}

export function selectPattern(pane: 0 | 1, pattern: string, opts: { deselect?: boolean; filesOnly?: boolean; dirsOnly?: boolean; exclusive?: boolean } = {}): number {
  const s = getState()
  const tab = activeTab(pane, s)
  const match = compilePattern(pattern)
  const entries = visibleEntries(tab, s.prefs).filter((e) => (!opts.filesOnly || !e.isDir) && (!opts.dirsOnly || e.isDir))
  const hits = entries.filter((e) => match(e.name))
  const selected = opts.exclusive ? new Set<string>() : new Set(tab.selected)
  for (const h of hits) {
    if (opts.deselect) selected.delete(h.path)
    else selected.add(h.path)
  }
  updateTab(pane, null, () => ({ selected, focusPath: hits[0]?.path ?? tab.focusPath, scrollTick: tab.scrollTick + 1 }))
  return hits.length
}

/** Select SIMILAR: select every file with the focused file's extension. */
export function selectSimilar(pane: 0 | 1): number {
  const s = getState()
  const tab = activeTab(pane, s)
  const focused = findVisible(tab, s.prefs, tab.focusPath)
  if (!focused || focused.isDir) return 0
  const ext = focused.ext.toLowerCase()
  const hits = visibleEntries(tab, s.prefs).filter((e) => !e.isDir && e.ext.toLowerCase() === ext)
  updateTab(pane, null, (t) => ({ selected: new Set([...t.selected, ...hits.map((h) => h.path)]) }))
  return hits.length
}

/**
 * Select SOURCETODEST / DESTTOSOURCE: select items in `target` whose names are (or are not)
 * present among the reference display's selected items (or all of its items when nothing is selected).
 */
export function selectByOtherPane(target: 0 | 1, mode: 'in' | 'notin', opts: { noExt?: boolean; deselectNoMatch?: boolean } = {}): number {
  const s = getState()
  const ref: 0 | 1 = target === 0 ? 1 : 0
  const refEntries = selectedEntries(ref, false)
  const source = refEntries.length ? refEntries : visibleEntries(activeTab(ref, s), s.prefs)
  const key = (n: string): string => {
    const name = s.info.platform === 'win32' || s.info.platform === 'darwin' ? n.toLowerCase() : n
    return opts.noExt ? name.replace(/\.[^.]*$/, '') : name
  }
  const names = new Set(source.map((e) => key(e.name)))
  const tab = activeTab(target, s)
  const hits = visibleEntries(tab, s.prefs).filter((e) => names.has(key(e.name)) === (mode === 'in'))
  updateTab(target, null, (t) => ({ selected: new Set([...(opts.deselectNoMatch ? [] : t.selected), ...hits.map((h) => h.path)]) }))
  return hits.length
}

const lastSelection = new Map<string, string[]>()

function rememberSelection(): void {
  const pane = getState().activePane
  const items = selectedEntries(pane, false)
  if (items.length) lastSelection.set(activeTab(pane).id, items.map((e) => e.path))
}

/** Select RESELECT: reselect the items that were selected before the last operation. */
export function reselect(pane: 0 | 1): number {
  const s = getState()
  const tab = activeTab(pane, s)
  const prev = new Set(lastSelection.get(tab.id) ?? [])
  const hits = visibleEntries(tab, s.prefs).filter((e) => prev.has(e.path))
  updateTab(pane, null, () => ({ selected: new Set(hits.map((h) => h.path)) }))
  return hits.length
}

/** Copy AS: ask for a new name for each item, then copy/move. */
export async function copyAs(op: TransferOp, dest?: string): Promise<void> {
  const items = selectedEntries(getState().activePane)
  if (!items.length) return
  const renames: Record<string, string> = {}
  for (const e of items) {
    const name = await openDialog<string>('prompt', { title: `${op === 'copy' ? 'Copy' : 'Move'} As`, label: `New name for "${e.name}"`, value: basename(e.path), validateName: true })
    if (!name) return
    renames[e.path] = name
  }
  await transferItems(op, items.map((e) => e.path), dest ?? destDir(), undefined, { renames })
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

export async function openEntry(pane: 0 | 1, entry: FileEntry, inOther = false): Promise<void> {
  if (entry.isDir) {
    if (inOther) {
      const other = pane === 0 ? 1 : 0
      if (!getState().prefs.dualDisplay) setPrefs({ dualDisplay: true })
      await navigate(other, entry.path)
    } else await navigate(pane, entry.path)
    return
  }
  const err = await api().open(entry.path)
  if (err) toast(err, 'error')
}

export function sourceDir(): string {
  return activeTab(getState().activePane).path
}

export function destDir(): string {
  const s = getState()
  return activeTab(destPane(s), s).path
}

export interface TransferExtra {
  renames?: Record<string, string>
  onlyExisting?: boolean
  /** Skip the nested-items prompt (e.g. drag and drop, synchronize). */
  noNestedPrompt?: boolean
  ensureDestDir?: boolean
}

/** Groups nested sources (from Flat View or expanded folders) by their folder relative to the source display. */
function nestedGroups(sources: string[], base: string): Map<string, string[]> | null {
  const parents = new Set(sources.map((p) => (dirname(p) ?? '').toLowerCase()))
  if (parents.size < 2) return null
  if (!sources.every((p) => isAncestor(base, p))) return null
  const groups = new Map<string, string[]>()
  for (const src of sources) {
    const parent = dirname(src) ?? base
    const rel = samePath(parent, base) ? '' : parent.slice(normalize(base).replace(/[\\/]$/, '').length + 1)
    groups.set(rel, [...(groups.get(rel) ?? []), src])
  }
  return groups
}

export async function transferItems(op: TransferOp, sources: string[], dest: string, conflict?: ConflictPolicy, extra: TransferExtra = {}): Promise<void> {
  if (!sources.length) return
  rememberSelection()
  if (!dest) {
    toast('No destination folder', 'error')
    return
  }
  // Nested items (from Flat View or an expanded folder): ask whether to recreate their folders.
  let plan: { dest: string; sources: string[]; ensure: boolean }[] = [{ dest, sources, ensure: !!extra.ensureDestDir }]
  const groups = extra.noNestedPrompt ? null : nestedGroups(sources, sourceDir())
  if (groups) {
    const mode = await openDialog<'structure' | 'single'>('nested', { op, count: sources.length })
    if (!mode) return
    if (mode === 'structure') plan = [...groups].map(([rel, srcs]) => ({ dest: rel ? join(dest, rel) : dest, sources: srcs, ensure: !!rel }))
  }
  const targets = plan.flatMap((g) => g.sources.map((src) => ({ src, target: join(g.dest, extra.renames?.[src] ?? basename(src)) })))
  const exists = await api().exists(targets.map((t) => t.target))
  const conflicts = targets.filter((t, i) => exists[i] && !samePath(t.target, t.src)).map((t) => t.target)
  let policy: ConflictPolicy = conflict ?? 'skip'
  if (conflicts.length && !conflict) {
    const answer = await openDialog<ConflictPolicy>('conflict', { conflicts: conflicts.map((c) => basename(c)), op })
    if (!answer) return
    policy = answer
  }
  const jobId = newJobId()
  setState((s) => ({
    jobs: {
      ...s.jobs,
      [jobId]: { jobId, op, currentFile: '', doneBytes: 0, totalBytes: 0, doneFiles: 0, totalFiles: 0, finished: false, errors: [] }
    }
  }))
  try {
    const errors: string[] = []
    let done = 0
    let cancelled = false
    for (const g of plan) {
      const res = await api().transfer(
        { op, sources: g.sources, destDir: g.dest, conflict: policy, renames: extra.renames, onlyExisting: extra.onlyExisting, ensureDestDir: g.ensure },
        jobId
      )
      errors.push(...res.errors)
      done += res.doneFiles
      if (res.cancelled) {
        cancelled = true
        break
      }
    }
    if (errors.length) toast(`${op === 'copy' ? 'Copy' : 'Move'} finished with ${errors.length} error(s): ${errors[0]}`, 'error')
    else if (cancelled) toast('Operation cancelled')
    else toast(`${op === 'copy' ? 'Copied' : 'Moved'} ${done} file(s)`)
  } catch (e) {
    toast(cleanError(e), 'error')
  } finally {
    setTimeout(() => setState((s) => {
      const jobs = { ...s.jobs }
      delete jobs[jobId]
      return { jobs }
    }), 600)
    refreshUndo()
    await refreshAll()
  }
}

export async function copySelectedToDest(op: TransferOp, dest?: string): Promise<void> {
  const s = getState()
  const items = selectedEntries(s.activePane)
  const target = dest ?? destDir()
  if (!items.length) return
  if (!s.prefs.dualDisplay && !dest) {
    const picked = await openDialog<string>('prompt', {
      title: op === 'copy' ? 'Copy to' : 'Move to',
      label: 'Destination folder',
      value: target,
      browse: true
    })
    if (!picked) return
    return transferItems(op, items.map((e) => e.path), picked)
  }
  await transferItems(op, items.map((e) => e.path), target)
}

export async function deleteSelected(permanent = false, quiet = false): Promise<void> {
  const s = getState()
  const pane = s.activePane
  const items = selectedEntries(pane)
  if (!items.length) return
  const useTrash = s.prefs.useTrash && !permanent
  if (s.prefs.confirmDelete && !quiet) {
    const ok = await openDialog<boolean>('confirm', {
      title: useTrash ? 'Move to Trash' : 'Delete permanently',
      message:
        items.length === 1
          ? `${useTrash ? 'Move' : 'Permanently delete'} "${items[0].name}"${useTrash ? ' to the trash' : ''}?`
          : `${useTrash ? 'Move' : 'Permanently delete'} ${items.length} items${useTrash ? ' to the trash' : ''}?`,
      danger: !useTrash,
      okLabel: 'Delete'
    })
    if (!ok) return
  }
  const tab = activeTab(pane)
  const entries = visibleEntries(tab, s.prefs)
  const lastIdx = entries.findIndex((e) => e.path === items[items.length - 1].path)
  const next = entries.slice(lastIdx + 1).find((e) => !items.some((i) => i.path === e.path)) ?? entries.slice(0, lastIdx).reverse().find((e) => !items.some((i) => i.path === e.path))
  const errors = await api().remove(items.map((e) => e.path), useTrash)
  if (errors.length) toast(`Delete: ${errors.length} error(s): ${errors[0]}`, 'error')
  updateTab(pane, null, () => ({ selected: new Set(), focusPath: next?.path ?? null }))
  await refreshAll()
}

export async function createFolder(name?: string): Promise<void> {
  const pane = getState().activePane
  const dir = activeTab(pane).path
  const n = name ?? (await openDialog<string>('prompt', { title: 'Create Folder', label: 'New folder name', value: 'New Folder', validateName: true }))
  if (!n) return
  try {
    const created = await api().mkdir(dir, n)
    await refreshPane(pane, basename(created))
    updateTab(pane, null, () => ({ selected: new Set([created]) }))
    refreshUndo()
  } catch (e) {
    toast(cleanError(e), 'error')
  }
}

export async function createFile(name?: string): Promise<void> {
  const pane = getState().activePane
  const dir = activeTab(pane).path
  const n = name ?? (await openDialog<string>('prompt', { title: 'Create File', label: 'New file name', value: 'New Text Document.txt', validateName: true }))
  if (!n) return
  try {
    const created = await api().createFile(dir, n)
    await refreshPane(pane, basename(created))
    updateTab(pane, null, () => ({ selected: new Set([created]) }))
    refreshUndo()
  } catch (e) {
    toast(cleanError(e), 'error')
  }
}

export function startInlineRename(pane: 0 | 1 = getState().activePane): void {
  const tab = activeTab(pane)
  const target = selectedEntries(pane)[0]?.path ?? tab.focusPath
  if (target) updateTab(pane, null, () => ({ renaming: target, focusPath: target }))
}

export async function commitInlineRename(pane: 0 | 1, from: string, newName: string): Promise<void> {
  updateTab(pane, null, () => ({ renaming: null }))
  if (!newName || newName === basename(from)) return
  try {
    const to = await api().rename(from, newName)
    moveLabels([{ from, to }])
    await refreshPane(pane, basename(to))
    updateTab(pane, null, () => ({ selected: new Set([to]) }))
    refreshUndo()
  } catch (e) {
    toast(cleanError(e), 'error')
  }
}

export async function advancedRename(): Promise<void> {
  const pane = getState().activePane
  const items = selectedEntries(pane)
  if (!items.length) return
  const pairs = await openDialog<{ from: string; to: string }[]>('rename', { entries: items })
  if (!pairs || !pairs.length) return
  const r = await api().renameMany(pairs)
  moveLabels(r.done)
  if (r.errors.length) toast(`Rename: ${r.errors.length} error(s): ${r.errors[0]}`, 'error')
  else toast(`Renamed ${r.done.length} item(s)`)
  await refreshPane(pane)
  updateTab(pane, null, () => ({ selected: new Set(r.done.map((d) => d.to)) }))
  refreshUndo()
}

export function clipboardSet(cut: boolean): void {
  const items = selectedEntries(getState().activePane)
  if (!items.length) return
  setState({ clipboard: { paths: items.map((e) => e.path), cut } })
  void api().writeClipboardText(items.map((e) => e.path).join('\n'))
  toast(`${items.length} item(s) ${cut ? 'cut' : 'copied'} to clipboard`)
}

export async function clipboardPaste(): Promise<void> {
  const clip = getState().clipboard
  if (!clip) return
  const dest = sourceDir()
  await transferItems(clip.cut ? 'move' : 'copy', clip.paths, dest)
  if (clip.cut) setState({ clipboard: null })
}

export function copyNames(full = true): void {
  const items = selectedEntries(getState().activePane)
  if (!items.length) return
  void api().writeClipboardText(items.map((e) => (full ? e.path : e.name)).join('\n'))
  toast(`Copied ${items.length} ${full ? 'path' : 'name'}(s)`)
}

export async function computeSizes(all = false): Promise<void> {
  const pane = getState().activePane
  const tab = activeTab(pane)
  const dirs = (all ? visibleEntries(tab, getState().prefs) : selectedEntries(pane)).filter((e) => e.isDir)
  const targets = dirs.length ? dirs : visibleEntries(tab, getState().prefs).filter((e) => e.isDir)
  await Promise.all(
    targets.map(async (d) => {
      const r = await api().folderSize(d.path, newJobId())
      updateTab(pane, tab.id, (t) => ({ sizes: { ...t.sizes, [d.path]: r.bytes } }))
    })
  )
}

export async function undoLast(): Promise<void> {
  const label = getState().undoLabel
  if (!label) {
    toast('Nothing to undo')
    return
  }
  const errors = await api().undo()
  if (errors.length) toast(`Undo: ${errors[0]}`, 'error')
  else toast(`Undone: ${label}`)
  refreshUndo()
  await refreshAll()
}

export function isFavorite(path: string): boolean {
  return getState().favorites.some((f) => samePath(f.path, path))
}

function saveFavorites(favorites: Favorite[]): void {
  setState({ favorites })
  void api().setSettings({ favorites })
}

export function toggleFavorite(path: string = sourceDir()): void {
  const exists = isFavorite(path)
  saveFavorites(exists ? getState().favorites.filter((f) => !samePath(f.path, path)) : [...getState().favorites, { path }])
  toast(exists ? 'Removed from favorites' : 'Added to favorites')
}

/** Removes one favorite entry (the same folder may appear in several groups). */
export function removeFavorite(fav: Favorite): void {
  saveFavorites(getState().favorites.filter((f) => f !== fav))
}

export async function renameFavorite(fav: Favorite): Promise<void> {
  const label = await openDialog<string>('prompt', { title: 'Rename favorite', label: `Name shown for ${fav.path}`, value: fav.label ?? (basename(fav.path) || fav.path), allowEmpty: true })
  if (label === null || label === undefined) return
  const clean = label.trim()
  saveFavorites(getState().favorites.map((f) => (f === fav ? { ...f, label: clean && clean !== basename(f.path) ? clean : undefined } : f)))
}

export async function moveFavoriteToGroup(fav: Favorite): Promise<void> {
  const group = await openDialog<string>('prompt', { title: 'Favorite group', label: 'Group name (empty = no group; use " / " for sub-groups)', value: fav.group ?? '', allowEmpty: true })
  if (group === null || group === undefined) return
  saveFavorites(getState().favorites.map((f) => (f === fav ? { ...f, group: group.trim() || undefined } : f)))
}

export function toggleFavoriteGroup(group: string): void {
  const cur = getState().prefs.favoritesCollapsed
  setPrefs({ favoritesCollapsed: cur.includes(group) ? cur.filter((g) => g !== group) : [...cur, group] })
}

export async function dropPaths(paths: string[], dest: string, mods: { ctrl: boolean; shift: boolean }): Promise<void> {
  const srcs = paths.filter((p) => !samePath(dirname(p) ?? '', dest) && !samePath(p, dest))
  if (!srcs.length) return
  let op: TransferOp
  if (mods.shift) op = 'move'
  else if (mods.ctrl) op = 'copy'
  else op = (await api().sameVolume(srcs[0], dest)) ? 'move' : 'copy'
  await transferItems(op, srcs, dest)
}

export async function syncFolders(): Promise<void> {
  const s = getState()
  await openDialog('sync', { left: activeTab(s.activePane).path, right: activeTab(destPane(s)).path })
  await refreshAll()
}

export async function showProperties(): Promise<void> {
  const items = selectedEntries(getState().activePane)
  if (!items.length) return
  await openDialog('properties', { entries: items })
  await refreshPane(getState().activePane)
}

export function resetToDefaults(): void {
  setPrefs({ ...DEFAULT_PREFS, setupDone: true })
}

export function sourcePaneIndex(): 0 | 1 {
  return getState().activePane
}

export const toastMsg = toast

// ---------------------------------------------------------------------------
// Folder formats (view / sort / grouping remembered per folder)
// ---------------------------------------------------------------------------

function formatKey(p: string): string {
  return getState().info.platform === 'win32' || getState().info.platform === 'darwin' ? p.toLowerCase() : p
}

function folderFormatFor(p: string): FolderFormat | undefined {
  const s = getState()
  if (!s.prefs.rememberFolderFormats) return undefined
  return s.folderFormats[formatKey(p)]
}

/** Changes view mode / sort / grouping of the active tab and remembers it for the folder. */
export function setFormat(pane: 0 | 1, patch: { viewMode?: ViewMode; sort?: SortSpec; groupBy?: GroupBy }): void {
  updateTab(pane, null, (t) => ({ ...patch, collapsedGroups: patch.groupBy !== undefined ? new Set() : t.collapsedGroups, scrollTick: t.scrollTick + 1 }))
  const s = getState()
  if (!s.prefs.rememberFolderFormats) return
  const t = activeTab(pane, s)
  if (!t.path || t.flat) return
  const folderFormats = { ...s.folderFormats, [formatKey(t.path)]: { viewMode: t.viewMode, sort: t.sort, groupBy: t.groupBy } }
  setState({ folderFormats })
  void api().setSettings({ folderFormats })
}

export function clearFolderFormats(): void {
  setState({ folderFormats: {} })
  void api().setSettings({ folderFormats: {} })
}

export function toggleGroup(pane: 0 | 1, key: string): void {
  updateTab(pane, null, (t) => {
    const next = new Set(t.collapsedGroups)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return { collapsedGroups: next }
  })
}

// ---------------------------------------------------------------------------
// Labels (colour tags)
// ---------------------------------------------------------------------------

function persistLabels(labels: Record<string, string[]>): void {
  setState({ labels })
  void api().setSettings({ labels })
}

export function toggleLabel(paths: string[], id: string): void {
  if (!paths.length) return
  const labels = { ...getState().labels }
  const allHave = paths.every((p) => labels[p]?.includes(id))
  for (const p of paths) {
    const cur = labels[p] ?? []
    const next = allHave ? cur.filter((x) => x !== id) : cur.includes(id) ? cur : [...cur, id]
    if (next.length) labels[p] = next
    else delete labels[p]
  }
  persistLabels(labels)
}

export function clearLabels(paths: string[]): void {
  const labels = { ...getState().labels }
  for (const p of paths) delete labels[p]
  persistLabels(labels)
}

/** Keeps labels attached to items that were renamed or moved inside Opal. */
export function moveLabels(pairs: { from: string; to: string }[]): void {
  const cur = getState().labels
  if (!pairs.some((p) => cur[p.from])) return
  const labels = { ...cur }
  for (const { from, to } of pairs) {
    if (labels[from]) {
      labels[to] = labels[from]
      delete labels[from]
    }
  }
  persistLabels(labels)
}

// ---------------------------------------------------------------------------
// Lazy metadata for Dimensions / Items columns and infotips
// ---------------------------------------------------------------------------

const metaPending = new Set<string>()
let metaTimer: ReturnType<typeof setTimeout> | null = null

export function requestMeta(paths: string[]): void {
  const have = getState().meta
  for (const p of paths) if (!have[p] && !metaPending.has(p)) metaPending.add(p)
  if (!metaPending.size || metaTimer) return
  metaTimer = setTimeout(async () => {
    metaTimer = null
    const batch = [...metaPending].slice(0, 300)
    for (const p of batch) metaPending.delete(p)
    try {
      const res = await api().meta(batch)
      setState((st) => ({ meta: { ...st.meta, ...res } }))
    } catch {
      // ignore
    }
    if (metaPending.size) requestMeta([])
  }, 60)
}

// ---------------------------------------------------------------------------
// Quick Look (Space)
// ---------------------------------------------------------------------------

export function toggleQuickLook(on?: boolean): void {
  const s = getState()
  const next = on ?? !s.quickLook
  if (next && !findVisible(activeTab(s.activePane, s), s.prefs, activeTab(s.activePane, s).focusPath)) return
  setState({ quickLook: next })
}

// ---------------------------------------------------------------------------
// Column view (Finder-style Miller columns)
// ---------------------------------------------------------------------------

export async function loadColumn(pane: 0 | 1, dir: string): Promise<FileEntry[] | null> {
  const tab = activeTab(pane)
  if (tab.children[dir]) return tab.children[dir]
  try {
    const entries = (await api().list(dir)).entries
    updateTab(pane, tab.id, (t) => ({ children: { ...t.children, [dir]: entries } }))
    return entries
  } catch {
    return null
  }
}

export async function columnRight(pane: 0 | 1): Promise<void> {
  const s = getState()
  const tab = activeTab(pane, s)
  const e = findVisible(tab, s.prefs, tab.focusPath)
  if (!e?.isDir) return
  const kids = await loadColumn(pane, e.path)
  const t2 = activeTab(pane)
  const first = (kids ?? []).filter((k) => getState().prefs.showHidden || !k.hidden)
  if (!first.length) return
  const sorted = [...first].sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.isDir ? -1 : 1))
  updateTab(pane, t2.id, (t) => ({ focusPath: sorted[0].path, anchorPath: sorted[0].path, selected: new Set([sorted[0].path]), scrollTick: t.scrollTick + 1 }))
}

export function columnLeft(pane: 0 | 1): void {
  const tab = activeTab(pane)
  const dir = activeColumnDir(tab)
  if (samePath(dir, tab.path)) return
  updateTab(pane, null, (t) => ({ focusPath: dir, anchorPath: dir, selected: new Set([dir]), scrollTick: t.scrollTick + 1 }))
}

// ---------------------------------------------------------------------------
// Semantic search folders
// ---------------------------------------------------------------------------

export async function setSemanticFolders(folders: string[]): Promise<void> {
  const unique = [...new Set(folders.filter(Boolean))]
  setPrefs({ semanticFolders: unique })
  setState({ semantic: await api().semanticSetFolders(unique) })
}

export async function addSemanticFolder(folder: string): Promise<void> {
  const cur = getState().prefs.semanticFolders
  if (cur.some((f) => samePath(f, folder) || isAncestor(f, folder))) {
    toast('Already indexed: re-scanning')
    void api().semanticRescan()
    return
  }
  await setSemanticFolders([...cur, folder])
  toast(`Indexing "${basename(folder)}" for semantic search`)
}

export async function openSemantic(root?: string): Promise<void> {
  await openDialog('semantic', { root: root ?? sourceDir() })
}
