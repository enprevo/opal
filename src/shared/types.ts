export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  isSymlink: boolean
  size: number
  mtime: number
  ctime: number
  atime: number
  ext: string
  hidden: boolean
  readonly: boolean
  mode: number
  /** Nesting level when shown inside an expanded folder (0 or undefined = top level). */
  depth?: number
}

export interface DirListing {
  path: string
  parent: string | null
  entries: FileEntry[]
  freeBytes?: number
  totalBytes?: number
}

export type RootKind = 'drive' | 'home' | 'volume' | 'root' | 'special'

export interface RootInfo {
  path: string
  label: string
  kind: RootKind
}

export type ConflictPolicy = 'overwrite' | 'skip' | 'rename' | 'newer'

export type TransferOp = 'copy' | 'move'

export interface TransferRequest {
  op: TransferOp
  sources: string[]
  destDir: string
  conflict: ConflictPolicy
  /** Optional new names (basename) per source path, for Copy AS. */
  renames?: Record<string, string>
  /** Only transfer items that already exist in the destination (Copy UPDATEEXISTING). */
  onlyExisting?: boolean
  /** Create the destination folder if missing (recreating nested structure). */
  ensureDestDir?: boolean
}

export interface JobProgress {
  jobId: string
  op: string
  currentFile: string
  doneBytes: number
  totalBytes: number
  doneFiles: number
  totalFiles: number
  finished: boolean
  cancelled?: boolean
  errors: string[]
}

export interface FindOptions {
  root: string
  pattern: string
  recursive: boolean
  includeDirs: boolean
  contains?: string
  minSize?: number
  maxSize?: number
  modifiedAfter?: number
  modifiedBefore?: number
  limit?: number
}

export interface Preview {
  kind: 'text' | 'image' | 'video' | 'audio' | 'pdf' | 'binary' | 'dir' | 'error'
  path: string
  text?: string
  truncated?: boolean
  size?: number
  message?: string
}

export interface SyncItem {
  rel: string
  isDir: boolean
  status: 'leftOnly' | 'rightOnly' | 'leftNewer' | 'rightNewer' | 'sizeDiffers' | 'same'
  leftSize?: number
  rightSize?: number
  leftMtime?: number
  rightMtime?: number
}

export type UndoEntry =
  | { type: 'rename'; pairs: { from: string; to: string }[] }
  | { type: 'move'; pairs: { from: string; to: string }[] }
  | { type: 'copy'; created: string[] }
  | { type: 'create'; created: string[] }

export interface UndoInfo {
  available: boolean
  label: string
}

export type ViewMode = 'details' | 'list' | 'icons' | 'thumbnails' | 'columns'

export type Keymap = 'standard' | 'commander'

export type SortColumn =
  | 'name'
  | 'ext'
  | 'size'
  | 'mtime'
  | 'ctime'
  | 'atime'
  | 'type'
  | 'attr'
  | 'path'
  | 'label'
  | 'dimensions'
  | 'items'

export type GroupBy = 'none' | 'type' | 'ext' | 'mtime' | 'size' | 'name' | 'label' | 'kind'

export type FolderPlacement = 'first' | 'mixed' | 'last'

export interface FolderFormat {
  viewMode: ViewMode
  sort: SortSpec
  groupBy: GroupBy
}

export interface LabelDef {
  id: string
  name: string
  color: string
}

export const DEFAULT_LABELS: LabelDef[] = [
  { id: 'red', name: 'Red', color: '#ff5f57' },
  { id: 'orange', name: 'Orange', color: '#ff9f0a' },
  { id: 'yellow', name: 'Yellow', color: '#ffd60a' },
  { id: 'green', name: 'Green', color: '#32d74b' },
  { id: 'blue', name: 'Blue', color: '#0a84ff' },
  { id: 'purple', name: 'Purple', color: '#bf5af2' },
  { id: 'gray', name: 'Gray', color: '#98989d' }
]

export interface ItemMeta {
  width?: number
  height?: number
  items?: number
}

export interface SortSpec {
  column: SortColumn
  descending: boolean
}

export type LayoutPreset = 'single' | 'dualVertical' | 'dualHorizontal' | 'explorer' | 'commander' | 'images' | 'preview'

export interface Prefs {
  theme: 'dark' | 'light' | 'system'
  accent: string
  density: 'compact' | 'normal' | 'comfortable'
  uiFont: string
  stripes: boolean
  gridLines: boolean
  showExtensions: boolean
  folderPlacement: FolderPlacement
  naturalSort: boolean
  rememberFolderFormats: boolean
  spaceAction: 'quicklook' | 'select'
  helpers: boolean
  helperDelay: number
  infotips: boolean
  toolbarButtons: string[]
  toolbarLabels: boolean
  startup: 'restore' | 'folders'
  startupLeft: string
  startupRight: string
  semanticFolders: string[]
  semanticAutoIndex: boolean
  /** Also index source code (off by default: it drowns real documents). */
  semanticIncludeCode: boolean
  /** Rerank results with the cross-encoder (better precision, ~115 MB extra download). */
  semanticPrecise: boolean
  setupDone: boolean
  showHidden: boolean
  confirmDelete: boolean
  useTrash: boolean
  dualDisplay: boolean
  dualVertical: boolean
  showTree: boolean
  showViewer: boolean
  defaultViewMode: ViewMode
  columns: SortColumn[]
  dateFormat: 'locale' | 'iso' | 'relative' | 'custom'
  customDateFormat: string
  sizeUnits: 'auto' | 'bytes'
  singleClickOpen: boolean
  /** Folders can be expanded in place in the details view (tree-style). */
  expandableFolders: boolean
  /** Clear selections inside a folder when it is collapsed. */
  collapseClearsSelection: boolean
  /** Collapse sub-folders within a collapsed folder. */
  collapseSubfolders: boolean
  /** Default key bindings: standard (Ctrl+1/2/3 copy/move/rename) or Commander-style F-keys. */
  keymap: Keymap
  /** File display zoom (Set FONTSCALE), percent. */
  fontScale: number
  showStatusBar: boolean
}

export type { FavoriteNode, FavoriteItem, FavoriteGroup, FavoriteSeparator, FavoriteOpenIn } from './favorites'
import type { FavoriteNode } from './favorites'

/** Window layout remembered between sessions (sizes in pixels, ratio 0..1). */
export interface UiState {
  sidebarWidth?: number
  viewerWidth?: number
  paneRatio?: number
  /** Column widths of the details view, by column id. */
  columnWidths?: Record<string, number>
}

export interface SessionTab {
  path: string
  viewMode: ViewMode
  sort: SortSpec
}

export interface SessionPane {
  tabs: SessionTab[]
  activeTab: number
}

export interface PersistedState {
  prefs: Prefs
  favorites: FavoriteNode[]
  recent: string[]
  labels?: Record<string, string[]>
  labelDefs?: LabelDef[]
  folderFormats?: Record<string, FolderFormat>
  session?: { panes: SessionPane[]; activePane: number }
  /** Changes to the default key bindings: combo → command, or '' for a default binding that was removed. */
  hotkeys?: Record<string, string>
  toolbar?: ToolbarButton[]
  ui?: UiState
  /** Saved Advanced Rename presets, by name. */
  renamePresets?: Record<string, Record<string, unknown>>
}

export interface ToolbarButton {
  label: string
  command: string
  tooltip?: string
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'dark',
  accent: '#4c8dff',
  density: 'normal',
  uiFont: '',
  stripes: false,
  gridLines: false,
  showExtensions: true,
  folderPlacement: 'first',
  naturalSort: true,
  rememberFolderFormats: true,
  spaceAction: 'quicklook',
  helpers: true,
  helperDelay: 450,
  infotips: true,
  toolbarButtons: [],
  toolbarLabels: false,
  startup: 'restore',
  startupLeft: '',
  startupRight: '',
  semanticFolders: [],
  semanticAutoIndex: true,
  semanticIncludeCode: false,
  semanticPrecise: true,
  setupDone: false,
  showHidden: false,
  confirmDelete: true,
  useTrash: true,
  dualDisplay: true,
  dualVertical: true,
  showTree: true,
  showViewer: false,
  defaultViewMode: 'details',
  columns: ['name', 'size', 'type', 'mtime', 'attr'],
  dateFormat: 'locale',
  customDateFormat: 'yyyy-MM-dd HH:mm',
  sizeUnits: 'auto',
  singleClickOpen: false,
  expandableFolders: true,
  collapseClearsSelection: true,
  collapseSubfolders: true,
  keymap: 'standard',
  fontScale: 100,
  showStatusBar: true
}

export type SemanticMatch = 'meaning' | 'words' | 'name'

export interface SemanticHit {
  path: string
  name: string
  /** Relevance 0..1 (calibrated when the precision model is active). */
  score: number
  snippet: string
  /** 1-based page of the matching passage (PDF only). */
  page?: number
  /** Why the document was found. */
  matched: SemanticMatch[]
  /** Other files with identical content. */
  duplicates: string[]
  mtime: number
  size: number
}

export interface SemanticSearchOptions {
  folder?: string
  limit?: number
  /** Restrict to these extensions (lower case, no dot). */
  exts?: string[]
  /** Only documents modified after this time (ms). */
  after?: number
  /** Collect ranking signals for tuning (tests only). */
  explain?: boolean
}

export interface SemanticSearchResult {
  hits: SemanticHit[]
  /** 'precise' = reranked by the cross-encoder; 'semantic' = vectors + keywords; 'keywords' = model not available yet. */
  mode: 'precise' | 'semantic' | 'keywords'
  ms: number
}

export type ModelState = 'idle' | 'loading' | 'ready' | 'error'

export interface SemanticStatus {
  ready: boolean
  model: string
  modelState: ModelState
  modelError?: string
  rerankState: ModelState
  rerankError?: string
  indexing: boolean
  queued: number
  /** Files processed in the current indexing run (for progress and ETA). */
  done: number
  total: number
  startedAt?: number
  indexedFiles: number
  indexedChunks: number
  currentFile?: string
  folders: string[]
  /** True when the folder scan stopped at the file limit. */
  truncated?: boolean
}
