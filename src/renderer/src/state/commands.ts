import { argFlag, argString, expandPlaceholders, parseCommands, type ParsedCommand } from '@shared/commands'
import type { ConflictPolicy, GroupBy, Keymap, LayoutPreset, SortColumn, ViewMode } from '@shared/types'
import { activeTab, destPane, findVisible, getState, openDialog, setState, toast, treeMode } from './store'
import * as A from './actions'

/** Bindings shared by both keymaps (standard OS conventions + file manager defaults). */
const COMMON_HOTKEYS: Record<string, string> = {
  'Ctrl+C': 'Clipboard COPY',
  'Ctrl+X': 'Clipboard CUT',
  'Ctrl+V': 'Clipboard PASTE',
  'Ctrl+Shift+C': 'Clipboard COPYNAMES',
  'Ctrl+Shift+N': 'Clipboard COPYNAMES=nopaths',
  Delete: 'Delete',
  'Shift+Delete': 'Delete NORECYCLE',
  F2: 'Rename',
  'Shift+F2': 'Rename ADVANCED',
  F5: 'Go REFRESH',
  'Shift+Enter': 'Go PATHENTRY',
  Backspace: 'Go UP',
  'Alt+ArrowLeft': 'Go BACK',
  'Alt+ArrowRight': 'Go FORWARD',
  'Alt+ArrowDown': 'Go EXPANDBRANCH',
  'Alt+ArrowUp': 'Go EXPANDBRANCH=collapse',
  'Alt+Home': 'Go HOME',
  'Ctrl+T': 'Go NEWTAB',
  'Ctrl+W': 'Go TABCLOSE',
  'Ctrl+F4': 'Go TABCLOSE',
  'Ctrl+Shift+W': 'Go TABUNDOCLOSE',
  'Ctrl+Tab': 'Go TABSELECT=+1',
  'Ctrl+Shift+Tab': 'Go TABSELECT=-1',
  'Ctrl+PageDown': 'Go TABSELECT=+1',
  'Ctrl+PageUp': 'Go TABSELECT=-1',
  'Ctrl+Shift+PageDown': 'Go TABSELECT=+1 OPENINDUAL',
  'Ctrl+Shift+PageUp': 'Go TABSELECT=-1 OPENINDUAL',
  'Ctrl+L': 'Go PATHENTRY',
  'Alt+D': 'Go PATHENTRY',
  Tab: 'Set SOURCE=toggle',
  'Ctrl+A': 'Select ALL',
  'Ctrl+I': 'Select INVERT',
  '+': 'Select PATTERN',
  '-': 'Select DESELECT PATTERN',
  'Ctrl+Z': 'Undo',
  'Alt+Enter': 'Properties',
  'Ctrl+=': 'Set FONTSCALE=+10',
  'Ctrl+-': 'Set FONTSCALE=-10',
  'Ctrl+0': 'Set FONTSCALE=100',
  'Ctrl+,': 'Prefs',
  '>': 'CLI',
  'Ctrl+Alt+T': 'Terminal',
  'Shift+F3': 'Find REPEAT',
  'Ctrl+Alt+1': 'Properties SETLABEL=red',
  'Ctrl+Alt+2': 'Properties SETLABEL=orange',
  'Ctrl+Alt+3': 'Properties SETLABEL=yellow',
  'Ctrl+Alt+4': 'Properties SETLABEL=green',
  'Ctrl+Alt+5': 'Properties SETLABEL=blue',
  'Ctrl+Alt+6': 'Properties SETLABEL=purple',
  'Ctrl+Alt+7': 'Properties SETLABEL=gray',
  'Ctrl+Alt+0': 'Properties SETLABEL=none',
  'Ctrl+Shift+5': 'Set VIEW=columns',
  'Ctrl+Shift+Space': 'Find SEMANTIC',
  F1: 'Help'
}

/** Standard key bindings (Ctrl+1/2/3 copy/move/rename, F6 dual, F7 viewer, F8 tree…). */
export const STANDARD_HOTKEYS: Record<string, string> = {
  ...COMMON_HOTKEYS,
  'Ctrl+1': 'Copy TO={destpath}',
  'Ctrl+Shift+1': 'Copy AS TO={destpath}',
  'Ctrl+2': 'Copy MOVE TO={destpath}',
  'Ctrl+Shift+2': 'Copy MOVE AS TO={destpath}',
  'Ctrl+3': 'Rename ADVANCED',
  'Ctrl+N': 'CreateFolder',
  'Ctrl+O': 'CreateFile',
  'Ctrl+E': 'Go NEWWINDOW',
  'Ctrl+Backspace': 'Go ROOT',
  'Ctrl+D': 'Favorites ADD',
  'Ctrl+K': 'GetSizes',
  'Ctrl+S': 'Select PATTERN',
  'Ctrl+F': 'Find',
  'Ctrl+Y': 'Synchronize',
  'Ctrl+U': 'Duplicates',
  'Ctrl+B': 'Properties',
  'Ctrl+Shift+D': 'Set VIEW=details',
  'Ctrl+Shift+M': 'Set VIEW=thumbnails',
  'Ctrl+Shift+I': 'Set VIEW=icons',
  F3: 'Set FILTER',
  F6: 'Set DUAL=toggle',
  'Shift+F6': 'Set DUALVERT=toggle',
  F7: 'Set VIEWER=toggle',
  F8: 'Set TREE=toggle',
  'Ctrl+Shift+F': 'Set FLATVIEW=toggle',
  'Ctrl+Shift+L': 'Set NAVLOCK=toggle',
  'Ctrl+H': 'Set HIDDEN=toggle',
  'Ctrl+Shift+K': 'CLI'
}

/** Commander-style function keys (Norton/Total Commander muscle memory). */
export const COMMANDER_HOTKEYS: Record<string, string> = {
  ...COMMON_HOTKEYS,
  F3: 'Set VIEWER=toggle',
  F4: 'Find',
  'Ctrl+F': 'Find',
  F6: 'Copy TO={destpath}',
  'Shift+F6': 'Copy MOVE TO={destpath}',
  F7: 'CreateFolder',
  'Shift+F7': 'CreateFile',
  F8: 'Delete',
  F9: 'Set TREE=toggle',
  F10: 'Set DUAL=toggle',
  'Shift+F10': 'Set DUALVERT=toggle',
  'Ctrl+R': 'Rename ADVANCED',
  'Ctrl+N': 'Go NEWWINDOW',
  'Ctrl+Backspace': 'Delete',
  'Ctrl+.': 'Go MIRROR',
  'Ctrl+Shift+S': 'Go SWAP',
  'Ctrl+D': 'Select NONE',
  'Ctrl+E': 'Set FILTER',
  'Ctrl+1': 'Set VIEW=details',
  'Ctrl+2': 'Set VIEW=list',
  'Ctrl+3': 'Set VIEW=icons',
  'Ctrl+4': 'Set VIEW=thumbnails',
  'Ctrl+5': 'Set VIEW=columns',
  'Ctrl+H': 'Set HIDDEN=toggle',
  'Ctrl+B': 'Favorites ADD',
  'Ctrl+K': 'CLI',
  'Ctrl+Shift+Y': 'Synchronize',
  'Alt+S': 'GetSizes',
  'Ctrl+Shift+F': 'Set FLATVIEW=toggle',
  'Ctrl+Shift+D': 'Duplicates',
  'Ctrl+Shift+L': 'Set NAVLOCK=toggle'
}

/**
 * macOS conventions layered on top of either keymap (Ctrl = ⌘). Cmd+H (hide app) and Cmd+Shift+3/4/5
 * (screenshots) belong to the system, so bindings that would collide with them are moved.
 */
export const MAC_OVERRIDES: Record<string, string | null> = {
  'Ctrl+Backspace': 'Delete',
  'Ctrl+ArrowUp': 'Go UP',
  'Ctrl+ArrowDown': 'Go OPENFOCUSED',
  'Ctrl+[': 'Go BACK',
  'Ctrl+]': 'Go FORWARD',
  'Ctrl+Shift+.': 'Set HIDDEN=toggle',
  'Ctrl+Shift+>': 'Set HIDDEN=toggle',
  'Ctrl+Shift+G': 'Go PATHENTRY',
  'Ctrl+Shift+N': 'CreateFolder',
  'Ctrl+Alt+3': 'Set VIEW=columns',
  'Ctrl+H': null,
  'Ctrl+Shift+5': null
}

export function defaultHotkeys(keymap: Keymap, platform: string = getState().info.platform): Record<string, string> {
  const base = { ...(keymap === 'commander' ? COMMANDER_HOTKEYS : STANDARD_HOTKEYS) }
  if (platform !== 'darwin') return base
  for (const [k, v] of Object.entries(MAC_OVERRIDES)) {
    if (v === null) delete base[k]
    else base[k] = v
  }
  return base
}

/** Default bindings with the user's changes applied ('' removes a default binding). */
export function effectiveHotkeys(keymap: Keymap, platform: string, overrides: Record<string, string> = {}): Record<string, string> {
  const map = defaultHotkeys(keymap, platform)
  for (const [k, v] of Object.entries(overrides)) {
    if (v) map[k] = v
    else delete map[k]
  }
  return map
}

/**
 * What is saved: only the differences from the platform defaults. Exported files therefore carry the user's
 * own changes, and the defaults of the computer they are imported on (Windows, macOS, Linux) still apply.
 */
export function hotkeyOverrides(map: Record<string, string>, keymap: Keymap, platform: string): Record<string, string> {
  const defs = defaultHotkeys(keymap, platform)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) if (defs[k] !== v) out[k] = v
  for (const k of Object.keys(defs)) if (!(k in map)) out[k] = ''
  return out
}

/** Display label of the first hotkey bound to `command` in the active map ('' if none). */
export function keyFor(command: string): string {
  const norm = (c: string): string => c.replace(/\s+/g, ' ').trim().toLowerCase()
  const want = norm(command)
  const hit = Object.entries(getState().hotkeys).find(([, c]) => norm(c) === want)
  if (!hit) return ''
  return getState().info.platform === 'darwin' ? hit[0].replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧') : hit[0]
}

/** @deprecated kept for callers that predate keymaps */
export const DEFAULT_HOTKEYS = STANDARD_HOTKEYS

export const COMMAND_DOCS: { name: string; usage: string; description: string }[] = [
  { name: 'Go', usage: 'Go <path> | UP | BACK | FORWARD | HOME | ROOT | REFRESH | PATHENTRY | NEWTAB [PATH=] | TABCLOSE | TABSELECT=+1|-1|first|last|<n> [OPENINDUAL] | TABUNDOCLOSE | TABDUPLICATE | EXPANDBRANCH[=toggle|toggleall|collapse] | SWAP | MIRROR | NEWWINDOW | OPENINDEST | FROMSEL', description: 'Navigate the source (or destination) file display, manage tabs and expand folders in place.' },
  { name: 'Copy', usage: 'Copy [MOVE] [AS] [HERE] [DUPLICATE] [TO=<path>] [CREATEFOLDER=<name>] [UPDATEALL|UPDATEEXISTING] [WHENEXISTS=ask|skip|replace|rename|keepnewer]', description: 'Copy or move the selected items (default destination: {destpath}).' },
  { name: 'Delete', usage: 'Delete [NORECYCLE|SHIFT] [QUIET]', description: 'Delete the selected items (to trash by default).' },
  { name: 'Rename', usage: 'Rename [ADVANCED] [TO=<name>]', description: 'Inline rename, or the Advanced Rename dialog.' },
  { name: 'CreateFolder', usage: 'CreateFolder [NAME=<name>]', description: 'Create a new folder in the source ({date|yyyy-MM-dd} macros allowed).' },
  { name: 'CreateFile', usage: 'CreateFile [NAME=<name>]', description: 'Create a new empty file in the source.' },
  { name: 'Clipboard', usage: 'Clipboard COPY | CUT | PASTE | COPYNAMES[=nopaths]', description: 'File clipboard operations; COPYNAMES copies full paths (or names only).' },
  { name: 'Select', usage: 'Select ALL | NONE | INVERT | SIMILAR | RESELECT | SOURCETODEST[=notin|noext] | DESTTOSOURCE[=notin|noext] [DESELECTNOMATCH] | PATTERN[=<wildcard>] [DESELECT] [FILES|DIRS] [EXCLUSIVE]', description: 'Selection by wildcard, by extension, against the other display, or the previous selection.' },
  { name: 'Set', usage: 'Set VIEW=… | DUAL | DUALVERT | TREE | VIEWER | HIDDEN | FLATVIEW | EXPANDABLEFOLDERS | NAVLOCK | STATUSBAR =on|off|toggle | THEME=dark|light|toggle | SOURCE=toggle | FILTER[=<pattern>] | QUICKFILTER=!prev | FONTSCALE=+10|-10|<percent> | AUTOSIZECOLUMNS | KEYMAP=standard|commander | SORTBY=… [REVERSE]', description: 'Change display and window settings.' },
  { name: 'Find', usage: 'Find [PATTERN=<wildcard>] [REPEAT]', description: 'Search for files and folders.' },
  { name: 'GetSizes', usage: 'GetSizes [ALL]', description: 'Calculate folder sizes.' },
  { name: 'Properties', usage: 'Properties', description: 'Show properties, attributes, times and checksums.' },
  { name: 'Favorites', usage: 'Favorites ADD | REMOVE', description: 'Manage favorite folders.' },
  { name: 'Synchronize', usage: 'Synchronize', description: 'Compare and synchronize source and destination.' },
  { name: 'Duplicates', usage: 'Duplicates', description: 'Find duplicate files (by size and SHA-256) below the source folder.' },
  { name: 'Split', usage: 'Split SIZE=<bytes|KB|MB>', description: 'Split the selected file into parts in the destination.' },
  { name: 'Join', usage: 'Join [TO=<name>]', description: 'Join the selected parts into a single file in the destination.' },
  { name: 'Undo', usage: 'Undo', description: 'Undo the last rename/move/copy/create.' },
  { name: 'Prefs', usage: 'Prefs', description: 'Open Preferences.' },
  { name: 'CLI', usage: 'CLI', description: 'Open the command line.' },
  { name: 'Terminal', usage: 'Terminal', description: 'Open a system terminal in the source folder.' },
  { name: 'Close', usage: 'Close', description: 'Close this window.' },
  { name: 'Help', usage: 'Help', description: 'Show commands and hotkeys.' },
  { name: '<other>', usage: 'any external command, e.g. notepad {filepath}', description: 'Runs an external program in the source folder with placeholders expanded.' }
]

const WHENEXISTS: Record<string, ConflictPolicy> = {
  skip: 'skip',
  replace: 'overwrite',
  overwrite: 'overwrite',
  rename: 'rename',
  keepnewer: 'newer',
  newer: 'newer'
}

function toggleValue(current: boolean, v: string | undefined): boolean {
  if (v === undefined || /^toggle$/i.test(v)) return !current
  return /^(on|yes|true|1)$/i.test(v)
}

function parseSize(s: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|k|mb|m|gb|g)?$/i.exec(s.trim())
  if (!m) return NaN
  const n = parseFloat(m[1])
  const u = (m[2] ?? 'b').toLowerCase()
  const mult = u.startsWith('k') ? 1024 : u.startsWith('m') ? 1024 ** 2 : u.startsWith('g') ? 1024 ** 3 : 1
  return Math.floor(n * mult)
}

type Handler = (cmd: ParsedCommand) => Promise<void> | void

let lastFind: { root: string; pattern: string } | null = null

const handlers: Record<string, Handler> = {
  async go(cmd) {
    const s = getState()
    const pane = s.activePane
    const a = cmd.args
    const tabTarget: 0 | 1 = argFlag(a, 'OPENINDUAL') && s.prefs.dualDisplay ? destPane(s) : pane
    if (a.EXPANDBRANCH !== undefined) {
      const m = (argString(a, 'EXPANDBRANCH') ?? 'expand').toLowerCase()
      return A.expandBranch(pane, m === 'collapse' || m === 'toggle' || m === 'toggleall' ? m : 'expand')
    }
    if (a.OPENFOCUSED) {
      const t = activeTab(pane, s)
      const e = findVisible(t, s.prefs, t.focusPath)
      if (e) await A.openEntry(pane, e)
      return
    }
    if (a.UP) return A.goUp(pane)
    if (a.BACK) return A.goHistory(pane, -1)
    if (a.FORWARD) return A.goHistory(pane, 1)
    if (a.REFRESH) return void A.refreshAll()
    if (a.HOME) return void A.navigate(pane, s.info.home)
    if (a.PATHENTRY || a.EDITPATH) return setState({ editingPath: pane })
    if (a.TABUNDOCLOSE) return A.undoCloseTab(pane)
    if (a.TABDUPLICATE) return A.duplicateTab(pane)
    if (a.TABCLOSE || a.CLOSETAB) return A.closeTab(pane)
    if (a.TABSELECT !== undefined || a.NEXTTAB || a.PREVTAB) {
      const ps = s.panes[tabTarget]
      const v = (argString(a, 'TABSELECT') ?? (a.PREVTAB ? '-1' : '+1')).toLowerCase()
      const idx = v === 'first' ? 0 : v === 'last' ? ps.tabs.length - 1 : /^[+-]\d+$/.test(v) ? ps.activeTab + Number(v) : Number(v)
      if (Number.isFinite(idx)) A.switchTab(tabTarget, idx)
      return
    }
    if (a.NEWTAB && a.FROMSEL) {
      for (const e of A.selectedEntries(pane).filter((x) => x.isDir)) A.newTab(pane, e.path)
      return
    }
    if (a.NEWTAB) return A.newTab(pane, argString(a, 'PATH'))
    if (a.SWAP) return A.swapPanes()
    if (a.MIRROR) return A.mirrorToDest()
    if (a.NEWWINDOW || a.NEW) return A.openNewWindow()
    if (a.ROOT) {
      const p = activeTab(pane).path
      const unc = /^\\\\[^\\]+\\[^\\]+/.exec(p)
      const root = unc ? unc[0] : /^[a-zA-Z]:/.test(p) ? p.slice(0, 2) + '\\' : '/'
      return void A.navigate(pane, root)
    }
    const target = argString(a, 'PATH') ?? cmd.positional.find((p) => !/^(OPENINDEST|NEWTAB|OPENINDUAL)$/i.test(p))
    if (target) {
      const path = expandPlaceholders(target, ctx())
      const inDest = argFlag(a, 'OPENINDEST')
      await A.navigate(inDest ? destPane(s) : pane, path)
    }
  },
  async copy(cmd) {
    const a = cmd.args
    const op = argFlag(a, 'MOVE') ? 'move' : 'copy'
    const items = A.selectedEntries(getState().activePane)
    if (!items.length) return
    const to = argString(a, 'TO')
    let dest = argFlag(a, 'HERE') || argFlag(a, 'DUPLICATE') ? A.sourceDir() : to ? expandPlaceholders(to, ctx()) : undefined
    const folder = argString(a, 'CREATEFOLDER')
    const extra: A.TransferExtra = {}
    if (folder) {
      dest = `${dest ?? A.destDir()}${getState().info.sep}${expandPlaceholders(folder, ctx())}`
      extra.ensureDestDir = true
    }
    let when = WHENEXISTS[(argString(a, 'WHENEXISTS') ?? '').toLowerCase()]
    if (a.UPDATEALL !== undefined || a.UPDATEEXISTING !== undefined) {
      when = 'newer'
      extra.onlyExisting = a.UPDATEEXISTING !== undefined
    }
    if (a.AS) return A.copyAs(op, dest)
    const paths = items.map((e) => e.path)
    if (when || folder || extra.onlyExisting || dest === A.sourceDir()) return A.transferItems(op, paths, dest ?? A.destDir(), when, extra)
    await A.copySelectedToDest(op, dest)
  },
  async delete(cmd) {
    await A.deleteSelected(argFlag(cmd.args, 'NORECYCLE') || argFlag(cmd.args, 'SHIFT'), argFlag(cmd.args, 'QUIET'))
  },
  async rename(cmd) {
    const to = argString(cmd.args, 'TO')
    if (to) {
      const e = A.selectedEntries(getState().activePane)[0]
      if (e) await A.commitInlineRename(getState().activePane, e.path, expandPlaceholders(to, ctx()))
      return
    }
    const multi = A.selectedEntries(getState().activePane).length > 1
    if (cmd.args.ADVANCED || multi) await A.advancedRename()
    else A.startInlineRename()
  },
  async createfolder(cmd) {
    await A.createFolder(argString(cmd.args, 'NAME'))
  },
  async createfile(cmd) {
    await A.createFile(argString(cmd.args, 'NAME'))
  },
  async clipboard(cmd) {
    const a = cmd.args
    if (a.COPY) A.clipboardSet(false)
    else if (a.CUT) A.clipboardSet(true)
    else if (a.PASTE) await A.clipboardPaste()
    else if (a.COPYNAMES !== undefined) A.copyNames(!/nopaths/i.test(argString(a, 'COPYNAMES') ?? ''))
    else if (a.COPYFILENAMES) A.copyNames(false)
  },
  async select(cmd) {
    const pane = getState().activePane
    const a = cmd.args
    if (a.ALL) return A.selectAll(pane)
    if (a.NONE) return A.selectNone(pane)
    if (a.INVERT) return A.invertSelection(pane)
    if (a.SIMILAR) return void toast(`${A.selectSimilar(pane)} item(s) selected`)
    if (a.RESELECT) return void A.reselect(pane)
    if (a.SOURCETODEST !== undefined || a.DESTTOSOURCE !== undefined) {
      const v = (argString(a, 'SOURCETODEST') ?? argString(a, 'DESTTOSOURCE') ?? '').toLowerCase()
      const target: 0 | 1 = a.SOURCETODEST !== undefined ? destPane() : pane
      const n = A.selectByOtherPane(target, v.includes('notin') ? 'notin' : 'in', { noExt: v.includes('noext'), deselectNoMatch: argFlag(a, 'DESELECTNOMATCH') })
      return void toast(`${n} item(s) selected`)
    }
    if (a.PATTERN !== undefined) {
      let pattern = argString(a, 'PATTERN')
      const deselect = argFlag(a, 'DESELECT')
      if (!pattern) {
        pattern = (await openDialog<string>('prompt', { title: deselect ? 'Deselect' : 'Select', label: 'Wildcard pattern (e.g. *.jpg, (a|b)*, ~(*.tmp))', value: '*' })) ?? undefined
        if (!pattern) return
      }
      const n = A.selectPattern(pane, pattern, { deselect, filesOnly: argFlag(a, 'FILES'), dirsOnly: argFlag(a, 'DIRS'), exclusive: argFlag(a, 'EXCLUSIVE') })
      toast(`${n} item(s) ${deselect ? 'deselected' : 'selected'}`)
    }
  },
  async set(cmd) {
    const s = getState()
    const a = cmd.args
    const pane = s.activePane
    const view = argString(a, 'VIEW')
    if (view) {
      const v = view.toLowerCase() as ViewMode
      if (['details', 'list', 'icons', 'thumbnails', 'columns'].includes(v)) A.setFormat(pane, { viewMode: v })
    }
    const group = argString(a, 'GROUPBY')?.toLowerCase()
    if (group) A.setFormat(pane, { groupBy: (['none', 'type', 'ext', 'mtime', 'size', 'name', 'label', 'kind'].includes(group) ? group : 'none') as GroupBy })
    const layout = argString(a, 'LAYOUT')
    if (layout) A.applyLayout(layout as LayoutPreset)
    if (a.HELPERS !== undefined) A.setPrefs({ helpers: toggleValue(s.prefs.helpers, argString(a, 'HELPERS')) })
    if (a.DUAL !== undefined) A.setPrefs({ dualDisplay: toggleValue(s.prefs.dualDisplay, argString(a, 'DUAL')) })
    if (a.DUALVERT !== undefined) A.setPrefs({ dualVertical: toggleValue(s.prefs.dualVertical, argString(a, 'DUALVERT')) })
    if (a.TREE !== undefined) A.setPrefs({ showTree: toggleValue(s.prefs.showTree, argString(a, 'TREE')) })
    if (a.VIEWER !== undefined) A.setPrefs({ showViewer: toggleValue(s.prefs.showViewer, argString(a, 'VIEWER')) })
    if (a.HIDDEN !== undefined) A.setPrefs({ showHidden: toggleValue(s.prefs.showHidden, argString(a, 'HIDDEN')) })
    if (a.FLATVIEW !== undefined) await A.toggleFlatView(pane, toggleValue(activeTab(pane).flat, argString(a, 'FLATVIEW')))
    if (a.THEME !== undefined) {
      const t = argString(a, 'THEME')
      A.setPrefs({ theme: t === 'light' || t === 'dark' || t === 'system' ? t : A.resolvedTheme() === 'dark' ? 'light' : 'dark' })
    }
    if (a.SOURCE !== undefined && s.prefs.dualDisplay) A.setActivePane(destPane(s))
    if (a.FILTER !== undefined) {
      const f = argString(a, 'FILTER')
      if (f !== undefined) A.setTabProps(pane, { filter: f })
      else document.querySelector<HTMLInputElement>(`[data-pane="${pane}"] .filter-input`)?.focus()
    }
    if (a.NAVLOCK !== undefined) A.setNavLock(toggleValue(s.navLock, argString(a, 'NAVLOCK')))
    if (a.STATUSBAR !== undefined) A.setPrefs({ showStatusBar: toggleValue(s.prefs.showStatusBar, argString(a, 'STATUSBAR')) })
    if (a.EXPANDABLEFOLDERS !== undefined) A.setPrefs({ expandableFolders: toggleValue(s.prefs.expandableFolders, argString(a, 'EXPANDABLEFOLDERS')) })
    if (a.QUICKFILTER !== undefined) {
      const f = argString(a, 'QUICKFILTER')
      const tab = activeTab(pane)
      if (f === '!prev') A.setTabProps(pane, { filter: tab.prevFilter, prevFilter: tab.filter })
      else if (f !== undefined) A.setTabProps(pane, { filter: f, prevFilter: tab.filter || tab.prevFilter })
      else document.querySelector<HTMLInputElement>(`[data-pane="${pane}"] .filter-input`)?.focus()
    }
    const fs = argString(a, 'FONTSCALE')
    if (fs) {
      const cur = s.prefs.fontScale
      const n = /^[+-]/.test(fs) ? cur + Number(fs) : /^reset$/i.test(fs) ? 100 : Number(fs)
      if (Number.isFinite(n)) A.setPrefs({ fontScale: Math.max(60, Math.min(250, Math.round(n))) })
    }
    if (a.AUTOSIZECOLUMNS) window.dispatchEvent(new CustomEvent('opal-autosize', { detail: pane }))
    const km = argString(a, 'KEYMAP')?.toLowerCase()
    if (km === 'standard' || km === 'commander') A.setPrefs({ keymap: km })
    const sortBy = argString(a, 'SORTBY')
    if (sortBy) A.setFormat(pane, { sort: { column: sortBy.toLowerCase() as SortColumn, descending: argFlag(a, 'REVERSE') } })
  },
  async find(cmd) {
    if (cmd.args.REPEAT && lastFind) return void (await openDialog('find', { ...lastFind, autostart: true }))
    lastFind = { root: A.sourceDir(), pattern: argString(cmd.args, 'PATTERN') ?? '' }
    await openDialog('find', { ...lastFind, semantic: argFlag(cmd.args, 'SEMANTIC') })
  },
  async getsizes(cmd) {
    await A.computeSizes(argFlag(cmd.args, 'ALL'))
  },
  async properties(cmd) {
    const label = argString(cmd.args, 'SETLABEL')
    if (label) {
      const paths = A.selectedEntries(getState().activePane).map((e) => e.path)
      if (label === 'none') A.clearLabels(paths)
      else A.toggleLabel(paths, label)
      return
    }
    await A.showProperties()
  },
  quicklook() {
    A.toggleQuickLook()
  },
  async setup() {
    await A.runSetup()
  },
  favorites(cmd) {
    const p = A.sourceDir()
    const has = A.isFavorite(p)
    if ((cmd.args.ADD && !has) || (cmd.args.REMOVE && has) || (!cmd.args.ADD && !cmd.args.REMOVE)) A.toggleFavorite(p)
  },
  async synchronize() {
    await A.syncFolders()
  },
  async duplicates() {
    await openDialog('duplicates', { root: A.sourceDir() })
    await A.refreshAll()
  },
  async split(cmd) {
    const pane = getState().activePane
    const file = A.selectedEntries(pane).find((e) => !e.isDir)
    if (!file) return
    let sizeText = argString(cmd.args, 'SIZE')
    if (!sizeText) sizeText = (await openDialog<string>('prompt', { title: 'Split File', label: 'Part size (e.g. 100MB, 700KB)', value: '100MB' })) ?? undefined
    if (!sizeText) return
    const bytes = parseSize(sizeText)
    if (!Number.isFinite(bytes) || bytes <= 0) return toast('Invalid size', 'error')
    try {
      const parts = await window.opal.split(file.path, getState().prefs.dualDisplay ? A.destDir() : A.sourceDir(), bytes)
      toast(`Created ${parts.length} part(s)`)
    } catch (e) {
      toast(A.cleanError(e), 'error')
    }
    await A.refreshAll()
  },
  async join(cmd) {
    const pane = getState().activePane
    const parts = A.selectedEntries(pane).filter((e) => !e.isDir).map((e) => e.path).sort()
    if (parts.length < 2) return toast('Select at least two parts to join', 'error')
    const base = parts[0].split(/[\\/]/).pop()!.replace(/\.\d{3}$/, '')
    const name = argString(cmd.args, 'TO') ?? (await openDialog<string>('prompt', { title: 'Join Files', label: 'Output file name', value: base, validateName: true }))
    if (!name) return
    const destDir = getState().prefs.dualDisplay ? A.destDir() : A.sourceDir()
    try {
      await window.opal.join(parts, `${destDir}${destDir.endsWith(getState().info.sep) ? '' : getState().info.sep}${name}`)
      toast('Files joined')
    } catch (e) {
      toast(A.cleanError(e), 'error')
    }
    await A.refreshAll()
  },
  async undo() {
    await A.undoLast()
  },
  async prefs() {
    await openDialog('prefs')
  },
  cli() {
    setState({ cliOpen: true })
  },
  async terminal() {
    await window.opal.terminal(A.sourceDir())
  },
  close() {
    window.close()
  },
  async help() {
    await openDialog('help')
  }
}

function ctx(): { sourcepath: string; destpath: string; selected: string[]; focused?: string } {
  const s = getState()
  const tab = activeTab(s.activePane, s)
  return {
    sourcepath: tab.path,
    destpath: activeTab(destPane(s), s).path,
    selected: A.selectedEntries(s.activePane).map((e) => e.path),
    focused: tab.focusPath ?? undefined
  }
}

export async function runCommand(script: string): Promise<void> {
  let cmds: ParsedCommand[]
  try {
    cmds = parseCommands(script)
  } catch (e) {
    toast(`Command error: ${(e as Error).message}`, 'error')
    return
  }
  for (const cmd of cmds) {
    const h = handlers[cmd.name]
    try {
      if (h) await h(cmd)
      else await window.opal.run(expandPlaceholders(cmd.raw, ctx()), A.sourceDir())
    } catch (e) {
      toast(`${cmd.name}: ${A.cleanError(e)}`, 'error')
    }
  }
}

export function isInternalCommand(name: string): boolean {
  return name.toLowerCase() in handlers
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  let key = e.key
  // With Alt/Option (macOS) or Ctrl+Alt (AltGr layouts) e.key is a composed character such as "∂" or "@":
  // use the physical key so shortcuts like Ctrl+Alt+1 or Alt+D work on every keyboard layout.
  // Only when the produced character is not plain ASCII, so QWERTZ/AZERTY layouts keep their labelled letters.
  if ((e.altKey || e.ctrlKey || e.metaKey) && key.length === 1 && !/[ -~]/.test(key) && /^(Key[A-Z]|Digit[0-9])$/.test(e.code)) key = e.code.slice(e.code.startsWith('Key') ? 3 : 5)
  // The digit row with a modifier is a shortcut (Ctrl+Shift+1), not the symbol Shift produces ("!", or "=" for
  // Shift+0 on an Italian keyboard; AZERTY even needs Shift for the digits): use the physical digit key.
  else if ((e.altKey || e.ctrlKey || e.metaKey) && /^Digit[0-9]$/.test(e.code)) key = e.code.slice(5)
  if (key === ' ') key = 'Space'
  if (key.length === 1) key = key.toUpperCase()
  const printable = e.key.length === 1
  // Shift is implicit in printable symbols (e.g. "+"), but explicit for letters with Ctrl/Alt.
  if (e.shiftKey && (!printable || e.ctrlKey || e.metaKey || e.altKey)) parts.push('Shift')
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return parts.join('+')
  parts.push(key)
  return parts.join('+')
}

/** Key combination for a favorite shortcut: like hotkeys, but Shift+letter stays distinct from the letter. */
export function favoriteCombo(e: KeyboardEvent): string {
  const base = comboFromEvent(e)
  if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && /^[a-z]$/i.test(e.key)) return `Shift+${base}`
  return base
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

function pageSize(): number {
  const pane = getState().activePane
  const list = document.querySelector<HTMLElement>(`[data-pane="${pane}"] .file-scroll`)
  return list ? Math.max(1, Math.floor(list.clientHeight / 22) - 1) : 20
}

export function handleListKey(e: KeyboardEvent): boolean {
  const s = getState()
  const pane = s.activePane
  const tab = activeTab(pane, s)
  const mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }
  const isGrid = tab.viewMode === 'icons' || tab.viewMode === 'thumbnails'
  const cols = isGrid ? gridColumns(pane) : 1
  switch (e.key) {
    case 'ArrowDown':
      if (e.altKey) return false
      A.moveFocus(pane, cols, mods)
      return true
    case 'ArrowUp':
      if (e.altKey) return false
      A.moveFocus(pane, -cols, mods)
      return true
    case 'ArrowRight':
      if (e.altKey) return false
      if (tab.viewMode === 'columns') void A.columnRight(pane)
      else if (isGrid) A.moveFocus(pane, 1, mods)
      else if (treeMode(tab, s.prefs) && !mods.shift && !mods.ctrl) void A.arrowRight(pane)
      else return false
      return true
    case 'ArrowLeft':
      if (e.altKey) return false
      if (tab.viewMode === 'columns') A.columnLeft(pane)
      else if (isGrid) A.moveFocus(pane, -1, mods)
      else if (treeMode(tab, s.prefs) && !mods.shift && !mods.ctrl) A.arrowLeft(pane)
      else return false
      return true
    case 'PageDown':
      A.moveFocus(pane, pageSize() * cols, mods)
      return true
    case 'PageUp':
      A.moveFocus(pane, -pageSize() * cols, mods)
      return true
    case 'Home':
      if (e.altKey) return false
      A.moveFocus(pane, 'home', mods)
      return true
    case 'End':
      A.moveFocus(pane, 'end', mods)
      return true
    case ' ':
      if (mods.ctrl || s.fayt) return false
      // Finder-style Quick Look on Space (configurable); Shift+Space / Insert toggle selection.
      if (s.prefs.spaceAction === 'quicklook' && !e.shiftKey) A.toggleQuickLook()
      else A.toggleFocusedSelection(pane)
      return true
    case 'Insert':
      A.toggleFocusedSelection(pane)
      return true
    case 'Enter': {
      if (e.altKey) return false
      const entry = findVisible(tab, s.prefs, tab.focusPath)
      if (entry) void A.openEntry(pane, entry, e.shiftKey)
      return true
    }
    case 'Escape':
      if (s.quickLook) A.toggleQuickLook(false)
      else if (s.fayt) void A.closeFayt(false)
      else if (tab.filter) A.setTabProps(pane, { filter: '' })
      else A.selectNone(pane)
      return true
  }
  return false
}

function gridColumns(pane: 0 | 1): number {
  const grid = document.querySelector<HTMLElement>(`[data-pane="${pane}"] .grid-view`)
  if (!grid) return 1
  return Math.max(1, Number(grid.dataset.columns ?? 1))
}

function onKeyDown(e: KeyboardEvent): void {
  const s = getState()
  if (!s.ready) return
  if (s.dialog || s.contextMenu) {
    if (e.key === 'Escape' && s.contextMenu) setState({ contextMenu: null })
    return
  }
  if (isTypingTarget(e.target)) return
  if ((e.target as HTMLElement | null)?.closest?.('.folder-tree')) return

  const combo = comboFromEvent(e)
  const bound = s.hotkeys[combo]
  // Printable keys without modifiers go to find-as-you-type unless they are bound (+ / -).
  const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
  if (printable && e.key === '>') {
    e.preventDefault()
    setState({ cliOpen: true })
    return
  }
  // Favorite shortcut keys (e.g. "P" → Projects) come before the other bindings.
  if (!s.fayt && A.runFavoriteKey(favoriteCombo(e))) {
    e.preventDefault()
    return
  }
  if (printable && !bound) {
    if (e.key === ' ' && !s.fayt) {
      if (handleListKey(e)) e.preventDefault()
      return
    }
    // Any other character starts (or continues) find-as-you-type.
    e.preventDefault()
    if (s.fayt) A.setFaytText(s.fayt.text + e.key)
    else A.openFayt(s.activePane, e.key)
    return
  }
  if (bound) {
    if (combo === 'Tab' && !s.prefs.dualDisplay) return
    e.preventDefault()
    void runCommand(bound)
    return
  }
  if (handleListKey(e)) e.preventDefault()
}

let installed = false
const MENU_EDIT_COMMANDS: Record<string, string> = {
  copy: 'Clipboard COPY',
  cut: 'Clipboard CUT',
  paste: 'Clipboard PASTE',
  selectAll: 'Select ALL',
  undo: 'Undo'
}

export function installKeyboard(): void {
  if (installed) return
  installed = true
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('mousedown', () => {
    if (getState().contextMenu) setState({ contextMenu: null })
  })
  // Side buttons of the mouse: back / forward, as in every file manager.
  window.addEventListener('mouseup', (e) => {
    if ((e.button !== 3 && e.button !== 4) || getState().dialog) return
    e.preventDefault()
    void runCommand(e.button === 3 ? 'Go BACK' : 'Go FORWARD')
  })
  // macOS application menu (Cmd+C/X/V/A/Z) arrives here instead of as key events.
  window.opal.onMenuEdit((action) => {
    if (isTypingTarget(document.activeElement) || getState().dialog) window.opal.nativeEdit(action)
    else if (MENU_EDIT_COMMANDS[action]) void runCommand(MENU_EDIT_COMMANDS[action])
  })
}
