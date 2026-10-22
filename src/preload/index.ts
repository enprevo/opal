import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type {
  DirListing,
  FileEntry,
  FindOptions,
  JobProgress,
  PersistedState,
  Preview,
  RootInfo,
  SyncItem,
  TransferRequest,
  UndoInfo,
  ItemMeta,
  SemanticSearchOptions,
  SemanticSearchResult,
  SemanticStatus
} from '../shared/types'

export interface AppInfo {
  platform: NodeJS.Platform
  home: string
  sep: string
  argv: string[]
  startPaths: string[]
  primary: boolean
  noSetup: boolean
  version: string
}

const api = {
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
  getSettings: (): Promise<PersistedState> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<PersistedState>): Promise<PersistedState> => ipcRenderer.invoke('settings:set', patch),

  list: (p: string, flat = false): Promise<DirListing> => ipcRenderer.invoke('fs:list', p, flat),
  hash: (p: string, algo: 'md5' | 'sha1' | 'sha256'): Promise<string> => ipcRenderer.invoke('fs:hash', p, algo),
  duplicates: (root: string, opts: { minSize?: number; recursive?: boolean }, jobId: string): Promise<{ size: number; hash: string; paths: string[] }[]> =>
    ipcRenderer.invoke('fs:duplicates', root, opts, jobId),
  newWindow: (startPath?: string): Promise<void> => ipcRenderer.invoke('window:new', startPath),
  subdirs: (p: string, showHidden: boolean): Promise<FileEntry[]> => ipcRenderer.invoke('fs:subdirs', p, showHidden),
  roots: (): Promise<RootInfo[]> => ipcRenderer.invoke('fs:roots'),
  exists: (paths: string[]): Promise<boolean[]> => ipcRenderer.invoke('fs:exists', paths),
  sameVolume: (a: string, b: string): Promise<boolean> => ipcRenderer.invoke('fs:sameVolume', a, b),
  stat: (p: string): Promise<FileEntry> => ipcRenderer.invoke('fs:stat', p),
  mkdir: (parent: string, name: string): Promise<string> => ipcRenderer.invoke('fs:mkdir', parent, name),
  createFile: (parent: string, name: string): Promise<string> => ipcRenderer.invoke('fs:createFile', parent, name),
  rename: (from: string, newName: string): Promise<string> => ipcRenderer.invoke('fs:rename', from, newName),
  renameMany: (pairs: { from: string; to: string }[]): Promise<{ done: { from: string; to: string }[]; errors: string[] }> =>
    ipcRenderer.invoke('fs:renameMany', pairs),
  remove: (paths: string[], useTrash: boolean): Promise<string[]> => ipcRenderer.invoke('fs:delete', paths, useTrash),
  transfer: (req: TransferRequest, jobId: string): Promise<JobProgress> => ipcRenderer.invoke('fs:transfer', req, jobId),
  cancelJob: (jobId: string): Promise<void> => ipcRenderer.invoke('job:cancel', jobId),
  folderSize: (p: string, jobId: string): Promise<{ bytes: number; files: number; dirs: number }> =>
    ipcRenderer.invoke('fs:size', p, jobId),
  find: (opts: FindOptions, jobId: string): Promise<number> => ipcRenderer.invoke('fs:find', opts, jobId),
  preview: (p: string): Promise<Preview> => ipcRenderer.invoke('fs:preview', p),
  meta: (paths: string[]): Promise<Record<string, ItemMeta>> => ipcRenderer.invoke('fs:meta', paths),
  zipList: (p: string): Promise<{ name: string; size: number }[]> => ipcRenderer.invoke('fs:zipList', p),
  semanticStatus: (start = true): Promise<SemanticStatus> => ipcRenderer.invoke('semantic:status', start),
  semanticSetFolders: (folders: string[]): Promise<SemanticStatus> => ipcRenderer.invoke('semantic:setFolders', folders),
  semanticRescan: (): Promise<SemanticStatus> => ipcRenderer.invoke('semantic:rescan'),
  semanticSearch: (q: string, opts: SemanticSearchOptions = {}): Promise<SemanticSearchResult> => ipcRenderer.invoke('semantic:search', q, opts),
  semanticSetOptions: (opts: { includeCode?: boolean; rerank?: boolean }): Promise<SemanticStatus> => ipcRenderer.invoke('semantic:setOptions', opts),
  semanticCancel: (): Promise<void> => ipcRenderer.invoke('semantic:cancel'),
  semanticClear: (): Promise<void> => ipcRenderer.invoke('semantic:clear'),
  onSemanticStatus: (cb: (s: SemanticStatus) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, s: SemanticStatus): void => cb(s)
    ipcRenderer.on('semantic:status', h)
    return () => ipcRenderer.removeListener('semantic:status', h)
  },
  systemTheme: (): Promise<'dark' | 'light'> => ipcRenderer.invoke('theme:system'),
  onSystemTheme: (cb: (t: 'dark' | 'light') => void): (() => void) => {
    const h = (_e: IpcRendererEvent, t: 'dark' | 'light'): void => cb(t)
    ipcRenderer.on('theme:changed', h)
    return () => ipcRenderer.removeListener('theme:changed', h)
  },
  exportSettings: (): Promise<string | null> => ipcRenderer.invoke('settings:export'),
  importSettings: (): Promise<boolean> => ipcRenderer.invoke('settings:import'),
  setAttr: (p: string, attrs: { readonly?: boolean; mtime?: number }): Promise<void> => ipcRenderer.invoke('fs:setAttr', p, attrs),
  compare: (l: string, r: string, recursive: boolean): Promise<SyncItem[]> => ipcRenderer.invoke('fs:compare', l, r, recursive),
  split: (file: string, dest: string, bytes: number): Promise<string[]> => ipcRenderer.invoke('fs:split', file, dest, bytes),
  join: (parts: string[], target: string): Promise<void> => ipcRenderer.invoke('fs:join', parts, target),

  undo: (): Promise<string[]> => ipcRenderer.invoke('undo:do'),
  undoInfo: (): Promise<UndoInfo> => ipcRenderer.invoke('undo:info'),

  open: (p: string): Promise<string> => ipcRenderer.invoke('shell:open', p),
  reveal: (p: string): Promise<void> => ipcRenderer.invoke('shell:reveal', p),
  run: (cmdline: string, cwd: string): Promise<void> => ipcRenderer.invoke('shell:run', cmdline, cwd),
  terminal: (cwd: string): Promise<void> => ipcRenderer.invoke('shell:terminal', cwd),
  writeClipboardText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:writeText', text),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
  icon: (p: string, isDir: boolean, size: 'small' | 'normal' | 'large' = 'small'): Promise<string> => ipcRenderer.invoke('icon:get', p, isDir, size),
  startDrag: (paths: string[]): void => ipcRenderer.send('drag:start', paths),
  watch: (dirs: string[]): void => ipcRenderer.send('watch:set', dirs),
  nativeEdit: (action: string): void => ipcRenderer.send('edit:native', action),
  onMenuEdit: (cb: (action: string) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, action: string): void => cb(action)
    ipcRenderer.on('menu:edit', h)
    return () => ipcRenderer.removeListener('menu:edit', h)
  },
  onWatchChanged: (cb: (dir: string) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, dir: string): void => cb(dir)
    ipcRenderer.on('watch:changed', h)
    return () => ipcRenderer.removeListener('watch:changed', h)
  },
  pathForFile: (f: File): string => webUtils.getPathForFile(f),

  onJobProgress: (cb: (p: JobProgress) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, p: JobProgress): void => cb(p)
    ipcRenderer.on('job:progress', h)
    return () => ipcRenderer.removeListener('job:progress', h)
  },
  onFindResults: (cb: (r: { jobId: string; entries: FileEntry[] }) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, r: { jobId: string; entries: FileEntry[] }): void => cb(r)
    ipcRenderer.on('find:results', h)
    return () => ipcRenderer.removeListener('find:results', h)
  }
}

export type OpalApi = typeof api

contextBridge.exposeInMainWorld('opal', api)
