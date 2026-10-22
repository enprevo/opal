import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  RefreshCw,
  Copy,
  Scissors,
  ClipboardPaste,
  Trash2,
  PencilLine,
  FolderPlus,
  FilePlus,
  List,
  LayoutList,
  LayoutGrid,
  Image,
  Columns2,
  Rows2,
  FolderTree,
  PanelRight,
  Eye,
  EyeOff,
  Search,
  ArrowLeftRight,
  Calculator,
  Undo2,
  Settings,
  HelpCircle,
  Terminal,
  Star,
  SquareTerminal,
  Moon,
  Sun,
  MoveRight,
  CopyPlus,
  Layers,
  Files,
  AppWindow,
  ListTree,
  Link2,
  Columns3,
  Sparkles,
  ScanEye,
  Wand2,
  SunMoon
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useStore, activeTab, type AppState } from '../state/store'
import { keyFor, runCommand } from '../state/commands'
import { resolvedTheme } from '../state/actions'

export interface ToolbarButtonDef {
  id: string
  group: string
  icon: (s: AppState) => LucideIcon
  label: string
  /** One-line description shown by the side helper. */
  desc: string
  command: string
  active?: (s: AppState) => boolean
  disabled?: (s: AppState) => boolean
}

const tab = (s: AppState) => activeTab(s.activePane, s)
const fixed = (i: LucideIcon) => () => i

/** Every button available for the toolbar (Preferences → Toolbar chooses which are shown). */
export const TOOLBAR_BUTTONS: ToolbarButtonDef[] = [
  { id: 'back', group: 'nav', icon: fixed(ArrowLeft), label: 'Back', desc: 'Go back to the previous folder', command: 'Go BACK', disabled: (s) => tab(s).historyIndex <= 0 },
  { id: 'forward', group: 'nav', icon: fixed(ArrowRight), label: 'Forward', desc: 'Go forward again in the folder history', command: 'Go FORWARD', disabled: (s) => tab(s).historyIndex >= tab(s).history.length - 1 },
  { id: 'up', group: 'nav', icon: fixed(ArrowUp), label: 'Up', desc: 'Go to the parent folder', command: 'Go UP' },
  { id: 'refresh', group: 'nav', icon: fixed(RefreshCw), label: 'Refresh', desc: 'Read the folders again from disk', command: 'Go REFRESH' },
  { id: 'copyto', group: 'ops', icon: fixed(CopyPlus), label: 'Copy to', desc: 'Copy the selection into the folder of the other pane', command: 'Copy TO={destpath}' },
  { id: 'moveto', group: 'ops', icon: fixed(MoveRight), label: 'Move to', desc: 'Move the selection into the folder of the other pane', command: 'Copy MOVE TO={destpath}' },
  { id: 'copy', group: 'ops', icon: fixed(Copy), label: 'Copy', desc: 'Copy the selection to the clipboard', command: 'Clipboard COPY' },
  { id: 'cut', group: 'ops', icon: fixed(Scissors), label: 'Cut', desc: 'Cut the selection, to move it when you paste', command: 'Clipboard CUT' },
  { id: 'paste', group: 'ops', icon: fixed(ClipboardPaste), label: 'Paste', desc: 'Paste the clipboard items into the current folder', command: 'Clipboard PASTE', disabled: (s) => !s.clipboard },
  { id: 'delete', group: 'ops', icon: fixed(Trash2), label: 'Delete', desc: 'Move the selection to the trash', command: 'Delete' },
  { id: 'rename', group: 'ops', icon: fixed(PencilLine), label: 'Rename', desc: 'Rename in place; with several items selected opens Advanced Rename', command: 'Rename' },
  { id: 'advrename', group: 'ops', icon: fixed(Wand2), label: 'Batch rename', desc: 'Advanced Rename: wildcards, regex, numbering, case, date macros, presets', command: 'Rename ADVANCED' },
  { id: 'newfolder', group: 'ops', icon: fixed(FolderPlus), label: 'New folder', desc: 'Create a new folder in the current folder', command: 'CreateFolder' },
  { id: 'newfile', group: 'ops', icon: fixed(FilePlus), label: 'New file', desc: 'Create a new empty file in the current folder', command: 'CreateFile' },
  { id: 'view-details', group: 'view', icon: fixed(LayoutList), label: 'Details', desc: 'Rows with columns you can sort, group and expand in place', command: 'Set VIEW=details', active: (s) => tab(s).viewMode === 'details' },
  { id: 'view-list', group: 'view', icon: fixed(List), label: 'List', desc: 'Compact list of names in several columns', command: 'Set VIEW=list', active: (s) => tab(s).viewMode === 'list' },
  { id: 'view-icons', group: 'view', icon: fixed(LayoutGrid), label: 'Icons', desc: 'Large icons in a grid', command: 'Set VIEW=icons', active: (s) => tab(s).viewMode === 'icons' },
  { id: 'view-thumbs', group: 'view', icon: fixed(Image), label: 'Thumbnails', desc: 'Previews of images, videos and PDFs', command: 'Set VIEW=thumbnails', active: (s) => tab(s).viewMode === 'thumbnails' },
  { id: 'view-columns', group: 'view', icon: fixed(Columns3), label: 'Columns', desc: 'Finder-style columns: folders open to the right', command: 'Set VIEW=columns', active: (s) => tab(s).viewMode === 'columns' },
  { id: 'quicklook', group: 'panes', icon: fixed(ScanEye), label: 'Quick Look', desc: 'Large preview of the focused item (Space). Arrow keys move to the next item.', command: 'QuickLook', active: (s) => s.quickLook },
  { id: 'dual', group: 'panes', icon: fixed(Columns2), label: 'Dual', desc: 'Show two file displays: source and destination', command: 'Set DUAL=toggle', active: (s) => s.prefs.dualDisplay },
  { id: 'dualvert', group: 'panes', icon: (s) => (s.prefs.dualVertical ? Rows2 : Columns2), label: 'Orientation', desc: 'Place the two displays side by side or one above the other', command: 'Set DUALVERT=toggle', disabled: (s) => !s.prefs.dualDisplay },
  { id: 'tree', group: 'panes', icon: fixed(FolderTree), label: 'Tree', desc: 'Show or hide the sidebar with favorites, places, labels and the folder tree', command: 'Set TREE=toggle', active: (s) => s.prefs.showTree },
  { id: 'viewer', group: 'panes', icon: fixed(PanelRight), label: 'Viewer', desc: 'Preview pane on the right for the focused file', command: 'Set VIEWER=toggle', active: (s) => s.prefs.showViewer },
  { id: 'hidden', group: 'panes', icon: (s) => (s.prefs.showHidden ? Eye : EyeOff), label: 'Hidden', desc: 'Show or hide hidden and system files', command: 'Set HIDDEN=toggle', active: (s) => s.prefs.showHidden },
  { id: 'find', group: 'tools', icon: fixed(Search), label: 'Find', desc: 'Search by name, content, size or date', command: 'Find' },
  { id: 'semantic', group: 'tools', icon: fixed(Sparkles), label: 'Ask', desc: 'Semantic search: find documents by what they are about, in any language', command: 'Find SEMANTIC' },
  { id: 'flat', group: 'tools', icon: fixed(Layers), label: 'Flat', desc: 'Flat View: every file of every subfolder in one list', command: 'Set FLATVIEW=toggle', active: (s) => tab(s).flat },
  { id: 'expandable', group: 'tools', icon: fixed(ListTree), label: 'Expandable', desc: 'Allow folders to expand in place in Details view (→ / ←)', command: 'Set EXPANDABLEFOLDERS=toggle', active: (s) => s.prefs.expandableFolders },
  { id: 'navlock', group: 'tools', icon: fixed(Link2), label: 'Nav lock', desc: 'Navigation Lock: the other pane follows when you change folder', command: 'Set NAVLOCK=toggle', active: (s) => s.navLock, disabled: (s) => !s.prefs.dualDisplay },
  { id: 'sync', group: 'tools', icon: fixed(ArrowLeftRight), label: 'Sync', desc: 'Compare and synchronize the two panes', command: 'Synchronize', disabled: (s) => !s.prefs.dualDisplay },
  { id: 'dupes', group: 'tools', icon: fixed(Files), label: 'Duplicates', desc: 'Find duplicate files by content', command: 'Duplicates' },
  { id: 'sizes', group: 'tools', icon: fixed(Calculator), label: 'Sizes', desc: 'Calculate the size of the selected folders', command: 'GetSizes' },
  { id: 'fav', group: 'tools', icon: fixed(Star), label: 'Favorite', desc: 'Add or remove the current folder from favorites', command: 'Favorites', active: (s) => s.favorites.some((f) => f.path === tab(s).path) },
  { id: 'undo', group: 'tools', icon: fixed(Undo2), label: 'Undo', desc: 'Undo the last rename, move, copy or new item', command: 'Undo', disabled: (s) => !s.undoLabel },
  { id: 'newwindow', group: 'app', icon: fixed(AppWindow), label: 'Window', desc: 'Open a new window on this folder', command: 'Go NEWWINDOW' },
  { id: 'cli', group: 'app', icon: fixed(Terminal), label: 'Command', desc: 'Command line for Opal commands, e.g. Select PATTERN=*.jpg', command: 'CLI' },
  { id: 'terminal', group: 'app', icon: fixed(SquareTerminal), label: 'Terminal', desc: 'Open a system terminal in this folder', command: 'Terminal' },
  { id: 'theme', group: 'app', icon: (s) => (s.prefs.theme === 'system' ? SunMoon : resolvedTheme(s.prefs) === 'dark' ? Sun : Moon), label: 'Theme', desc: 'Switch between dark and light theme', command: 'Set THEME=toggle' },
  { id: 'prefs', group: 'app', icon: fixed(Settings), label: 'Settings', desc: 'Preferences: appearance, behaviour, columns, keys, toolbar, search', command: 'Prefs' },
  { id: 'help', group: 'app', icon: fixed(HelpCircle), label: 'Help', desc: 'List of commands and keyboard shortcuts', command: 'Help' }
]

export const DEFAULT_TOOLBAR = TOOLBAR_BUTTONS.filter((b) => !['advrename', 'view-list', 'newwindow', 'expandable', 'terminal'].includes(b.id)).map((b) => b.id)

export function Toolbar() {
  const state = useStore((s) => s)
  const prefs = state.prefs
  const ids = prefs.toolbarButtons.length ? prefs.toolbarButtons : DEFAULT_TOOLBAR
  const buttons = ids.map((id) => TOOLBAR_BUTTONS.find((b) => b.id === id)).filter((b): b is ToolbarButtonDef => !!b)
  const groups: ToolbarButtonDef[][] = []
  for (const b of buttons) {
    const last = groups[groups.length - 1]
    if (last && last[0].group === b.group) last.push(b)
    else groups.push([b])
  }

  return (
    <div className={`toolbar${prefs.toolbarLabels ? ' with-labels' : ''}`} role="toolbar">
      {groups.map((g, i) => (
        <div className="tb-group" key={i}>
          {g.map((b) => {
            const Icon = b.icon(state)
            const key = keyFor(b.command)
            return (
              <button
                key={b.id}
                data-testid={`tb-${b.id}`}
                className={`tb-btn${b.active?.(state) ? ' active' : ''}`}
                aria-label={b.label}
                data-help-title={b.label}
                data-help-desc={b.desc}
                data-help-keys={key || undefined}
                data-help-place="below"
                disabled={b.disabled?.(state)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void runCommand(b.command)}
              >
                <Icon size={17} strokeWidth={1.75} />
                {prefs.toolbarLabels && <span className="tb-label">{b.label}</span>}
              </button>
            )
          })}
        </div>
      ))}
      <div className="tb-spacer" />
      <div className="tb-brand">Opal</div>
    </div>
  )
}
