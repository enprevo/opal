import { useSyncExternalStore } from 'react'
import type { AppInfo } from '../../../preload'
import {
  DEFAULT_LABELS,
  DEFAULT_PREFS,
  type DirListing,
  type Favorite,
  type UiState,
  type FileEntry,
  type FolderFormat,
  type GroupBy,
  type ItemMeta,
  type JobProgress,
  type LabelDef,
  type Prefs,
  type RootInfo,
  type SemanticStatus,
  type SortSpec,
  type ViewMode
} from '@shared/types'
import { groupEntries, sortEntries, type GroupInfo } from '@shared/sort'
import { compilePattern } from '@shared/wildcard'
import { dirname } from '@shared/paths'

export interface TabState {
  id: string
  path: string
  listing: DirListing | null
  loading: boolean
  error: string | null
  history: string[]
  historyIndex: number
  viewMode: ViewMode
  sort: SortSpec
  filter: string
  selected: ReadonlySet<string>
  focusPath: string | null
  anchorPath: string | null
  renaming: string | null
  sizes: Readonly<Record<string, number>>
  /** Increments to ask the file list to scroll the focused item into view. */
  scrollTick: number
  /** Flat View: show all files from subfolders (names are relative paths). */
  flat: boolean
  /** Expandable folders: folders expanded in place in the file list. */
  expanded: ReadonlySet<string>
  /** Cached listings of expanded folders. */
  children: Readonly<Record<string, FileEntry[]>>
  /** Expanded folders remembered per visited path (restored on back/forward). */
  expandedByPath: Readonly<Record<string, string[]>>
  /** Previous quick filter, for Set QUICKFILTER=!prev. */
  prevFilter: string
  /** Group By. */
  groupBy: GroupBy
  /** Collapsed group keys. */
  collapsedGroups: ReadonlySet<string>
}

export interface PaneState {
  tabs: TabState[]
  activeTab: number
  /** Recently closed tab paths, for Go TABUNDOCLOSE. */
  closedTabs?: string[]
}

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
}

export interface DialogRequest {
  type: string
  props: Record<string, unknown>
  resolve: (value: unknown) => void
}

export interface AppState {
  ready: boolean
  info: AppInfo
  prefs: Prefs
  favorites: Favorite[]
  recent: string[]
  hotkeys: Record<string, string>
  /** Pane sizes and column widths (persisted). */
  ui: UiState
  renamePresets: Record<string, Record<string, unknown>>
  panes: [PaneState, PaneState]
  activePane: 0 | 1
  roots: RootInfo[]
  clipboard: { paths: string[]; cut: boolean } | null
  jobs: Record<string, JobProgress>
  dialog: DialogRequest | null
  contextMenu: { x: number; y: number; pane: 0 | 1; target: FileEntry | null } | null
  toasts: Toast[]
  undoLabel: string
  cliOpen: boolean
  editingPath: 0 | 1 | null
  focusArea: 'list' | 'tree'
  /** Navigation Lock: both displays navigate together. */
  navLock: boolean
  /** Colour labels (tags) per path, and their definitions. */
  labels: Readonly<Record<string, string[]>>
  labelDefs: LabelDef[]
  /** Lazily loaded column metadata (image dimensions, folder item counts). */
  meta: Readonly<Record<string, ItemMeta>>
  /** Remembered view/sort/grouping per folder. */
  folderFormats: Readonly<Record<string, FolderFormat>>
  /** Quick Look (Space) preview overlay. */
  quickLook: boolean
  semantic: SemanticStatus | null
}

let tabCounter = 0

export function newTabState(path: string, viewMode: ViewMode = 'details', sort?: SortSpec): TabState {
  return {
    id: `tab${++tabCounter}`,
    path,
    listing: null,
    loading: false,
    error: null,
    history: [path],
    historyIndex: 0,
    viewMode,
    sort: sort ?? { column: 'name', descending: false },
    filter: '',
    selected: new Set(),
    focusPath: null,
    anchorPath: null,
    renaming: null,
    sizes: {},
    scrollTick: 0,
    flat: false,
    expanded: new Set(),
    children: {},
    expandedByPath: {},
    prevFilter: '',
    groupBy: 'none',
    collapsedGroups: new Set()
  }
}

const initial: AppState = {
  ready: false,
  info: { platform: 'win32', home: '', sep: '\\', argv: [], startPaths: [], primary: true, noSetup: false, version: '' },
  navLock: false,
  labels: {},
  labelDefs: DEFAULT_LABELS,
  meta: {},
  folderFormats: {},
  quickLook: false,
  semantic: null,
  prefs: { ...DEFAULT_PREFS },
  favorites: [],
  recent: [],
  hotkeys: {},
  ui: {},
  renamePresets: {},
  panes: [
    { tabs: [newTabState('')], activeTab: 0 },
    { tabs: [newTabState('')], activeTab: 0 }
  ],
  activePane: 0,
  roots: [],
  clipboard: null,
  jobs: {},
  dialog: null,
  contextMenu: null,
  toasts: [],
  undoLabel: '',
  cliOpen: false,
  editingPath: null,
  focusArea: 'list'
}

let state: AppState = initial
const listeners = new Set<() => void>()

export function getState(): AppState {
  return state
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...p }
  for (const l of listeners) l()
}

export function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state))
}

export function activeTab(pane: 0 | 1, s: AppState = state): TabState {
  const p = s.panes[pane]
  return p.tabs[p.activeTab]
}

export function sourcePane(s: AppState = state): 0 | 1 {
  return s.activePane
}

export function destPane(s: AppState = state): 0 | 1 {
  return s.activePane === 0 ? 1 : 0
}

export function updateTab(pane: 0 | 1, tabId: string | null, fn: (t: TabState) => Partial<TabState>): void {
  setState((s) => {
    const p = s.panes[pane]
    const idx = tabId === null ? p.activeTab : p.tabs.findIndex((t) => t.id === tabId)
    if (idx < 0) return {}
    const tabs = p.tabs.slice()
    tabs[idx] = { ...tabs[idx], ...fn(tabs[idx]) }
    const panes = s.panes.slice() as [PaneState, PaneState]
    panes[pane] = { ...p, tabs }
    return { panes }
  })
}

export function updatePane(pane: 0 | 1, fn: (p: PaneState) => Partial<PaneState>): void {
  setState((s) => {
    const panes = s.panes.slice() as [PaneState, PaneState]
    panes[pane] = { ...s.panes[pane], ...fn(s.panes[pane]) }
    return { panes }
  })
}

// Memoised visible entries per tab (filter + hidden + sort + grouping + expanded folders)
export interface DisplayRow {
  kind: 'group' | 'item'
  entry?: FileEntry
  group?: GroupInfo
  count?: number
  collapsed?: boolean
}

interface VisibleCache {
  key: string
  tab: TabState
  labels: AppState['labels']
  meta: AppState['meta']
  result: FileEntry[]
  rows: DisplayRow[]
}
const visibleCache = new WeakMap<DirListing, VisibleCache>()

function makeMatcher(filter: string): ((n: string) => boolean) | null {
  const f = filter.trim()
  if (!f) return null
  try {
    return /[*?[(~#;]/.test(f) || f.toLowerCase().startsWith('regex:') ? compilePattern(f) : compilePattern(`*${f.replace(/'/g, "''")}*`)
  } catch {
    return null
  }
}

export function treeMode(tab: TabState, prefs: Prefs): boolean {
  return prefs.expandableFolders && tab.viewMode === 'details' && !tab.flat
}

function parentPath(p: string): string {
  return dirname(p) ?? p
}

/** Column view: the folder whose contents form the active (focused) column. */
export function activeColumnDir(tab: TabState): string {
  if (!tab.focusPath) return tab.path
  const parent = parentPath(tab.focusPath)
  return parent === tab.path || tab.children[parent] ? parent : tab.path
}

function compute(tab: TabState, prefs: Prefs): VisibleCache {
  const listing = tab.listing!
  const s = state
  const match = makeMatcher(tab.filter)
  const ctx = { placement: prefs.folderPlacement, natural: prefs.naturalSort, labels: s.labels, meta: s.meta }
  const prepare = (list: FileEntry[]): FileEntry[] => {
    let entries = list
    if (!prefs.showHidden) entries = entries.filter((e) => !e.hidden)
    // Expanded folders stay visible so their filtered contents remain reachable.
    if (match) entries = entries.filter((e) => match(e.name) || (e.isDir && tab.expanded.has(e.path)))
    if (Object.keys(tab.sizes).length)
      entries = entries.map((e) => (e.isDir && tab.sizes[e.path] !== undefined ? { ...e, size: tab.sizes[e.path] } : e))
    return sortEntries(entries, tab.sort, ctx)
  }
  if (tab.viewMode === 'columns') {
    const dir = activeColumnDir(tab)
    const list = dir === tab.path ? listing.entries : tab.children[dir] ?? []
    const result = prepare(list)
    return { key: '', tab, labels: s.labels, meta: s.meta, result, rows: result.map((entry) => ({ kind: 'item', entry })) }
  }
  const top = prepare(listing.entries)
  const labelNames = Object.fromEntries(s.labelDefs.map((l) => [l.id, l.name]))
  const groups = tab.groupBy !== 'none' && tab.viewMode === 'details' ? groupEntries(top, tab.groupBy, { ...ctx, labelNames }) : null
  const result: FileEntry[] = []
  const rows: DisplayRow[] = []
  const tree = treeMode(tab, prefs) && tab.expanded.size > 0
  const walk = (list: FileEntry[], depth: number): void => {
    for (const e of list) {
      const item = depth ? { ...e, depth } : e
      result.push(item)
      rows.push({ kind: 'item', entry: item })
      const kids = tree && e.isDir && tab.expanded.has(e.path) ? tab.children[e.path] : undefined
      if (kids) walk(prepare(kids), depth + 1)
    }
  }
  if (groups) {
    for (const g of groups) {
      const collapsed = tab.collapsedGroups.has(g.group.key)
      rows.push({ kind: 'group', group: g.group, count: g.entries.length, collapsed })
      if (!collapsed) walk(g.entries, 0)
    }
  } else walk(top, 0)
  return { key: '', tab, labels: s.labels, meta: s.meta, result, rows }
}

function cached(tab: TabState, prefs: Prefs): VisibleCache | null {
  const listing = tab.listing
  if (!listing) return null
  const key = `${tab.filter}|${prefs.showHidden}|${prefs.folderPlacement}|${prefs.naturalSort}|${prefs.expandableFolders}|${tab.sort.column}|${tab.sort.descending}|${tab.viewMode}|${tab.flat}|${tab.groupBy}|${tab.focusPath && tab.viewMode === 'columns' ? activeColumnDir(tab) : ''}`
  const c = visibleCache.get(listing)
  const sortUsesMeta = tab.sort.column === 'dimensions' || tab.sort.column === 'items'
  const usesLabels = tab.sort.column === 'label' || tab.groupBy === 'label'
  if (
    c &&
    c.key === key &&
    c.tab.expanded === tab.expanded &&
    c.tab.children === tab.children &&
    c.tab.sizes === tab.sizes &&
    c.tab.collapsedGroups === tab.collapsedGroups &&
    (!usesLabels || c.labels === state.labels) &&
    (!sortUsesMeta || c.meta === state.meta)
  )
    return c
  const fresh = { ...compute(tab, prefs), key }
  visibleCache.set(listing, fresh)
  return fresh
}

export function visibleEntries(tab: TabState, prefs: Prefs): FileEntry[] {
  return cached(tab, prefs)?.result ?? []
}

/** Sorted/filtered children of an arbitrary folder (used by the column view). */
export function prepareList(tab: TabState, prefs: Prefs, list: FileEntry[]): FileEntry[] {
  let entries = list
  if (!prefs.showHidden) entries = entries.filter((e) => !e.hidden)
  return sortEntries(entries, tab.sort, { placement: prefs.folderPlacement, natural: prefs.naturalSort, labels: state.labels, meta: state.meta })
}

/** Rows to render (items interleaved with group headers). */
export function displayRows(tab: TabState, prefs: Prefs): DisplayRow[] {
  return cached(tab, prefs)?.rows ?? []
}

export function findVisible(tab: TabState, prefs: Prefs, path: string | null): FileEntry | null {
  if (!path) return null
  return visibleEntries(tab, prefs).find((e) => e.path === path) ?? null
}

let toastId = 0
export function toast(text: string, kind: 'info' | 'error' = 'info'): void {
  const id = ++toastId
  setState((s) => ({ toasts: [...s.toasts, { id, text, kind }] }))
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 6000 : 3000)
}

export function openDialog<T>(type: string, props: Record<string, unknown> = {}): Promise<T | null> {
  return new Promise((resolve) => {
    setState({ dialog: { type, props, resolve: resolve as (v: unknown) => void } })
  })
}

export function closeDialog(value: unknown): void {
  const d = state.dialog
  setState({ dialog: null })
  d?.resolve(value)
}
