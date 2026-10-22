import { useLayoutEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  FolderOpen,
  ExternalLink,
  PanelRightOpen,
  SquarePlus,
  FolderSearch,
  Copy,
  Scissors,
  ClipboardPaste,
  Link,
  CopyPlus,
  MoveRight,
  FileSymlink,
  PencilLine,
  Wand2,
  Trash2,
  Calculator,
  Star,
  Split,
  Combine,
  Info,
  FolderPlus,
  FilePlus,
  CheckSquare,
  Asterisk,
  ListChecks,
  RefreshCw,
  SquareTerminal,
  ChevronRight,
  ListTree,
  Eye,
  LayoutList,
  ArrowDownAZ,
  Group,
  Tag,
  Check,
  Columns3,
  List,
  LayoutGrid,
  Image,
  Sparkles,
  CircleOff,
  Search
} from 'lucide-react'
import { activeTab, getState, setState, useStore } from '../state/store'
import { keyFor, runCommand } from '../state/commands'
import * as A from '../state/actions'
import { COLUMN_LABELS, GROUP_OPTIONS } from './FileList'
import type { FileEntry, SortColumn, ViewMode } from '@shared/types'

export interface MenuItem {
  icon?: LucideIcon
  /** Coloured dot instead of an icon (labels). */
  color?: string
  label: string
  /** Shown by the side helper popup when hovering. */
  desc?: string
  hint?: string
  action?: () => void
  disabled?: boolean
  checked?: boolean
  danger?: boolean
  submenu?: MenuEntry[]
  testId?: string
}
export type MenuEntry = MenuItem | 'sep'

export function ContextMenu() {
  const menu = useStore((s) => s.contextMenu)
  useStore((s) => s.hotkeys)
  if (!menu) return null
  return <MenuPopup x={menu.x} y={menu.y} items={buildItems(menu.pane, menu.target)} root testId="context-menu" />
}

function MenuPopup({ x, y, items, root, testId }: { x: number; y: number; items: MenuEntry[]; root?: boolean; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [openSub, setOpenSub] = useState<{ index: number; x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) })
  }, [x, y, items.length])

  return (
    <div
      ref={ref}
      className={`context-menu${root ? '' : ' submenu'}`}
      data-testid={testId}
      style={{ left: pos?.x ?? x, top: pos?.y ?? y, visibility: pos ? 'visible' : 'hidden' }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it === 'sep' ? (
          <div key={i} className="cm-sep" />
        ) : (
          <div
            key={i}
            className={`cm-item${it.disabled ? ' disabled' : ''}${it.danger ? ' danger' : ''}${openSub?.index === i ? ' open' : ''}`}
            data-testid={it.testId}
            data-help-title={it.desc ? it.label : undefined}
            data-help-desc={it.desc}
            data-help-keys={it.hint || undefined}
            onMouseEnter={(e) => {
              if (it.submenu) {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                const menuR = ref.current!.getBoundingClientRect()
                setOpenSub({ index: i, x: menuR.right - 2, y: r.top - 4 })
              } else setOpenSub(null)
            }}
            onClick={() => {
              if (it.disabled || it.submenu) return
              setState({ contextMenu: null })
              it.action?.()
            }}
          >
            <span className="cm-icon">{it.color ? <span className="cm-color" style={{ background: it.color }} /> : it.icon ? <it.icon size={15} strokeWidth={1.8} /> : null}</span>
            <span className="cm-label">{it.label}</span>
            {it.checked !== undefined && <span className="cm-check">{it.checked ? <Check size={13} /> : null}</span>}
            {it.hint && <span className="cm-hint">{it.hint}</span>}
            {it.submenu && <ChevronRight size={13} className="cm-sub-arrow" />}
          </div>
        )
      )}
      {openSub && (items[openSub.index] as MenuItem).submenu && (
        <MenuPopup x={openSub.x} y={openSub.y} items={(items[openSub.index] as MenuItem).submenu!} />
      )}
    </div>
  )
}

const VIEW_OPTIONS: { id: ViewMode; label: string; icon: LucideIcon; desc: string }[] = [
  { id: 'details', label: 'Details', icon: LayoutList, desc: 'Rows with sortable columns; folders can be expanded in place' },
  { id: 'list', label: 'List', icon: List, desc: 'Compact multi-column list of names' },
  { id: 'icons', label: 'Icons', icon: LayoutGrid, desc: 'Large icons in a grid' },
  { id: 'thumbnails', label: 'Thumbnails', icon: Image, desc: 'Image and video previews in a grid' },
  { id: 'columns', label: 'Columns', icon: Columns3, desc: 'Finder-style columns: each folder opens in a new column to the right' }
]

const SORT_OPTIONS: SortColumn[] = ['name', 'ext', 'size', 'type', 'mtime', 'ctime', 'atime', 'path', 'label', 'dimensions', 'items']

function viewSubmenu(pane: 0 | 1): MenuEntry[] {
  const tab = activeTab(pane)
  return VIEW_OPTIONS.map((v) => ({
    icon: v.icon,
    label: v.label,
    desc: v.desc,
    checked: tab.viewMode === v.id,
    hint: keyFor(`Set VIEW=${v.id}`),
    action: () => A.setFormat(pane, { viewMode: v.id })
  }))
}

function sortSubmenu(pane: 0 | 1): MenuEntry[] {
  const tab = activeTab(pane)
  return [
    ...SORT_OPTIONS.map((c) => ({
      label: COLUMN_LABELS[c],
      desc: `Sort the folder by ${COLUMN_LABELS[c].toLowerCase()}`,
      checked: tab.sort.column === c,
      action: () => A.setFormat(pane, { sort: { column: c, descending: tab.sort.column === c ? tab.sort.descending : ['size', 'mtime', 'ctime', 'atime', 'dimensions', 'items'].includes(c) } })
    })),
    'sep',
    {
      icon: ArrowDownAZ,
      label: tab.sort.descending ? 'Ascending order' : 'Descending order',
      desc: 'Reverse the current sort order',
      action: () => A.setFormat(pane, { sort: { ...tab.sort, descending: !tab.sort.descending } })
    },
    {
      label: 'Folders first',
      desc: 'Where folders appear: before files, mixed with them, or after',
      checked: getState().prefs.folderPlacement === 'first',
      action: () => A.setPrefs({ folderPlacement: getState().prefs.folderPlacement === 'first' ? 'mixed' : 'first' })
    }
  ]
}

function groupSubmenu(pane: 0 | 1): MenuEntry[] {
  const tab = activeTab(pane)
  return GROUP_OPTIONS.map((g) => ({ label: g.label, desc: `${g.desc}. Grouping works in Details view.`, checked: tab.groupBy === g.id, action: () => A.setFormat(pane, { groupBy: g.id, viewMode: 'details' }) }))
}

function labelSubmenu(paths: string[]): MenuEntry[] {
  const s = getState()
  const has = (id: string): boolean => paths.length > 0 && paths.every((p) => s.labels[p]?.includes(id))
  return [
    ...s.labelDefs.map((l, i) => ({
      color: l.color,
      label: l.name,
      desc: `Add or remove the "${l.name}" label. Labels can be shown as a column, used for sorting and grouping, and listed in the sidebar.`,
      checked: has(l.id),
      hint: keyFor(`Properties SETLABEL=${l.id}`) || `Ctrl+Alt+${i + 1}`,
      testId: `label-${l.id}`,
      action: () => A.toggleLabel(paths, l.id)
    })),
    'sep',
    { icon: CircleOff, label: 'Remove all labels', desc: 'Clear every label from the selected items', action: () => A.clearLabels(paths) }
  ]
}

function buildItems(pane: 0 | 1, t: FileEntry | null): MenuEntry[] {
  const s = getState()
  const run = (cmd: string) => () => void runCommand(cmd)
  const dual = s.prefs.dualDisplay
  const sel = A.selectedEntries(pane)
  const multi = sel.length > 1
  const paths = sel.map((e) => e.path)
  const what = multi ? `the ${sel.length} selected items` : t ? `"${t.name}"` : ''
  const common: MenuEntry[] = [
    { icon: Eye, label: 'View', desc: 'How items are displayed in this folder', submenu: viewSubmenu(pane) },
    { icon: ArrowDownAZ, label: 'Sort by', desc: 'Order of items in this folder', submenu: sortSubmenu(pane) },
    { icon: Group, label: 'Group by', desc: 'Split the list into collapsible groups', submenu: groupSubmenu(pane) }
  ]
  if (!t) {
    return [
      { icon: FolderPlus, label: 'New folder…', desc: 'Create an empty folder here and name it', hint: keyFor('CreateFolder'), action: run('CreateFolder') },
      { icon: FilePlus, label: 'New text file…', desc: 'Create an empty file here and name it', hint: keyFor('CreateFile'), action: run('CreateFile') },
      { icon: ClipboardPaste, label: s.clipboard ? `Paste ${s.clipboard.paths.length} item(s) here` : 'Paste', desc: 'Copy or move the items on the clipboard into this folder', hint: keyFor('Clipboard PASTE'), action: run('Clipboard PASTE'), disabled: !s.clipboard },
      'sep',
      ...common,
      'sep',
      { icon: CheckSquare, label: 'Select all', desc: 'Select every item in this folder', hint: keyFor('Select ALL'), action: run('Select ALL') },
      { icon: Asterisk, label: 'Select by pattern…', desc: 'Select items whose names match a wildcard such as *.jpg or (a|b)*', hint: keyFor('Select PATTERN'), action: run('Select PATTERN') },
      { icon: ListChecks, label: 'Invert selection', desc: 'Select what is not selected, and vice versa', hint: keyFor('Select INVERT'), action: run('Select INVERT') },
      { icon: RefreshCw, label: 'Reselect previous items', desc: 'Restore the selection that was active before the last copy or move', action: run('Select RESELECT') },
      ...(dual ? [{ icon: Search, label: 'Select items missing from the other pane', desc: 'Selects items here whose names do not exist in the destination folder', action: run('Select DESTTOSOURCE=notin DESELECTNOMATCH') } as MenuEntry] : []),
      'sep',
      { icon: Calculator, label: 'Calculate all folder sizes', desc: 'Compute the total size of every folder shown here', hint: keyFor('GetSizes'), action: run('GetSizes ALL') },
      { icon: Sparkles, label: 'Search contents by meaning…', desc: 'Semantic search: describe what a document is about, in any language', action: run('Find SEMANTIC') },
      { icon: RefreshCw, label: 'Refresh', desc: 'Read the folder again from disk', hint: keyFor('Go REFRESH'), action: run('Go REFRESH') },
      { icon: SquareTerminal, label: 'Open terminal here', desc: 'Open a system terminal in this folder', hint: keyFor('Terminal'), action: run('Terminal') },
      { icon: FolderSearch, label: 'Show in system file manager', desc: 'Open this folder in Explorer / Finder / your desktop file manager', action: () => void window.opal.reveal(activeTab(pane).path) }
    ]
  }
  return [
    { icon: t.isDir ? FolderOpen : ExternalLink, label: t.isDir ? 'Open folder' : 'Open with default app', desc: t.isDir ? 'Show the contents of this folder' : 'Open the file with the application associated with its type', hint: 'Enter', action: () => void A.openEntry(pane, t) },
    { icon: Eye, label: 'Quick Look', desc: 'Large preview without opening any application. Use the arrow keys to move to the next item.', hint: 'Space', action: () => A.toggleQuickLook(true) },
    ...(t.isDir && s.prefs.expandableFolders ? [{ icon: ListTree, label: 'Expand in place', desc: 'Show the contents of the folder inside this list, like a tree', hint: keyFor('Go EXPANDBRANCH'), action: run('Go EXPANDBRANCH=toggle') } as MenuEntry] : []),
    ...(t.isDir
      ? ([
          { icon: PanelRightOpen, label: 'Open in other pane', desc: 'Show this folder in the destination pane', action: () => void A.openEntry(pane, t, true) },
          { icon: SquarePlus, label: 'Open in new tab', desc: 'Open this folder in a new tab of this pane', action: () => A.newTab(pane, t.path) }
        ] as MenuEntry[])
      : []),
    { icon: FolderSearch, label: 'Show in system file manager', desc: 'Reveal the item in Explorer / Finder / your desktop file manager', action: () => void window.opal.reveal(t.path) },
    'sep',
    { icon: Copy, label: 'Copy', desc: `Put ${what} on the clipboard to paste elsewhere`, hint: keyFor('Clipboard COPY'), action: run('Clipboard COPY') },
    { icon: Scissors, label: 'Cut', desc: `Move ${what} when you paste`, hint: keyFor('Clipboard CUT'), action: run('Clipboard CUT') },
    { icon: ClipboardPaste, label: 'Paste', desc: 'Paste the clipboard items into this folder', hint: keyFor('Clipboard PASTE'), action: run('Clipboard PASTE'), disabled: !s.clipboard },
    { icon: Link, label: 'Copy full path', desc: 'Copy the complete path as text', hint: keyFor('Clipboard COPYNAMES'), action: run('Clipboard COPYNAMES') },
    'sep',
    ...(dual
      ? ([
          { icon: CopyPlus, label: 'Copy to other pane', desc: `Copy ${what} into the folder shown in the destination pane`, hint: keyFor('Copy TO={destpath}'), action: run('Copy TO={destpath}') },
          { icon: MoveRight, label: 'Move to other pane', desc: `Move ${what} into the folder shown in the destination pane`, hint: keyFor('Copy MOVE TO={destpath}'), action: run('Copy MOVE TO={destpath}') },
          { icon: FileSymlink, label: 'Copy as…', desc: 'Copy to the other pane giving each item a new name', hint: keyFor('Copy AS TO={destpath}'), action: run('Copy AS TO={destpath}') },
          'sep'
        ] as MenuEntry[])
      : []),
    { icon: PencilLine, label: multi ? 'Rename…' : 'Rename', desc: multi ? 'Batch rename with wildcards, regex, numbering and live preview' : 'Edit the name in place', hint: keyFor('Rename'), action: run(multi ? 'Rename ADVANCED' : 'Rename') },
    { icon: Wand2, label: 'Advanced rename…', desc: 'Batch rename with wildcards, regular expressions, numbering, case and date macros', hint: keyFor('Rename ADVANCED'), action: run('Rename ADVANCED') },
    { icon: Tag, label: 'Label', desc: 'Colour labels (tags) to find and group items later', submenu: labelSubmenu(paths) },
    { icon: Trash2, label: s.prefs.useTrash ? 'Move to trash' : 'Delete', desc: s.prefs.useTrash ? `Send ${what} to the trash (can be restored)` : `Permanently delete ${what}`, hint: keyFor('Delete'), action: run('Delete'), danger: true },
    'sep',
    ...common,
    'sep',
    ...(t.isDir
      ? ([
          { icon: Calculator, label: 'Calculate size', desc: 'Compute the total size of the folder and its contents', hint: keyFor('GetSizes'), action: run('GetSizes') },
          { icon: Star, label: s.favorites.some((f) => f.path === t.path) ? 'Remove from favorites' : 'Add to favorites', desc: 'Favorites appear at the top of the sidebar', action: () => A.toggleFavorite(t.path) },
          { icon: Sparkles, label: 'Index for semantic search', desc: 'Add this folder to the folders whose documents can be searched by meaning', action: () => void A.addSemanticFolder(t.path) }
        ] as MenuEntry[])
      : []),
    ...(!t.isDir ? [{ icon: Split, label: 'Split file…', desc: 'Cut the file into parts of a chosen size', action: run('Split') } as MenuEntry] : []),
    ...(multi ? [{ icon: Combine, label: 'Join files…', desc: 'Concatenate the selected parts into one file', action: run('Join') } as MenuEntry] : []),
    { icon: Info, label: 'Properties', desc: 'Size, dates, attributes and checksums', hint: keyFor('Properties'), action: run('Properties') }
  ]
}
