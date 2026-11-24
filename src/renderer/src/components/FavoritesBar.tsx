import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Settings2, ChevronDown, ExternalLink, EyeOff, Folder, FolderInput, FolderPlus, Link, ListTree, Palette, PencilLine, Star, StarOff, Trash2, FolderOpen } from 'lucide-react'
import { activeTab, getState, useStore } from '../state/store'
import * as A from '../state/actions'
import type { Favorite } from '@shared/types'
import { barSlots, slotIndex, type BarSlot, type FavoriteTarget, type IndexedFavorite } from '@shared/favorites'
import { basename, samePath } from '@shared/paths'
import { readDragPaths } from './FileDisplay'
import { FileIcon } from './FileIcon'
import { groupColorSubmenu, openFolderMenu, openMenu, type MenuEntry } from './ContextMenu'

/** Drag data of a favorite (or a whole group) picked up on the bar. */
const FAV_TYPE = 'application/x-opal-favorite'
type Payload = { indices: number[] } | { group: string }
/** What is being dragged from the bar (drag-over handlers cannot read the data itself). */
let dragging: Payload | null = null

const SPRING_MS = 550

function accepts(e: React.DragEvent): boolean {
  const t = e.dataTransfer.types
  return t.includes(FAV_TYPE) || t.includes('application/x-opal-paths') || t.includes('Files')
}

function startDrag(e: React.DragEvent, payload: Payload): void {
  dragging = payload
  e.dataTransfer.setData(FAV_TYPE, JSON.stringify(payload))
  e.dataTransfer.effectAllowed = 'move'
}

/** Moves favorites dragged from the bar, or adds the files and folders dragged from a list or the desktop. */
function dropOn(e: React.DragEvent, target: FavoriteTarget): void {
  e.preventDefault()
  e.stopPropagation()
  const raw = e.dataTransfer.getData(FAV_TYPE)
  dragging = null
  if (raw) {
    let payload: Payload
    try {
      payload = JSON.parse(raw) as Payload
    } catch {
      return
    }
    if ('group' in payload) {
      // Groups are not nested: a group dropped "into" another lands next to it.
      if (target.group !== payload.group) A.moveFavoriteGroup(payload.group, target.beforeIndex ?? null)
    } else A.moveFavoritesTo(payload.indices, target)
    return
  }
  const paths = readDragPaths(e.dataTransfer)
  if (paths.length) void A.addFavoritePaths(paths, target)
}

const favName = (f: Favorite): string => f.label || basename(f.path) || f.path

function favHelp(f: Favorite): string {
  const what = f.file ? 'Click to open the file with its app.' : 'Click to show this folder; middle-click opens it in a new tab.'
  return `${f.path}${f.shortcut ? ` (${f.shortcut})` : ''}. ${what} Drag to reorder or into a group; right-click for more.`
}

function fileMenu(pane: 0 | 1, fav: Favorite): MenuEntry[] {
  return [
    { icon: ExternalLink, label: 'Open', desc: 'Open the file with its app', action: () => void A.openFavorite(pane, fav) },
    { icon: FolderOpen, label: 'Show in folder', desc: 'Show the folder that holds this file, with the file selected', testId: 'favorite-show-in-folder', action: () => void A.showFavoriteInFolder(pane, fav) },
    { icon: Link, label: 'Copy full path', desc: 'Copy the complete path as text', action: () => void window.opal.writeClipboardText(fav.path) },
    'sep',
    { icon: PencilLine, label: 'Rename favorite…', desc: 'The name shown on the bar and in the sidebar', testId: 'favorite-rename', action: () => void A.renameFavorite(fav) },
    { icon: ListTree, label: 'Move to group…', desc: 'Put the favorite in a group (a folder on the bar)', action: () => void A.moveFavoriteToGroup(fav) },
    { icon: StarOff, label: 'Remove from favorites', desc: 'Stop listing this file in the favorites', danger: true, testId: 'favorite-remove', action: () => A.removeFavorite(fav) },
    'sep',
    { icon: Settings2, label: 'Edit favorites…', desc: 'Rename, reorder, group and remove favorites, and give them shortcuts, in one window', testId: 'favorites-edit', action: () => void A.editFavorites() }
  ]
}

/** Menu of a favorite file (on the bar, in a group's list or in the sidebar). */
export function openFavoriteFileMenu(e: React.MouseEvent, pane: 0 | 1, fav: Favorite): void {
  openMenu(e, fileMenu(pane, fav), 'favorite-file-menu')
}

function groupMenu(name: string, open: () => void): MenuEntry[] {
  return [
    { icon: FolderOpen, label: 'Open group', desc: 'Show the favorites of this group', action: open },
    { icon: PencilLine, label: 'Rename group…', desc: 'The name of the folder on the bar', testId: 'favbar-group-rename', action: () => void A.renameFavoriteGroupPrompt(name) },
    {
      icon: Palette,
      label: 'Folder color',
      desc: 'Color of this folder on the bar, in the sidebar and in Edit favorites',
      testId: 'favbar-group-color',
      submenu: groupColorSubmenu(getState().favoriteGroupColors[name], (c) => A.setFavoriteGroupColor(name, c))
    },
    { icon: Trash2, label: 'Remove group', desc: 'Remove the folder from the bar; its favorites stay, straight on the bar', danger: true, testId: 'favbar-group-remove', action: () => A.removeFavoriteGroup(name) },
    'sep',
    { icon: FolderPlus, label: 'New group…', desc: 'A folder on the bar to keep favorites together', action: () => void A.createFavoriteGroup() },
    { icon: Settings2, label: 'Edit favorites…', desc: 'Rename, reorder, group and remove favorites, and give them shortcuts, in one window', testId: 'favorites-edit', action: () => void A.editFavorites() }
  ]
}

function barMenu(): MenuEntry[] {
  const s = getState()
  const cur = activeTab(s.activePane, s).path
  const has = A.isFavorite(cur)
  return [
    { icon: Settings2, label: 'Edit favorites…', desc: 'Rename, reorder, group and remove favorites, and give them shortcuts, in one window', testId: 'favorites-edit', action: () => void A.editFavorites() },
    'sep',
    { icon: has ? StarOff : Star, label: has ? 'Remove current folder' : 'Add current folder', desc: 'The folder shown in the active pane', action: () => A.toggleFavorite(cur) },
    { icon: FolderPlus, label: 'New group…', desc: 'A folder on the bar to keep favorites together', testId: 'favbar-new-group-menu', action: () => void A.createFavoriteGroup() },
    'sep',
    { icon: EyeOff, label: 'Hide favorites bar', desc: 'Show it again from Settings → Appearance or with the command Set FAVBAR=on', testId: 'favbar-hide', action: () => A.setPrefs({ showFavoritesBar: false }) }
  ]
}

type DropAt = { slot: number; edge: 'before' | 'after' | 'into' } | { end: true }

/** Horizontal favorites bar under the toolbar: files, folders and groups (shown as folders with a drop-down list). */
export function FavoritesBar() {
  const favorites = useStore((s) => s.favorites)
  const extraGroups = useStore((s) => s.prefs.favoriteGroups)
  const groupColors = useStore((s) => s.favoriteGroupColors)
  const pane = useStore((s) => s.activePane)
  const currentPath = useStore((s) => activeTab(s.activePane, s).path)
  const slots = useMemo(() => barSlots(favorites, extraGroups), [favorites, extraGroups])
  const [openGroup, setOpenGroup] = useState<{ name: string; x: number; y: number } | null>(null)
  const [drop, setDrop] = useState<DropAt | null>(null)
  const spring = useRef<{ name: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  const cancelSpring = (): void => {
    if (spring.current) clearTimeout(spring.current.timer)
    spring.current = null
  }

  const openGroupAt = (name: string, el: HTMLElement): void => {
    const r = el.getBoundingClientRect()
    setOpenGroup({ name, x: r.left, y: r.bottom + 2 })
  }

  // A group that no longer exists closes its list.
  useEffect(() => {
    if (openGroup && !slots.some((s) => s.kind === 'group' && s.name === openGroup.name)) setOpenGroup(null)
  }, [slots, openGroup])

  useEffect(() => {
    const clear = (): void => {
      setDrop(null)
      cancelSpring()
      dragging = null
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [])

  /** Where a drop at `at` puts favorites. */
  const targetOf = (at: DropAt): FavoriteTarget => {
    if ('end' in at) return {}
    const slot = slots[at.slot]
    if (at.edge === 'into' && slot.kind === 'group') return { group: slot.name }
    if (at.edge === 'before') return { beforeIndex: slotIndex(slot) }
    for (let k = at.slot + 1; k < slots.length; k++) {
      const i = slotIndex(slots[k])
      if (i !== null) return { beforeIndex: i }
    }
    return { beforeIndex: null }
  }

  const onSlotDragOver = (e: React.DragEvent, k: number, slot: BarSlot): void => {
    if (!accepts(e)) return
    e.preventDefault()
    e.stopPropagation()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = (e.clientX - r.left) / Math.max(1, r.width)
    const draggingGroup = !!dragging && 'group' in dragging
    let edge: 'before' | 'after' | 'into'
    if (slot.kind === 'group' && !draggingGroup) edge = x < 0.25 ? 'before' : x > 0.75 ? 'after' : 'into'
    else edge = x < 0.5 ? 'before' : 'after'
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(FAV_TYPE) ? 'move' : 'copy'
    if (!drop || 'end' in drop || drop.slot !== k || drop.edge !== edge) setDrop({ slot: k, edge })
    // Holding a drag on a group opens it, to drop at an exact place in its list.
    if (slot.kind === 'group' && edge === 'into') {
      if (openGroup?.name !== slot.name && spring.current?.name !== slot.name) {
        cancelSpring()
        const el = e.currentTarget as HTMLElement
        spring.current = { name: slot.name, timer: setTimeout(() => openGroupAt(slot.name, el), SPRING_MS) }
      }
    } else cancelSpring()
  }

  const onSlotDrop = (e: React.DragEvent, k: number): void => {
    const at = drop && !('end' in drop) && drop.slot === k ? drop : { slot: k, edge: 'after' as const }
    cancelSpring()
    setDrop(null)
    dropOn(e, targetOf(at))
  }

  const dropClass = (k: number): string => (drop && !('end' in drop) && drop.slot === k ? ` drop-${drop.edge}` : '')

  return (
    <div
      ref={barRef}
      className={`favbar${drop && 'end' in drop ? ' drop-end' : ''}`}
      data-testid="favorites-bar"
      role="toolbar"
      aria-label="Favorites bar"
      onContextMenu={(e) => openMenu(e, barMenu(), 'favbar-menu')}
      onWheel={(e) => {
        if (barRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) barRef.current.scrollLeft += e.deltaY
      }}
      onDragOver={(e) => {
        if (!accepts(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = e.dataTransfer.types.includes(FAV_TYPE) ? 'move' : 'copy'
        cancelSpring()
        if (!drop || !('end' in drop)) setDrop({ end: true })
      }}
      onDragLeave={(e) => {
        if (!barRef.current?.contains(e.relatedTarget as Node | null)) {
          setDrop(null)
          cancelSpring()
        }
      }}
      onDrop={(e) => {
        setDrop(null)
        cancelSpring()
        dropOn(e, {})
      }}
    >
      {slots.length === 0 && (
        <span className="fb-hint" data-testid="favbar-hint">
          <Star size={13} /> Drag folders and files here to add them to your favorites
        </span>
      )}
      {slots.map((slot, k) =>
        slot.kind === 'item' ? (
          <FavButton
            key={`i-${slot.index}-${slot.fav.path}`}
            fav={slot.fav}
            current={!slot.fav.file && samePath(slot.fav.path, currentPath)}
            className={dropClass(k)}
            onDragStart={(e) => startDrag(e, { indices: [slot.index] })}
            onDragOver={(e) => onSlotDragOver(e, k, slot)}
            onDrop={(e) => onSlotDrop(e, k)}
            onOpen={(how) => void A.openFavorite(pane, slot.fav, how)}
            onMenu={(e) => (slot.fav.file ? openFavoriteFileMenu(e, pane, slot.fav) : openFolderMenu(e, pane, slot.fav.path, slot.fav))}
          />
        ) : (
          <button
            key={`g-${slot.name}`}
            className={`fb-item fb-group${openGroup?.name === slot.name ? ' open' : ''}${dropClass(k)}`}
            data-testid="favbar-group"
            data-help-title={`${slot.name} (group)`}
            data-help-desc={`${slot.items.length} favorite${slot.items.length === 1 ? '' : 's'}. Click to show them; drop files or folders on it to add them here.`}
            data-help-place="below"
            draggable
            onClick={(e) => (openGroup?.name === slot.name ? setOpenGroup(null) : openGroupAt(slot.name, e.currentTarget))}
            onMouseEnter={(e) => {
              if (openGroup && openGroup.name !== slot.name) openGroupAt(slot.name, e.currentTarget)
            }}
            onContextMenu={(e) => {
              const el = e.currentTarget
              openMenu(e, groupMenu(slot.name, () => openGroupAt(slot.name, el)), 'favbar-group-menu')
            }}
            onDragStart={(e) => {
              setOpenGroup(null)
              startDrag(e, { group: slot.name })
            }}
            onDragOver={(e) => onSlotDragOver(e, k, slot)}
            onDrop={(e) => onSlotDrop(e, k)}
          >
            <Folder size={14} className="fb-group-icon" style={groupColors[slot.name] ? { color: groupColors[slot.name] } : undefined} />
            <span className="fb-label">{slot.name}</span>
            <ChevronDown size={12} className="fb-chevron" />
          </button>
        )
      )}
      <div className="fb-spacer" />
      <button
        className="fb-add"
        data-testid="favbar-new-group"
        data-help-title="New group"
        data-help-desc="Add a folder to the favorites bar, to keep favorites together"
        data-help-place="below"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void A.createFavoriteGroup()}
      >
        <FolderPlus size={15} strokeWidth={1.75} />
      </button>
      {openGroup &&
        (() => {
          const slot = slots.find((s): s is Extract<BarSlot, { kind: 'group' }> => s.kind === 'group' && s.name === openGroup.name)
          return slot ? <GroupDropdown key={slot.name} slot={slot} x={openGroup.x} y={openGroup.y} pane={pane} currentPath={currentPath} onClose={() => setOpenGroup(null)} /> : null
        })()}
    </div>
  )
}

function FavButton({
  fav,
  current,
  className,
  onDragStart,
  onDragOver,
  onDrop,
  onOpen,
  onMenu
}: {
  fav: Favorite
  current: boolean
  className: string
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onOpen: (how: 'here' | 'tab') => void
  onMenu: (e: React.MouseEvent) => void
}) {
  const look = useStore((s) => (fav.file ? undefined : s.folderStyles[fav.path]))
  return (
    <button
      className={`fb-item${current ? ' current' : ''}${fav.file ? ' file' : ''}${look?.bg ? ' tinted' : ''}${className}`}
      style={look?.bg ? ({ '--tint': look.bg } as React.CSSProperties) : undefined}
      data-testid="favbar-item"
      data-path={fav.path}
      data-help-title={favName(fav)}
      data-help-desc={favHelp(fav)}
      data-help-place="below"
      draggable
      onMouseDown={(e) => {
        // Middle-click opens a new tab instead of starting autoscroll.
        if (e.button === 1) e.preventDefault()
      }}
      onClick={() => onOpen('here')}
      onAuxClick={(e) => {
        if (e.button === 1 && !fav.file) onOpen('tab')
      }}
      onContextMenu={onMenu}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <FileIcon path={fav.path} isDir={!fav.file} size={15} />
      <span className="fb-label">{favName(fav)}</span>
    </button>
  )
}

/** The list of a group, opened under its folder on the bar. */
function GroupDropdown({ slot, x, y, pane, currentPath, onClose }: { slot: Extract<BarSlot, { kind: 'group' }>; x: number; y: number; pane: 0 | 1; currentPath: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const color = useStore((s) => s.favoriteGroupColors[slot.name])
  const [left, setLeft] = useState(x)
  const [drop, setDrop] = useState<{ index: number; edge: 'before' | 'after' } | 'end' | null>(null)

  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 0
    setLeft(Math.max(4, Math.min(x, window.innerWidth - w - 4)))
  }, [x, slot.items.length])

  // Clicks outside (except on the bar's groups, which switch lists) and Escape close it.
  useEffect(() => {
    const down = (e: MouseEvent): void => {
      const t = e.target as HTMLElement
      if (ref.current?.contains(t) || t.closest?.('.fb-group') || t.closest?.('.context-menu')) return
      onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !getState().contextMenu) onClose()
    }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  const targetOf = (at: typeof drop): FavoriteTarget => {
    if (!at || at === 'end') return { group: slot.name }
    if (at.edge === 'before') return { group: slot.name, beforeIndex: at.index }
    const pos = slot.items.findIndex((it) => it.index === at.index)
    const next = slot.items[pos + 1]
    return { group: slot.name, beforeIndex: next ? next.index : null }
  }

  const over = (e: React.DragEvent, it: IndexedFavorite | null): void => {
    if (!accepts(e) || (dragging && 'group' in dragging)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(FAV_TYPE) ? 'move' : 'copy'
    if (!it) {
      if (drop !== 'end') setDrop('end')
      return
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const edge = e.clientY - r.top < r.height / 2 ? 'before' : 'after'
    if (!drop || drop === 'end' || drop.index !== it.index || drop.edge !== edge) setDrop({ index: it.index, edge })
  }

  const dropHere = (e: React.DragEvent): void => {
    const at = drop
    setDrop(null)
    if (dragging && 'group' in dragging) return
    dropOn(e, targetOf(at))
  }

  return (
    <div
      ref={ref}
      className={`fb-dropdown${drop === 'end' ? ' drop-end' : ''}`}
      data-testid="favbar-dropdown"
      style={{ left, top: y }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onDragOver={(e) => over(e, null)}
      onDragLeave={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node | null)) setDrop(null)
      }}
      onDrop={dropHere}
    >
      <div className="fb-dd-title">
        <Folder size={12} style={color ? { color } : undefined} /> {slot.name}
      </div>
      {slot.items.length === 0 && (
        <div className="fb-dd-empty" data-testid="favbar-dropdown-empty">
          <FolderInput size={13} /> Drop files and folders here
        </div>
      )}
      {slot.items.map((it) => {
        const f = it.fav
        const mark = drop && drop !== 'end' && drop.index === it.index ? ` drop-${drop.edge}` : ''
        return (
          <div
            key={`${it.index}-${f.path}`}
            className={`fb-dd-item${!f.file && samePath(f.path, currentPath) ? ' current' : ''}${mark}`}
            data-testid="favbar-dropdown-item"
            data-path={f.path}
            data-help-title={favName(f)}
            data-help-desc={favHelp(f)}
            draggable
            onClick={() => {
              onClose()
              void A.openFavorite(pane, f)
            }}
            onAuxClick={(e) => {
              if (e.button === 1 && !f.file) {
                onClose()
                void A.openFavorite(pane, f, 'tab')
              }
            }}
            onContextMenu={(e) => (f.file ? openFavoriteFileMenu(e, pane, f) : openFolderMenu(e, pane, f.path, f))}
            onDragStart={(e) => startDrag(e, { indices: [it.index] })}
            onDragOver={(e) => over(e, it)}
            onDrop={dropHere}
          >
            <FileIcon path={f.path} isDir={!f.file} size={15} />
            <span className="fb-label">{favName(f)}</span>
            {f.shortcut && <span className="sb-key">{f.shortcut}</span>}
          </div>
        )
      })}
    </div>
  )
}
