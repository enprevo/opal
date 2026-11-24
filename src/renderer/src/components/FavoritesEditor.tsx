import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, Folder, FolderInput, FolderOpen, FolderPlus, PencilLine, Plus, Search, Trash2, X, Keyboard } from 'lucide-react'
import { closeDialog, getState, setState, useStore } from '../state/store'
import * as A from '../state/actions'
import type { Favorite } from '@shared/types'
import { barSlots } from '@shared/favorites'
import { isFavoriteShortcut } from '@shared/settings'
import { basename } from '@shared/paths'
import { Modal, ShortcutField } from './Dialogs'
import { FileIcon } from './FileIcon'
import { openMenu, type MenuEntry } from './ContextMenu'
import { readDragPaths } from './FileDisplay'

/*
 * "Edit favorites", laid out like a browser's bookmark manager: the folders on the left (the favorites bar and its
 * groups), the content of the chosen folder on the right. Everything moves by dragging: rows up and down, rows onto a
 * folder (left or right), groups along the bar. Double-click renames an item or opens a folder; right-click has the
 * rest. Nothing is saved until Save.
 */

interface Item {
  key: string
  fav: Favorite
}
interface Group {
  key: string
  name: string
  items: Item[]
}
type Entry = ({ kind: 'item' } & Item) | ({ kind: 'group' } & Group)

/** The folder shown on the right: the bar itself or one group. */
type FolderKey = 'bar' | string

const DRAG_TYPE = 'application/x-opal-favorite-edit'
let seq = 0
const newKey = (p: string): string => `${p}${++seq}`
const nameOf = (f: Favorite): string => f.label || basename(f.path) || f.path
const samePathIn = (items: Item[], path: string, except?: string): boolean => items.some((i) => i.key !== except && i.fav.path.toLowerCase() === path.toLowerCase())

function load(): Entry[] {
  const s = getState()
  return barSlots(s.favorites, s.prefs.favoriteGroups).map((slot): Entry => {
    if (slot.kind === 'item') {
      const { group: _g, ...fav } = slot.fav
      return { kind: 'item', key: newKey('i'), fav }
    }
    return {
      kind: 'group',
      key: newKey('g'),
      name: slot.name,
      items: slot.items.map(({ fav }) => {
        const { group: _g, ...rest } = fav
        return { key: newKey('i'), fav: rest }
      })
    }
  })
}

/** Where a dragged row lands: in a folder, before a row of it (null = at the end). */
interface DropTarget {
  folder: FolderKey
  before: string | null
}

export function FavoritesEditor() {
  const initial = useMemo(load, [])
  const [root, setRoot] = useState<Entry[]>(initial)
  const [folder, setFolder] = useState<FolderKey>('bar')
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  /** Folder renamed in the tree on the left (kept apart from the list, so only one name field is open). */
  const [treeEditing, setTreeEditing] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [dropRow, setDropRow] = useState<{ key: string; edge: 'before' | 'after' | 'into' } | null>(null)
  const [dropFolder, setDropFolder] = useState<FolderKey | null>(null)
  const dragging = useRef<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const hotkeys = useStore((s) => s.hotkeys)

  const groups = root.filter((e): e is Extract<Entry, { kind: 'group' }> => e.kind === 'group')
  const group = folder === 'bar' ? null : (groups.find((g) => g.key === folder) ?? null)
  useEffect(() => {
    if (folder !== 'bar' && !group) setFolder('bar')
  }, [folder, group])

  /** Every item with the folder holding it. */
  const allItems = (): { item: Item; folder: FolderKey }[] => [
    ...root.filter((e): e is Extract<Entry, { kind: 'item' }> => e.kind === 'item').map((e) => ({ item: e, folder: 'bar' as FolderKey })),
    ...groups.flatMap((g) => g.items.map((item) => ({ item, folder: g.key })))
  ]
  const itemsOf = (f: FolderKey): Item[] => (f === 'bar' ? root.filter((e): e is Extract<Entry, { kind: 'item' }> => e.kind === 'item') : (groups.find((g) => g.key === f)?.items ?? []))
  const flash = (text: string): void => {
    setNotice(text)
    window.setTimeout(() => setNotice((n) => (n === text ? '' : n)), 3500)
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Changes to the draft
  // ---------------------------------------------------------------------------------------------------------------

  /** Moves an item or a group to a folder (groups only move along the bar). */
  const moveTo = (key: string, target: DropTarget): void => {
    const found = allItems().find(({ item }) => item.key === key)
    if (found && found.folder !== target.folder && samePathIn(itemsOf(target.folder), found.item.fav.path)) {
      flash(`"${nameOf(found.item.fav)}" is already in that folder`)
      return
    }
    setRoot((cur) => {
      if (target.before === key) return cur
      const isGroup = cur.some((e) => e.kind === 'group' && e.key === key)
      if (isGroup) {
        if (target.folder !== 'bar') return cur
        const g = cur.find((e) => e.key === key)!
        const rest = cur.filter((e) => e.key !== key)
        const at = target.before ? rest.findIndex((e) => e.key === target.before) : -1
        return at < 0 ? [...rest, g] : [...rest.slice(0, at), g, ...rest.slice(at)]
      }
      // Take the item out of wherever it is.
      let moving: Item | null = null
      let from: FolderKey = 'bar'
      for (const e of cur) {
        if (e.kind === 'item' && e.key === key) moving = { key: e.key, fav: e.fav }
        if (e.kind === 'group') {
          const it = e.items.find((i) => i.key === key)
          if (it) {
            moving = it
            from = e.key
          }
        }
      }
      if (!moving) return cur
      const destItems = target.folder === 'bar' ? cur.filter((e) => e.kind === 'item') : (cur.find((e) => e.key === target.folder) as Group | undefined)?.items
      if (!destItems) return cur
      if (from !== target.folder && samePathIn(destItems as Item[], moving.fav.path)) return cur
      const without = cur
        .filter((e) => !(e.kind === 'item' && e.key === key))
        .map((e) => (e.kind === 'group' ? { ...e, items: e.items.filter((i) => i.key !== key) } : e))
      if (target.folder === 'bar') {
        const entry: Entry = { kind: 'item', ...moving }
        const at = target.before ? without.findIndex((e) => e.key === target.before) : -1
        return at < 0 ? [...without, entry] : [...without.slice(0, at), entry, ...without.slice(at)]
      }
      return without.map((e) => {
        if (e.kind !== 'group' || e.key !== target.folder) return e
        const at = target.before ? e.items.findIndex((i) => i.key === target.before) : -1
        const items = at < 0 ? [...e.items, moving!] : [...e.items.slice(0, at), moving!, ...e.items.slice(at)]
        return { ...e, items }
      })
    })
  }

  const patchItem = (key: string, patch: Partial<Favorite>): void => {
    const apply = (it: Item): Item => {
      if (it.key !== key) return it
      const fav = { ...it.fav, ...patch }
      for (const k of Object.keys(fav) as (keyof Favorite)[]) if (fav[k] === undefined || fav[k] === '') delete fav[k]
      return { ...it, fav }
    }
    setRoot((cur) => cur.map((e) => (e.kind === 'item' ? { kind: 'item', ...apply(e) } : { ...e, items: e.items.map(apply) })))
  }

  const removeKey = (key: string): void => {
    setRoot((cur) => {
      const g = cur.find((e) => e.kind === 'group' && e.key === key) as (Group & { kind: 'group' }) | undefined
      if (g) {
        // A removed group gives its favorites back to the bar, where the group was.
        const at = cur.indexOf(g)
        const freed: Entry[] = g.items.filter((it) => !cur.some((e) => e.kind === 'item' && e.fav.path.toLowerCase() === it.fav.path.toLowerCase())).map((it) => ({ kind: 'item', ...it }))
        return [...cur.slice(0, at), ...freed, ...cur.slice(at + 1)]
      }
      return cur.filter((e) => !(e.kind === 'item' && e.key === key)).map((e) => (e.kind === 'group' ? { ...e, items: e.items.filter((i) => i.key !== key) } : e))
    })
    if (selected === key) setSelected(null)
  }

  const renameGroup = (key: string, name: string): boolean => {
    const clean = name.trim()
    if (!clean) return false
    if (groups.some((g) => g.key !== key && g.name === clean)) {
      flash(`There is already a folder named "${clean}"`)
      return false
    }
    setRoot((cur) => cur.map((e) => (e.kind === 'group' && e.key === key ? { ...e, name: clean } : e)))
    return true
  }

  const newFolder = (): void => {
    let n = 1
    while (groups.some((g) => g.name === (n === 1 ? 'New folder' : `New folder ${n}`))) n++
    const g: Entry = { kind: 'group', key: newKey('g'), name: n === 1 ? 'New folder' : `New folder ${n}`, items: [] }
    setRoot((cur) => [...cur, g])
    setFolder('bar')
    setSelected(g.key)
    setEditing(g.key)
  }

  const addPaths = async (paths: string[], target: DropTarget): Promise<void> => {
    for (const p of paths) {
      let file = false
      try {
        file = !(await window.opal.stat(p)).isDir
      } catch {
        continue
      }
      if (samePathIn(itemsOf(target.folder), p)) {
        flash(`"${basename(p)}" is already in that folder`)
        continue
      }
      const item: Item = { key: newKey('i'), fav: file ? { path: p, file: true } : { path: p } }
      setRoot((cur) => {
        if (target.folder === 'bar') {
          const at = target.before ? cur.findIndex((e) => e.key === target.before) : -1
          const entry: Entry = { kind: 'item', ...item }
          return at < 0 ? [...cur, entry] : [...cur.slice(0, at), entry, ...cur.slice(at)]
        }
        return cur.map((e) => (e.kind === 'group' && e.key === target.folder ? { ...e, items: [...e.items, item] } : e))
      })
    }
  }

  const addFolderPicked = async (): Promise<void> => {
    const p = await window.opal.pickFolder()
    if (p) await addPaths([p], { folder: group ? group.key : 'bar', before: null })
  }

  const setShortcut = (key: string, combo: string): void => {
    if (combo) {
      if (!isFavoriteShortcut(combo)) return flash('A shortcut needs Ctrl or Alt with a key, or a function key (F1–F24)')
      if (hotkeys[combo]) return flash(`${combo} is used by the command "${hotkeys[combo]}"`)
      const other = allItems().find(({ item }) => item.key !== key && item.fav.shortcut === combo)
      if (other) return flash(`${combo} is already used by "${nameOf(other.item.fav)}"`)
    }
    patchItem(key, { shortcut: combo || undefined })
  }

  const save = (): void => {
    const favorites: Favorite[] = []
    const names: string[] = []
    for (const e of root) {
      if (e.kind === 'item') favorites.push({ ...e.fav })
      else {
        names.push(e.name)
        for (const it of e.items) favorites.push({ ...it.fav, group: e.name })
      }
    }
    A.saveFavoritesEdit(favorites, names)
    closeDialog(true)
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Rows on the right
  // ---------------------------------------------------------------------------------------------------------------

  const q = query.trim().toLowerCase()
  type Shown = { entry: Entry; folder: FolderKey }
  const shown: Shown[] = q
    ? allItems()
        .filter(({ item }) => nameOf(item.fav).toLowerCase().includes(q) || item.fav.path.toLowerCase().includes(q))
        .map(({ item, folder: f }) => ({ entry: { kind: 'item', ...item }, folder: f }))
    : group
      ? group.items.map((it) => ({ entry: { kind: 'item', ...it } as Entry, folder: group.key }))
      : root.map((entry) => ({ entry, folder: 'bar' as FolderKey }))

  const folderName = (f: FolderKey): string => (f === 'bar' ? 'Favorites bar' : (groups.find((g) => g.key === f)?.name ?? ''))

  const accepts = (e: React.DragEvent): boolean => e.dataTransfer.types.includes(DRAG_TYPE) || e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/x-opal-paths')

  const dropAt = (e: React.DragEvent, target: DropTarget): void => {
    e.preventDefault()
    e.stopPropagation()
    setDropRow(null)
    setDropFolder(null)
    const key = e.dataTransfer.getData(DRAG_TYPE) || dragging.current
    dragging.current = null
    if (key) moveTo(key, target)
    else {
      const paths = readDragPaths(e.dataTransfer)
      if (paths.length) void addPaths(paths, target)
    }
  }

  const moveMenu = (key: string, f: FolderKey): MenuEntry => {
    const targets: MenuEntry[] = [
      ...(f !== 'bar' ? [{ icon: Bookmark, label: 'Favorites bar', testId: 'fe-move-bar', action: () => moveTo(key, { folder: 'bar', before: null }) } as MenuEntry] : []),
      ...groups.filter((g) => g.key !== f).map((g) => ({ icon: Folder, label: g.name, testId: 'fe-move-group', action: () => moveTo(key, { folder: g.key, before: null }) }) as MenuEntry)
    ]
    return targets.length
      ? { icon: FolderInput, label: 'Move to', testId: 'fe-menu-move', submenu: targets }
      : { icon: FolderInput, label: 'Move to', desc: 'Create a folder first (New folder)', disabled: true }
  }

  const rowMenu = (e: React.MouseEvent, entry: Entry, f: FolderKey): void => {
    setSelected(entry.key)
    const items: MenuEntry[] =
      entry.kind === 'group'
        ? [
            { icon: FolderOpen, label: 'Open', action: () => setFolder(entry.key) },
            { icon: PencilLine, label: 'Rename', hint: 'F2', testId: 'fe-menu-rename', action: () => setEditing(entry.key) },
            'sep',
            { icon: Trash2, label: 'Remove folder', desc: 'Its favorites go back on the bar', danger: true, testId: 'fe-menu-remove', action: () => removeKey(entry.key) }
          ]
        : [
            { icon: PencilLine, label: 'Rename', hint: 'F2', testId: 'fe-menu-rename', action: () => setEditing(entry.key) },
            moveMenu(entry.key, f),
            { icon: Keyboard, label: 'Remove shortcut', disabled: !entry.fav.shortcut, action: () => patchItem(entry.key, { shortcut: undefined }) },
            'sep',
            { icon: X, label: 'Remove from favorites', hint: 'Del', danger: true, testId: 'fe-menu-remove', action: () => removeKey(entry.key) }
          ]
    openMenu(e, items, 'fe-menu')
  }

  const onListKey = (e: React.KeyboardEvent): void => {
    if (editing || !selected || (e.target as HTMLElement).closest('input, .shortcut-field')) return
    const idx = shown.findIndex((r) => r.entry.key === selected)
    if (e.key === 'F2') setEditing(selected)
    else if (e.key === 'Delete') removeKey(selected)
    else if (e.key === 'ArrowDown' && idx < shown.length - 1) setSelected(shown[idx + 1].entry.key)
    else if (e.key === 'ArrowUp' && idx > 0) setSelected(shown[idx - 1].entry.key)
    else if (e.key === 'Enter' && shown[idx]?.entry.kind === 'group') setFolder(selected)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const renderRow = ({ entry, folder: f }: Shown) => {
    const isGroup = entry.kind === 'group'
    const mark = dropRow?.key === entry.key ? ` drop-${dropRow.edge}` : ''
    const name = isGroup ? entry.name : nameOf(entry.fav)
    return (
      <div
        key={entry.key}
        className={`fe-row${selected === entry.key ? ' selected' : ''}${isGroup ? ' group' : ''}${mark}`}
        data-testid="fe-row"
        data-key={entry.key}
        data-path={isGroup ? undefined : entry.fav.path}
        data-group={isGroup ? entry.name : undefined}
        draggable={editing !== entry.key && !q}
        onMouseDown={() => setSelected(entry.key)}
        onDoubleClick={() => (isGroup ? setFolder(entry.key) : setEditing(entry.key))}
        onContextMenu={(e) => rowMenu(e, entry, f)}
        onDragStart={(e) => {
          dragging.current = entry.key
          e.dataTransfer.setData(DRAG_TYPE, entry.key)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragEnd={() => {
          dragging.current = null
          setDropRow(null)
          setDropFolder(null)
        }}
        onDragOver={(e) => {
          if (!accepts(e) || q) return
          e.preventDefault()
          e.stopPropagation()
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const y = (e.clientY - r.top) / r.height
          const draggingGroup = !!dragging.current && groups.some((g) => g.key === dragging.current)
          const edge = isGroup && !draggingGroup && dragging.current !== entry.key && y > 0.25 && y < 0.75 ? 'into' : y < 0.5 ? 'before' : 'after'
          if (dropRow?.key !== entry.key || dropRow.edge !== edge) setDropRow({ key: entry.key, edge })
        }}
        onDrop={(e) => {
          const edge = dropRow?.key === entry.key ? dropRow.edge : 'after'
          if (edge === 'into') return dropAt(e, { folder: entry.key, before: null })
          const list = shown.map((s) => s.entry.key)
          const i = list.indexOf(entry.key)
          dropAt(e, { folder: f, before: edge === 'before' ? entry.key : (list[i + 1] ?? null) })
        }}
      >
        <span className="fe-icon">{isGroup ? <Folder size={17} className="fb-group-icon" /> : <FileIcon path={entry.fav.path} isDir={!entry.fav.file} size={17} />}</span>
        <div className="fe-main">
          {editing === entry.key ? (
            <RenameInput
              initial={name}
              placeholder={isGroup ? 'Folder name' : basename(entry.fav.path)}
              onDone={(v) => {
                setEditing(null)
                if (v === null) return
                if (isGroup) renameGroup(entry.key, v)
                else {
                  const clean = v.trim()
                  patchItem(entry.key, { label: clean && clean !== basename(entry.fav.path) ? clean : undefined })
                }
                listRef.current?.focus()
              }}
            />
          ) : (
            <span className="fe-title">{name}</span>
          )}
          <span className="fe-sub" title={isGroup ? undefined : entry.fav.path}>
            {isGroup ? `${entry.items.length} item${entry.items.length === 1 ? '' : 's'}` : q ? `${folderName(f)} · ${entry.fav.path}` : entry.fav.path}
          </span>
        </div>
        {!isGroup && (
          <div className={`fe-shortcut${entry.fav.shortcut ? ' set' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
            <ShortcutField value={entry.fav.shortcut ?? ''} empty="Add shortcut" onChange={(v) => setShortcut(entry.key, v)} />
          </div>
        )}
        <div className="fe-actions">
          <button className="icon-btn" title="Rename (F2)" aria-label="Rename" data-testid="fe-rename" onClick={() => setEditing(entry.key)}>
            <PencilLine size={15} />
          </button>
          <button className="icon-btn danger" title={isGroup ? 'Remove folder (its favorites go back on the bar)' : 'Remove from favorites (Del)'} aria-label="Remove" data-testid="fe-remove" onClick={() => removeKey(entry.key)}>
            {isGroup ? <Trash2 size={15} /> : <X size={15} />}
          </button>
        </div>
      </div>
    )
  }

  const treeFolder = (key: FolderKey, label: string, count: number, icon: React.ReactNode) => (
    <div
      key={key}
      className={`fe-tree-item${!q && folder === key ? ' current' : ''}${dropFolder === key ? ' drop-into' : ''}${key !== 'bar' ? ' nested' : ''}`}
      data-testid="fe-tree-folder"
      data-name={label}
      onClick={() => {
        setQuery('')
        setFolder(key)
        setSelected(null)
      }}
      onDoubleClick={() => key !== 'bar' && setTreeEditing(key)}
      onContextMenu={(e) => {
        if (key === 'bar') openMenu(e, [{ icon: FolderPlus, label: 'New folder', action: newFolder }], 'fe-menu')
        else {
          const g = groups.find((x) => x.key === key)
          if (g) rowMenu(e, g as Entry, 'bar')
        }
      }}
      onDragOver={(e) => {
        if (!accepts(e)) return
        const draggingGroup = !!dragging.current && groups.some((g) => g.key === dragging.current)
        if (draggingGroup && key !== 'bar') return
        e.preventDefault()
        if (dropFolder !== key) setDropFolder(key)
      }}
      onDragLeave={() => dropFolder === key && setDropFolder(null)}
      onDrop={(e) => dropAt(e, { folder: key, before: null })}
    >
      {icon}
      {treeEditing === key && key !== 'bar' ? (
        <RenameInput
          initial={label}
          placeholder="Folder name"
          onDone={(v) => {
            setTreeEditing(null)
            if (v !== null) renameGroup(key, v)
          }}
        />
      ) : (
        <span className="fe-tree-label">{label}</span>
      )}
      <span className="fe-count">{count}</span>
    </div>
  )

  const barCount = root.length
  return (
    <Modal
      title="Edit favorites"
      wide
      testId="favorites-editor"
      footer={
        <>
          <span className="fe-footnote">Drag to reorder or onto a folder · double-click to rename · right-click for more</span>
          <button className="btn" onClick={() => closeDialog(null)}>
            Cancel
          </button>
          <button className="btn primary" data-testid="fe-save" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div
        className="fe-layout"
        onKeyDownCapture={(e) => {
          // Escape closes an open menu first, not the whole window.
          if (e.key === 'Escape' && getState().contextMenu) {
            e.stopPropagation()
            setState({ contextMenu: null })
          }
        }}
      >
        <div className="fe-top">
          <div className="fe-search">
            <Search size={14} />
            <input data-testid="fe-search" placeholder="Search favorites" value={query} spellCheck={false} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && query && (e.stopPropagation(), setQuery(''))} />
          </div>
          <button className="btn" data-testid="fe-new-folder" onClick={newFolder}>
            <FolderPlus size={14} /> New folder
          </button>
          <button className="btn" data-testid="fe-add-folder" onClick={() => void addFolderPicked()}>
            <Plus size={14} /> Add folder…
          </button>
        </div>
        <div className="fe-panes">
          <div className="fe-tree" data-testid="fe-tree">
            {treeFolder('bar', 'Favorites bar', barCount, <Bookmark size={16} className="fe-bar-icon" />)}
            {groups.map((g) => treeFolder(g.key, g.name, g.items.length, <Folder size={16} className="fb-group-icon" />))}
          </div>
          <div
            ref={listRef}
            className="fe-list"
            data-testid="fe-list"
            tabIndex={0}
            onKeyDown={onListKey}
            onDragOver={(e) => {
              if (!accepts(e) || q) return
              e.preventDefault()
              if (dropRow) setDropRow(null)
            }}
            onDrop={(e) => dropAt(e, { folder: group ? group.key : 'bar', before: null })}
          >
            <div className="fe-list-title">
              {q ? (
                `Search results (${shown.length})`
              ) : group ? (
                <>
                  <button className="fe-crumb" data-testid="fe-crumb-bar" onClick={() => setFolder('bar')}>
                    Favorites bar
                  </button>
                  <span className="fe-crumb-sep">›</span>
                  <span>{group.name}</span>
                </>
              ) : (
                'Favorites bar'
              )}
            </div>
            {shown.length === 0 && (
              <div className="fe-empty" data-testid="fe-empty">
                {q ? 'Nothing matches' : 'This folder is empty. Drag favorites here, or files and folders from your desktop.'}
              </div>
            )}
            {shown.map(renderRow)}
          </div>
        </div>
        {notice && (
          <div className="fe-notice error small" data-testid="fe-problem">
            {notice}
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Inline name editor: Enter keeps, Escape cancels, leaving the field keeps. */
function RenameInput({ initial, placeholder, onDone }: { initial: string; placeholder: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(initial)
  const done = useRef(false)
  const finish = (value: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(value)
  }
  return (
    <input
      className="fe-rename"
      data-testid="fe-name-input"
      autoFocus
      value={v}
      placeholder={placeholder}
      spellCheck={false}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setV(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(v)
        else if (e.key === 'Escape') finish(null)
      }}
      onBlur={() => finish(v)}
    />
  )
}
