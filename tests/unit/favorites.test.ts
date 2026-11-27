import { describe, expect, it } from 'vitest'
import { barSlots, groupsInOrder, insertFavorites, moveFavorites, renameGroup, slotIndex } from '../../src/shared/favorites'
import { normalizeFavorites, normalizeState } from '../../src/shared/settings'
import type { Favorite } from '../../src/shared/types'

const favs: Favorite[] = [{ path: '/a' }, { path: '/w1', group: 'Work' }, { path: '/b', file: true }, { path: '/w2', group: 'Work' }, { path: '/p', group: 'Photos' }]
const paths = (list: Favorite[]): string[] => list.map((f) => `${f.group ? f.group + ':' : ''}${f.path}`)

describe('favorites bar layout', () => {
  it('shows a group as one folder where its first favorite is, and empty created groups last', () => {
    const slots = barSlots(favs, ['Empty', 'Work'])
    expect(slots.map((s) => (s.kind === 'item' ? s.fav.path : `[${s.name}:${s.items.length}]`))).toEqual(['/a', '[Work:2]', '/b', '[Photos:1]', '[Empty:0]'])
    expect(slots.map(slotIndex)).toEqual([0, 1, 2, 4, null])
    expect(groupsInOrder(favs, ['Empty', 'Work'])).toEqual(['Work', 'Photos', 'Empty'])
  })
})

describe('favorites bar drag and drop', () => {
  it('reorders a favorite before another', () => {
    expect(paths(moveFavorites(favs, [2], { beforeIndex: 0 }))).toEqual(['/b', '/a', 'Work:/w1', 'Work:/w2', 'Photos:/p'])
  })
  it('moves a favorite to the end of the bar', () => {
    expect(paths(moveFavorites(favs, [0], {}))).toEqual(['Work:/w1', '/b', 'Work:/w2', 'Photos:/p', '/a'])
  })
  it('drops a favorite into a group, at its end or before one of its favorites', () => {
    expect(paths(moveFavorites(favs, [0], { group: 'Work' }))).toEqual(['Work:/w1', '/b', 'Work:/w2', 'Work:/a', 'Photos:/p'])
    expect(paths(moveFavorites(favs, [0], { group: 'Work', beforeIndex: 3 }))).toEqual(['Work:/w1', '/b', 'Work:/a', 'Work:/w2', 'Photos:/p'])
    // Into a group that has no favorite yet: at the end of the list.
    expect(paths(moveFavorites(favs, [2], { group: 'Empty' }))).toEqual(['/a', 'Work:/w1', 'Work:/w2', 'Photos:/p', 'Empty:/b'])
  })
  it('takes a favorite out of a group', () => {
    const out = moveFavorites(favs, [4], { beforeIndex: 0 })
    expect(paths(out)).toEqual(['/p', '/a', 'Work:/w1', '/b', 'Work:/w2'])
    expect('group' in out[0]).toBe(false)
  })
  it('moves a whole group as a block', () => {
    expect(paths(moveFavorites(favs, [1, 3], { group: 'Work', beforeIndex: 0 }))).toEqual(['Work:/w1', 'Work:/w2', '/a', '/b', 'Photos:/p'])
  })
  it('does not list the same item twice in one place', () => {
    const list: Favorite[] = [{ path: '/a' }, { path: '/A', group: 'G' }]
    expect(paths(moveFavorites(list, [1], {}))).toEqual(['/a'])
  })
  it('adds dropped files and folders at the drop position; one already there moves to it', () => {
    const named: Favorite[] = favs.map((f) => (f.path === '/a' ? { ...f, label: 'Alpha', shortcut: 'Ctrl+Alt+A' } : f))
    const r = insertFavorites(named, [{ path: '/new' }, { path: '/a' }, { path: '/doc.txt', file: true }], { beforeIndex: 2 })
    expect(paths(r.favorites)).toEqual(['Work:/w1', '/new', '/a', '/doc.txt', '/b', 'Work:/w2', 'Photos:/p'])
    expect(r.favorites[2]).toEqual({ path: '/a', label: 'Alpha', shortcut: 'Ctrl+Alt+A' })
    expect(r.favorites[3].file).toBe(true)
    expect([r.added, r.moved]).toEqual([2, 1])
    // In another group it is a new favorite there.
    const g = insertFavorites(favs, [{ path: '/a' }], { group: 'Photos' })
    expect(paths(g.favorites)).toEqual(['/a', 'Work:/w1', '/b', 'Work:/w2', 'Photos:/p', 'Photos:/a'])
    expect([g.added, g.moved]).toEqual([1, 0])
    // Moved to the end, or inside its group.
    expect(paths(insertFavorites(favs, [{ path: '/a' }], {}).favorites)).toEqual(['Work:/w1', '/b', 'Work:/w2', 'Photos:/p', '/a'])
    expect(paths(insertFavorites(favs, [{ path: '/w2' }], { group: 'Work', beforeIndex: 1 }).favorites)).toEqual(['/a', 'Work:/w2', 'Work:/w1', '/b', 'Photos:/p'])
  })
  it('leaves the list as it is when a favorite is dropped where it already is', () => {
    for (const beforeIndex of [0, 1]) {
      const r = insertFavorites(favs, [{ path: '/a' }], { beforeIndex })
      expect(r.favorites).toBe(favs)
      expect([r.added, r.moved]).toEqual([0, 0])
    }
    expect(moveFavorites(favs, [2], { beforeIndex: 2 })).toEqual(favs)
    expect(paths(moveFavorites(favs, [0], { beforeIndex: 0 }))).toEqual(paths(favs))
  })
  it('renames a group, or removes it keeping its favorites', () => {
    expect(paths(renameGroup(favs, 'Work', 'Job'))).toEqual(['/a', 'Job:/w1', '/b', 'Job:/w2', 'Photos:/p'])
    const ungrouped = renameGroup(favs, 'Work', '')
    expect(paths(ungrouped)).toEqual(['/a', '/w1', '/b', '/w2', 'Photos:/p'])
    expect('group' in ungrouped[1]).toBe(false)
  })
})

describe('favorites bar settings', () => {
  it('keeps file favorites and the bar preferences', () => {
    expect(normalizeFavorites([{ path: '/x.txt', file: true }, { path: '/y', file: 'yes' }])).toEqual([{ path: '/x.txt', file: true }, { path: '/y' }])
    const st = normalizeState({ prefs: { showFavoritesBar: false, favoriteGroups: ['Work', 3] } })
    expect(st.prefs.showFavoritesBar).toBe(false)
    expect(st.prefs.favoriteGroups).toEqual(['Work'])
    expect(normalizeState({}).prefs.showFavoritesBar).toBe(true)
  })
})
