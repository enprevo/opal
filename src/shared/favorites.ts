/**
 * Layout of the favorites bar and the list operations behind its drag and drop. Pure functions over the favorites
 * list: the order of the list is the order on the bar, and a group shows as one folder button where its first
 * favorite is (groups the user created that are still empty come last).
 */
import type { Favorite } from './types'

export interface IndexedFavorite {
  fav: Favorite
  /** Position in the favorites list. */
  index: number
}

export type BarSlot = { kind: 'item'; fav: Favorite; index: number } | { kind: 'group'; name: string; items: IndexedFavorite[] }

/** Every group in bar order: groups that have favorites, then the empty ones the user created. */
export function groupsInOrder(favorites: Favorite[], extraGroups: string[] = []): string[] {
  const out: string[] = []
  for (const f of favorites) if (f.group && !out.includes(f.group)) out.push(f.group)
  for (const g of extraGroups) if (g && !out.includes(g)) out.push(g)
  return out
}

export function barSlots(favorites: Favorite[], extraGroups: string[] = []): BarSlot[] {
  const slots: BarSlot[] = []
  const groupSlot = new Map<string, Extract<BarSlot, { kind: 'group' }>>()
  favorites.forEach((fav, index) => {
    if (!fav.group) {
      slots.push({ kind: 'item', fav, index })
      return
    }
    let slot = groupSlot.get(fav.group)
    if (!slot) {
      slot = { kind: 'group', name: fav.group, items: [] }
      groupSlot.set(fav.group, slot)
      slots.push(slot)
    }
    slot.items.push({ fav, index })
  })
  for (const g of extraGroups) {
    if (!g || groupSlot.has(g)) continue
    const slot: BarSlot = { kind: 'group', name: g, items: [] }
    groupSlot.set(g, slot)
    slots.push(slot)
  }
  return slots
}

/** First favorite index of a slot (null for an empty group). */
export function slotIndex(slot: BarSlot | undefined): number | null {
  if (!slot) return null
  if (slot.kind === 'item') return slot.index
  return slot.items.length ? slot.items[0].index : null
}

/**
 * Where favorites go: into `group` (none = straight on the bar), placed before the favorite at `beforeIndex`. Without
 * `beforeIndex` they go at the end of the group, or at the end of the list.
 */
export interface FavoriteTarget {
  group?: string
  beforeIndex?: number | null
}

const sameKey = (a: Favorite, b: Favorite): boolean => (a.group ?? '') === (b.group ?? '') && a.path.toLowerCase() === b.path.toLowerCase()

function place(rest: Favorite[], moved: Favorite[], anchor: Favorite | null, group: string | undefined): Favorite[] {
  let at = anchor ? rest.indexOf(anchor) : -1
  if (at < 0) {
    if (group) {
      let last = -1
      rest.forEach((f, i) => {
        if (f.group === group) last = i
      })
      at = last >= 0 ? last + 1 : rest.length
    } else at = rest.length
  }
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)]
}

/** Moves the favorites at `indices` (in list order) to the target. A favorite already listed there is not doubled. */
export function moveFavorites(favorites: Favorite[], indices: number[], target: FavoriteTarget): Favorite[] {
  const picked = new Set(indices.filter((i) => i >= 0 && i < favorites.length))
  if (!picked.size) return favorites
  const anchorCandidate = target.beforeIndex != null ? favorites[target.beforeIndex] : undefined
  const anchor = anchorCandidate && !picked.has(target.beforeIndex!) ? anchorCandidate : null
  const rest = favorites.filter((_, i) => !picked.has(i))
  const moved: Favorite[] = []
  for (const i of [...picked].sort((a, b) => a - b)) {
    const next: Favorite = { ...favorites[i] }
    if (target.group) next.group = target.group
    else delete next.group
    if (rest.some((f) => sameKey(f, next)) || moved.some((f) => sameKey(f, next))) continue
    moved.push(next)
  }
  return place(rest, moved, anchor, target.group)
}

/** Adds new favorites at the target; returns the new list and how many were already there. */
export function insertFavorites(favorites: Favorite[], added: Favorite[], target: FavoriteTarget): { favorites: Favorite[]; skipped: number } {
  const anchor = target.beforeIndex != null ? (favorites[target.beforeIndex] ?? null) : null
  const fresh: Favorite[] = []
  let skipped = 0
  for (const a of added) {
    const next: Favorite = { ...a }
    if (target.group) next.group = target.group
    else delete next.group
    if (favorites.some((f) => sameKey(f, next)) || fresh.some((f) => sameKey(f, next))) {
      skipped++
      continue
    }
    fresh.push(next)
  }
  return { favorites: fresh.length ? place(favorites, fresh, anchor, target.group) : favorites, skipped }
}

/** Renames a group (its favorites follow). Merges into an existing group of the same name. */
export function renameGroup(favorites: Favorite[], from: string, to: string): Favorite[] {
  const out: Favorite[] = []
  for (const f of favorites) {
    const next = f.group === from ? { ...f, group: to || undefined } : f
    if (next.group === undefined) delete (next as Favorite).group
    if (out.some((o) => sameKey(o, next))) continue
    out.push(next)
  }
  return out
}
