/**
 * Favorites: a tree of folders/files, groups (with nested groups) and separators, each with optional
 * colours, icon and shortcut key. Pure functions only: used by the settings loader, the sidebar and the
 * favorites manager, and unit tested.
 */

export interface FavoriteStyle {
  /** Text colour (CSS colour). */
  color?: string
  /** Background colour of the row. */
  background?: string
  /** "lucide:<IconName>" or "emoji:<text>". */
  icon?: string
}

export type FavoriteOpenIn = 'source' | 'dest' | 'newtab'

export interface FavoriteItem extends FavoriteStyle {
  type: 'item'
  id: string
  /** Folder (opened in the file display) or file (opened with its application). */
  path: string
  label?: string
  /** Shortcut, e.g. "P" or "Shift+T" (same format as hotkeys). */
  key?: string
  openIn?: FavoriteOpenIn
}

export interface FavoriteGroup extends FavoriteStyle {
  type: 'group'
  id: string
  label: string
  children: FavoriteNode[]
  collapsed?: boolean
}

export interface FavoriteSeparator {
  type: 'separator'
  id: string
}

export type FavoriteNode = FavoriteItem | FavoriteGroup | FavoriteSeparator

export type DropPosition = 'before' | 'after' | 'inside'

let seq = 0
export function newFavoriteId(): string {
  return `f${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i
const ICON = /^(lucide:[A-Za-z0-9]+|emoji:.{1,16})$/u

function style(o: Obj): FavoriteStyle {
  const s: FavoriteStyle = {}
  const color = str(o.color)
  const background = str(o.background)
  const icon = str(o.icon)
  if (color && COLOR.test(color)) s.color = color
  if (background && COLOR.test(background)) s.background = background
  if (icon && ICON.test(icon)) s.icon = icon
  return s
}

/**
 * Accepts the current tree, and the older shapes: a list of paths, or of { path, label, group } where nested
 * groups were written "Parent / Child". Groups named in `collapsedGroups` start collapsed.
 */
export function normalizeFavorites(raw: unknown, collapsedGroups: string[] = []): FavoriteNode[] {
  if (!Array.isArray(raw)) return []
  const ids = new Set<string>()
  const id = (v: unknown): string => {
    let i = typeof v === 'string' && v && !ids.has(v) ? v : newFavoriteId()
    while (ids.has(i)) i = newFavoriteId()
    ids.add(i)
    return i
  }
  const collapsed = new Set(collapsedGroups)

  const node = (v: unknown, depth: number): FavoriteNode | null => {
    if (typeof v === 'string') return v.trim() ? { type: 'item', id: id(null), path: v.trim() } : null
    if (!isObj(v)) return null
    if (v.type === 'separator') return { type: 'separator', id: id(v.id) }
    if (v.type === 'group') {
      const label = str(v.label)
      if (!label || depth > 8) return null
      const children = Array.isArray(v.children) ? v.children.map((c) => node(c, depth + 1)).filter((c): c is FavoriteNode => !!c) : []
      return { type: 'group', id: id(v.id), label, children, ...(v.collapsed === true ? { collapsed: true } : {}), ...style(v) }
    }
    const p = str(v.path)
    if (!p) return null
    const item: FavoriteItem = { type: 'item', id: id(v.id), path: p, ...style(v) }
    const label = str(v.label)
    const key = str(v.key)
    if (label) item.label = label
    if (key) item.key = key
    if (v.openIn === 'dest' || v.openIn === 'newtab') item.openIn = v.openIn
    return item
  }

  const out: FavoriteNode[] = []
  const groupPath = new Map<string, FavoriteGroup>()
  const groupFor = (path: string): FavoriteGroup => {
    const existing = groupPath.get(path)
    if (existing) return existing
    const parts = path.split(' / ')
    const label = parts.pop()!
    const parent = parts.length ? groupFor(parts.join(' / ')) : null
    const g: FavoriteGroup = { type: 'group', id: id(null), label, children: [], ...(collapsed.has(path) || collapsed.has(label) ? { collapsed: true } : {}) }
    ;(parent ? parent.children : out).push(g)
    groupPath.set(path, g)
    return g
  }
  const seen = new Set<string>()
  for (const v of raw) {
    // Old flat shape: { path, label, group: "A / B" }.
    const legacyGroup = isObj(v) && v.type === undefined && typeof v.group === 'string' && v.group.trim() ? v.group.trim() : null
    const n = node(v, 0)
    if (!n) continue
    if (n.type === 'item') {
      const dup = `${legacyGroup ?? ''}\u0000${n.path.toLowerCase()}`
      if (v === null || typeof v === 'string' || (isObj(v) && v.type === undefined)) {
        if (seen.has(dup)) continue
        seen.add(dup)
      }
    }
    if (legacyGroup) groupFor(legacyGroup).children.push(n)
    else out.push(n)
  }
  return out
}

// ------------------------------------------------------------------ queries

export function* walkFavorites(nodes: FavoriteNode[], parents: FavoriteGroup[] = []): Generator<{ node: FavoriteNode; parents: FavoriteGroup[] }> {
  for (const n of nodes) {
    yield { node: n, parents }
    if (n.type === 'group') yield* walkFavorites(n.children, [...parents, n])
  }
}

export function findFavorite(nodes: FavoriteNode[], id: string): FavoriteNode | null {
  for (const { node } of walkFavorites(nodes)) if (node.id === id) return node
  return null
}

export function favoriteItems(nodes: FavoriteNode[]): FavoriteItem[] {
  const out: FavoriteItem[] = []
  for (const { node } of walkFavorites(nodes)) if (node.type === 'item') out.push(node)
  return out
}

/** The favorite assigned to a key combination (e.g. "P", "Shift+T"), if any. */
export function favoriteForKey(nodes: FavoriteNode[], combo: string): FavoriteItem | null {
  const want = combo.toLowerCase()
  for (const it of favoriteItems(nodes)) if (it.key && it.key.toLowerCase() === want) return it
  return null
}

export function favoriteLabel(n: FavoriteItem | FavoriteGroup): string {
  if (n.type === 'group') return n.label
  if (n.label) return n.label
  const parts = n.path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? n.path
}

// ------------------------------------------------------------------ edits (immutable)

function mapTree(nodes: FavoriteNode[], fn: (n: FavoriteNode) => FavoriteNode | null): FavoriteNode[] {
  const out: FavoriteNode[] = []
  for (const n of nodes) {
    const m = fn(n)
    if (!m) continue
    out.push(m.type === 'group' ? { ...m, children: mapTree(m.children, fn) } : m)
  }
  return out
}

export function updateFavorite(nodes: FavoriteNode[], id: string, patch: Partial<FavoriteItem> | Partial<FavoriteGroup>): FavoriteNode[] {
  return mapTree(nodes, (n) => {
    if (n.id !== id) return n
    const next = { ...n, ...patch } as FavoriteNode & Record<string, unknown>
    // `undefined` in a patch removes the property (e.g. clearing a colour).
    for (const [k, v] of Object.entries(patch)) if (v === undefined || v === '') delete next[k]
    return next
  })
}

/** Replaces a node by an edited copy (a group keeps its current children). */
export function replaceFavorite(nodes: FavoriteNode[], id: string, next: FavoriteItem | FavoriteGroup): FavoriteNode[] {
  return mapTree(nodes, (n) => (n.id !== id ? n : n.type === 'group' && next.type === 'group' ? { ...next, children: n.children } : next))
}

export function removeFavorite(nodes: FavoriteNode[], id: string): FavoriteNode[] {
  return mapTree(nodes, (n) => (n.id === id ? null : n))
}

function isDescendant(group: FavoriteNode, id: string): boolean {
  if (group.type !== 'group') return false
  for (const { node } of walkFavorites(group.children)) if (node.id === id) return true
  return false
}

/** Inserts `node` before/after `targetId`, or inside it (at the end) when it is a group; null target = end of the root. */
export function insertFavorite(nodes: FavoriteNode[], node: FavoriteNode, targetId: string | null, position: DropPosition = 'after'): FavoriteNode[] {
  if (!targetId) return [...nodes, node]
  let done = false
  const place = (list: FavoriteNode[]): FavoriteNode[] => {
    const out: FavoriteNode[] = []
    for (const n of list) {
      if (n.id === targetId && !done) {
        if (position === 'inside' && n.type === 'group') {
          done = true
          out.push({ ...n, collapsed: false, children: [...n.children, node] })
          continue
        }
        done = true
        if (position === 'before') out.push(node, n)
        else out.push(n, node)
        continue
      }
      out.push(n.type === 'group' ? { ...n, children: place(n.children) } : n)
    }
    return out
  }
  const result = place(nodes)
  return done ? result : [...nodes, node]
}

/** Moves a node next to (or into) another one. A group can't be moved into itself or its descendants. */
export function moveFavorite(nodes: FavoriteNode[], id: string, targetId: string | null, position: DropPosition): FavoriteNode[] {
  if (id === targetId) return nodes
  const node = findFavorite(nodes, id)
  if (!node || (targetId && isDescendant(node, targetId))) return nodes
  return insertFavorite(removeFavorite(nodes, id), node, targetId, position)
}

/** Moves a node one step up or down among its siblings. */
export function shiftFavorite(nodes: FavoriteNode[], id: string, delta: -1 | 1): FavoriteNode[] {
  const shift = (list: FavoriteNode[]): FavoriteNode[] => {
    const i = list.findIndex((n) => n.id === id)
    if (i !== -1) {
      const j = i + delta
      if (j < 0 || j >= list.length) return list
      const copy = [...list]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    }
    return list.map((n) => (n.type === 'group' ? { ...n, children: shift(n.children) } : n))
  }
  return shift(nodes)
}

/** Sorts the children of a group (or the root) by name, keeping groups first and separators out. */
export function sortFavorites(nodes: FavoriteNode[], groupId: string | null): FavoriteNode[] {
  const sort = (list: FavoriteNode[]): FavoriteNode[] =>
    list
      .filter((n) => n.type !== 'separator')
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'group' ? -1 : 1
        return favoriteLabel(a as FavoriteItem).localeCompare(favoriteLabel(b as FavoriteItem), undefined, { numeric: true, sensitivity: 'base' })
      })
  if (!groupId) return sort(nodes)
  return mapTree(nodes, (n) => (n.id === groupId && n.type === 'group' ? { ...n, children: sort(n.children) } : n))
}

/** Removes a key from every favorite that uses it (keys are unique). */
export function releaseKey(nodes: FavoriteNode[], key: string, exceptId?: string): FavoriteNode[] {
  const want = key.toLowerCase()
  return mapTree(nodes, (n) => (n.type === 'item' && n.id !== exceptId && n.key?.toLowerCase() === want ? (({ key: _k, ...rest }) => rest)(n) : n))
}
