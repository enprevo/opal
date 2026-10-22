import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, ChevronDown, Star, X, HardDrive, Home, Folder, Monitor, FileText, Download, ImageIcon, Clock } from 'lucide-react'
import { activeTab, getState, openDialog, useStore } from '../state/store'
import * as A from '../state/actions'
import type { Favorite, FileEntry, RootInfo } from '@shared/types'
import { basename, dirname, isAncestor, samePath } from '@shared/paths'
import { readDragPaths, focusList } from './FileDisplay'
import { keyFor } from '../state/commands'

interface NodeData {
  children: FileEntry[] | null
  loading: boolean
}

const nodeStore = new Map<string, NodeData>()
const TREE_ROW = 22
const key = (p: string): string => (/^[a-zA-Z]:/.test(p) || p.startsWith('\\\\') ? p.toLowerCase() : p)

function placeIcon(r: RootInfo) {
  if (r.kind === 'home') return <Home size={14} />
  if (r.kind === 'drive' || r.kind === 'root' || r.kind === 'volume') return <HardDrive size={14} />
  if (r.label === 'Desktop') return <Monitor size={14} />
  if (r.label === 'Documents') return <FileText size={14} />
  if (r.label === 'Downloads') return <Download size={14} />
  if (r.label === 'Pictures') return <ImageIcon size={14} />
  return <Folder size={14} />
}

export function Sidebar() {
  const roots = useStore((s) => s.roots)
  const recent = useStore((s) => s.recent)
  useStore((s) => s.hotkeys)
  const pane = useStore((s) => s.activePane)
  const currentPath = useStore((s) => activeTab(s.activePane, s).path)
  const [showRecent, setShowRecent] = useState(false)
  const places = roots.filter((r) => r.kind === 'home' || r.kind === 'special')
  const treeRoots = roots.filter((r) => r.kind === 'drive' || r.kind === 'root' || r.kind === 'volume')

  return (
    <div className="sidebar">
      <FavoritesSection pane={pane} currentPath={currentPath} />
      <div className="sb-section">
        <div className="sb-title">Places</div>
        {places.map((r) => (
          <div key={r.path} className={`sb-item${samePath(r.path, currentPath) ? ' current' : ''}`} title={r.path} onClick={() => void A.navigate(pane, r.path)}>
            {placeIcon(r)}
            <span className="sb-label">{r.label}</span>
          </div>
        ))}
        <div className="sb-item" onClick={() => setShowRecent((v) => !v)}>
          <Clock size={14} />
          <span className="sb-label">Recent</span>
          {showRecent ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>
        {showRecent &&
          recent.slice(0, 15).map((r) => (
            <div key={r} className="sb-item sb-indent" title={r} onClick={() => void A.navigate(pane, r)}>
              <span className="sb-label">{r}</span>
            </div>
          ))}
      </div>
      <LabelsSection />
      <div className="sb-section sb-tree-section">
        <div className="sb-title">Folders</div>
        <FolderTree roots={treeRoots} currentPath={currentPath} />
      </div>
    </div>
  )
}

function FavoriteRow({ fav, pane, currentPath, indent, onMenu }: { fav: Favorite; pane: 0 | 1; currentPath: string; indent: boolean; onMenu: (e: React.MouseEvent, f: Favorite) => void }) {
  const name = fav.label || basename(fav.path) || fav.path
  return (
    <div
      className={`sb-item${indent ? ' sb-nested' : ''}${samePath(fav.path, currentPath) ? ' current' : ''}`}
      title={fav.path}
      data-testid="favorite-item"
      onClick={() => void A.navigate(pane, fav.path)}
      onContextMenu={(e) => onMenu(e, fav)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const paths = readDragPaths(e.dataTransfer)
        if (paths.length) void A.dropPaths(paths, fav.path, { ctrl: e.ctrlKey, shift: e.shiftKey })
      }}
    >
      <Star size={13} className="fav-star" />
      <span className="sb-label">{name}</span>
      <button
        className="sb-remove"
        title="Remove favorite"
        onClick={(e) => {
          e.stopPropagation()
          A.removeFavorite(fav)
        }}
      >
        <X size={11} />
      </button>
    </div>
  )
}

/** Favorites: ungrouped first, then collapsible groups (right-click a favorite to rename or regroup it). */
function FavoritesSection({ pane, currentPath }: { pane: 0 | 1; currentPath: string }) {
  const favorites = useStore((s) => s.favorites)
  const collapsed = useStore((s) => s.prefs.favoritesCollapsed)
  const [menu, setMenu] = useState<{ x: number; y: number; fav: Favorite } | null>(null)
  const groups = useMemo(() => {
    const map = new Map<string, Favorite[]>()
    for (const f of favorites) {
      const g = f.group ?? ''
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(f)
    }
    return map
  }, [favorites])
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])
  const onMenu = (e: React.MouseEvent, fav: Favorite): void => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, fav })
  }
  const act = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenu(null)
    fn()
  }
  return (
    <div className="sb-section" data-testid="favorites-section">
      <div className="sb-title">Favorites</div>
      {favorites.length === 0 && <div className="sb-empty">{keyFor('Favorites ADD') || 'The star button'} adds the current folder</div>}
      {(groups.get('') ?? []).map((f, i) => (
        <FavoriteRow key={`${f.path}-${i}`} fav={f} pane={pane} currentPath={currentPath} indent={false} onMenu={onMenu} />
      ))}
      {[...groups.entries()]
        .filter(([g]) => g)
        .map(([g, list]) => {
          const closed = collapsed.includes(g)
          return (
            <div key={g} data-testid="favorite-group">
              <div className="sb-item sb-group" title={g} onClick={() => A.toggleFavoriteGroup(g)}>
                {closed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <Folder size={13} />
                <span className="sb-label">{g}</span>
                <span className="sb-count">{list.length}</span>
              </div>
              {!closed && list.map((f, i) => <FavoriteRow key={`${f.path}-${i}`} fav={f} pane={pane} currentPath={currentPath} indent onMenu={onMenu} />)}
            </div>
          )
        })}
      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y, position: 'fixed' }} data-testid="favorite-menu" onMouseDown={(e) => e.stopPropagation()}>
          <div className="cm-item" onClick={act(() => void A.navigate(pane === 0 ? 1 : 0, menu.fav.path))}>
            <span className="cm-label">Open in the other pane</span>
          </div>
          <div className="cm-item" data-testid="favorite-rename" onClick={act(() => void A.renameFavorite(menu.fav))}>
            <span className="cm-label">Rename…</span>
          </div>
          <div className="cm-item" onClick={act(() => void A.moveFavoriteToGroup(menu.fav))}>
            <span className="cm-label">Move to group…</span>
          </div>
          <div className="cm-sep" />
          <div className="cm-item danger" onClick={act(() => A.removeFavorite(menu.fav))}>
            <span className="cm-label">Remove from favorites</span>
          </div>
        </div>
      )}
    </div>
  )
}

function LabelsSection() {
  const labels = useStore((s) => s.labels)
  const defs = useStore((s) => s.labelDefs)
  const counts = new Map<string, number>()
  for (const ids of Object.values(labels)) for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  const used = defs.filter((d) => counts.get(d.id))
  return (
    <div className="sb-section" data-testid="labels-section">
      <div className="sb-title">Labels</div>
      {used.length === 0 && <div className="sb-empty">Right-click → Label, or drop files here</div>}
      {(used.length ? used : defs.slice(0, 4)).map((d) => (
        <div
          key={d.id}
          className="sb-item"
          data-help-title={`${d.name} label`}
          data-help-desc="Click to list every item with this label. Drop files here to add the label."
          onClick={() => void openDialog('tagged', { label: d.id })}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const paths = readDragPaths(e.dataTransfer)
            if (paths.length) A.toggleLabel(paths, d.id)
          }}
        >
          <span className="cm-color" style={{ background: d.color }} />
          <span className="sb-label">{d.name}</span>
          {counts.get(d.id) ? <span className="sb-count">{counts.get(d.id)}</span> : null}
        </div>
      ))}
    </div>
  )
}

interface FlatNode {
  path: string
  name: string
  depth: number
  isRoot: boolean
  label: string
}

function FolderTree({ roots, currentPath }: { roots: RootInfo[]; currentPath: string }) {
  const showHidden = useStore((s) => s.prefs.showHidden)
  const listing = useStore((s) => activeTab(s.activePane, s).listing)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [version, force] = useState(0)
  const [cursor, setCursor] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(
    async (p: string): Promise<FileEntry[]> => {
      const k = key(p)
      const existing = nodeStore.get(k)
      if (existing?.children) return existing.children
      nodeStore.set(k, { children: null, loading: true })
      force((n) => n + 1)
      try {
        const children = await window.opal.subdirs(p, showHidden)
        nodeStore.set(k, { children, loading: false })
        return children
      } catch {
        nodeStore.set(k, { children: [], loading: false })
        return []
      } finally {
        force((n) => n + 1)
      }
    },
    [showHidden]
  )

  // Hidden-files toggle invalidates cached children.
  useEffect(() => {
    nodeStore.clear()
    for (const p of expanded) void load(p)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden])

  // Keep the tree in sync with fresh listings of the active folder.
  useEffect(() => {
    if (!listing) return
    const k = key(listing.path)
    if (nodeStore.has(k)) {
      const children = listing.entries.filter((e) => e.isDir && (showHidden || !e.hidden))
      nodeStore.set(k, { children, loading: false })
      force((n) => n + 1)
    }
  }, [listing, showHidden])

  // Reveal the current folder: expand all of its ancestors.
  useEffect(() => {
    if (!currentPath) return
    const root = roots.find((r) => samePath(r.path, currentPath) || isAncestor(r.path, currentPath))
    if (!root) return
    const chain: string[] = []
    let cur: string | null = dirname(currentPath)
    while (cur && (samePath(cur, root.path) || isAncestor(root.path, cur))) {
      chain.unshift(cur)
      if (samePath(cur, root.path)) break
      cur = dirname(cur)
    }
    let cancelled = false
    void (async () => {
      for (let i = 0; i < chain.length; i++) {
        const p = chain[i]
        if (cancelled) return
        const kids = await load(p)
        // Always show the path to the current folder, even through hidden ancestors (e.g. AppData).
        const next = chain[i + 1] ?? currentPath
        if (!kids.some((k) => samePath(k.path, next))) {
          const synthetic: FileEntry = { name: basename(next), path: next, isDir: true, isSymlink: false, size: 0, mtime: 0, ctime: 0, atime: 0, ext: '', hidden: true, readonly: false, mode: 0 }
          const merged = [...kids, synthetic].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
          nodeStore.set(key(p), { children: merged, loading: false })
        }
        if (cancelled) return
        setExpanded((prev) => (prev.has(key(p)) ? prev : new Set(prev).add(key(p))))
      }
      if (cancelled) return
      if (!focused) setCursor(currentPath)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, roots])

  const flat = useMemo(() => {
    const out: FlatNode[] = []
    const walk = (p: string, name: string, depth: number, isRoot: boolean, label: string): void => {
      out.push({ path: p, name, depth, isRoot, label })
      if (!expanded.has(key(p))) return
      const children = nodeStore.get(key(p))?.children ?? []
      for (const c of children) walk(c.path, c.name, depth + 1, false, c.name)
    }
    for (const r of roots) walk(r.path, r.label, 0, true, r.label)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots, expanded, version])

  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(400)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewH(el.clientHeight))
    ro.observe(el)
    setViewH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  // Keep the cursor row visible (rows are virtualised, so scroll by index).
  useEffect(() => {
    const el = containerRef.current
    if (!cursor || !el) return
    const idx = flat.findIndex((n) => samePath(n.path, cursor))
    if (idx < 0) return
    const top = idx * TREE_ROW
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + TREE_ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + TREE_ROW - el.clientHeight + TREE_ROW
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, flat.length])

  const toggle = async (p: string, open?: boolean): Promise<void> => {
    const k = key(p)
    const isOpen = expanded.has(k)
    const want = open ?? !isOpen
    if (want === isOpen) return
    if (want) await load(p)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (want) next.add(k)
      else next.delete(k)
      return next
    })
  }

  const go = (p: string, delay = 0): void => {
    if (navTimer.current) clearTimeout(navTimer.current)
    if (delay === 0) void A.navigate(getState().activePane, p)
    else navTimer.current = setTimeout(() => void A.navigate(getState().activePane, p), delay)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const idx = flat.findIndex((n) => cursor && samePath(n.path, cursor))
    const cur = flat[idx]
    const moveTo = (i: number): void => {
      const n = flat[Math.max(0, Math.min(flat.length - 1, i))]
      if (!n) return
      setCursor(n.path)
      go(n.path, 250)
    }
    switch (e.key) {
      case 'ArrowDown':
        moveTo(idx < 0 ? 0 : idx + 1)
        break
      case 'ArrowUp':
        moveTo(idx < 0 ? 0 : idx - 1)
        break
      case 'Home':
        moveTo(0)
        break
      case 'End':
        moveTo(flat.length - 1)
        break
      case 'PageDown':
        moveTo(idx + 15)
        break
      case 'PageUp':
        moveTo(idx - 15)
        break
      case 'ArrowRight': {
        if (!cur) break
        const k = key(cur.path)
        const kids = nodeStore.get(k)?.children
        if (!expanded.has(k)) void toggle(cur.path, true)
        else if (kids && kids.length) moveTo(idx + 1)
        break
      }
      case 'ArrowLeft': {
        if (!cur) break
        if (expanded.has(key(cur.path)) && (nodeStore.get(key(cur.path))?.children?.length ?? 0) > 0) void toggle(cur.path, false)
        else if (expanded.has(key(cur.path))) void toggle(cur.path, false)
        else {
          for (let i = idx - 1; i >= 0; i--) {
            if (flat[i].depth < cur.depth) {
              moveTo(i)
              break
            }
          }
        }
        break
      }
      case 'Enter':
      case ' ':
        if (cur) {
          go(cur.path)
          if (e.key === 'Enter') focusList(getState().activePane)
        }
        break
      case 'Tab':
        focusList(getState().activePane)
        break
      case '*':
        if (cur) void expandAll(cur.path)
        break
      case '+':
      case '=': {
        // "+": expand; pressed again, expand the second level too.
        if (!cur) break
        if (!expanded.has(key(cur.path))) void toggle(cur.path, true)
        else void expandChildren(cur.path, true)
        break
      }
      case '-': {
        // "-": collapse children first; pressed again, collapse the branch.
        if (!cur) break
        const kids = (nodeStore.get(key(cur.path))?.children ?? []).filter((c) => expanded.has(key(c.path)))
        if (kids.length) void expandChildren(cur.path, false)
        else void toggle(cur.path, false)
        break
      }
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  const expandChildren = async (p: string, open: boolean): Promise<void> => {
    const kids = await load(p)
    if (open) for (const c of kids) await load(c.path)
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const c of kids) {
        if (open) next.add(key(c.path))
        else next.delete(key(c.path))
      }
      return next
    })
  }

  /** Expands every branch below `p` (breadth-first, capped to keep huge trees responsive). */
  const expandAll = async (p: string): Promise<void> => {
    const keys: string[] = []
    const queue = [p]
    while (queue.length && keys.length < 2000) {
      const cur = queue.shift()!
      keys.push(key(cur))
      for (const c of await load(cur)) if (!c.isSymlink) queue.push(c.path)
    }
    setExpanded((prev) => new Set([...prev, ...keys]))
  }

  const first = Math.max(0, Math.floor(scrollTop / TREE_ROW) - 5)
  const last = Math.min(flat.length, Math.ceil((scrollTop + viewH) / TREE_ROW) + 5)

  return (
    <div
      ref={containerRef}
      className={`folder-tree${focused ? ' focused' : ''}`}
      tabIndex={0}
      data-testid="folder-tree"
      onKeyDown={onKeyDown}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      onFocus={() => {
        setFocused(true)
        if (!cursor) setCursor(currentPath)
      }}
      onBlur={() => setFocused(false)}
    >
      <div style={{ height: flat.length * TREE_ROW, position: 'relative' }}>
      {flat.slice(first, last).map((n, j) => {
        const k = key(n.path)
        const data = nodeStore.get(k)
        const isOpen = expanded.has(k)
        const leaf = data?.children !== null && data?.children !== undefined && data.children.length === 0
        const isCurrent = samePath(n.path, currentPath)
        const isCursor = cursor !== null && samePath(n.path, cursor)
        return (
          <div
            key={k}
            data-tree-path={n.path}
            className={`tree-node${isCurrent ? ' current' : ''}${isCursor && focused ? ' cursor' : ''}`}
            style={{ paddingLeft: 2 + n.depth * 16, position: 'absolute', top: (first + j) * TREE_ROW, left: 0, right: 0 }}
            onMouseDown={(e) => {
              if (e.button !== 0) return
              setCursor(n.path)
            }}
            onClick={() => go(n.path)}
            onDoubleClick={() => void toggle(n.path)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const paths = readDragPaths(e.dataTransfer)
              if (paths.length) void A.dropPaths(paths, n.path, { ctrl: e.ctrlKey, shift: e.shiftKey })
            }}
          >
            <span
              className={`twisty${leaf ? ' leaf' : ''}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                void toggle(n.path)
              }}
            >
              {data?.loading ? <span className="spinner small" /> : leaf ? null : isOpen ? <ChevronDown size={16} strokeWidth={2.4} /> : <ChevronRight size={16} strokeWidth={2.4} />}
            </span>
            {n.isRoot ? <HardDrive size={13} className="tree-icon" /> : <Folder size={13} className="tree-icon folder" />}
            <span className="tree-label">{n.label}</span>
          </div>
        )
      })}
      </div>
    </div>
  )
}
