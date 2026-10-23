import { describe, expect, it } from 'vitest'
import {
  favoriteForKey,
  favoriteItems,
  findFavorite,
  insertFavorite,
  moveFavorite,
  normalizeFavorites,
  releaseKey,
  removeFavorite,
  replaceFavorite,
  shiftFavorite,
  sortFavorites,
  updateFavorite,
  type FavoriteNode
} from '../../src/shared/favorites'
import { highlightLines, languageFor, splitHtmlLines } from '../../src/renderer/src/highlight'

const tree = (): FavoriteNode[] => [
  { type: 'item', id: 'docs', path: 'C:\\Docs', key: 'D' },
  { type: 'separator', id: 's1' },
  {
    type: 'group',
    id: 'work',
    label: 'Work',
    children: [
      { type: 'item', id: 'proj', path: 'C:\\Projects', label: 'Projects', key: 'P' },
      { type: 'group', id: 'clients', label: 'Clients', children: [{ type: 'item', id: 'acme', path: 'C:\\Clients\\Acme', key: 'Shift+A' }] }
    ]
  }
]
const ids = (nodes: FavoriteNode[]): string[] => nodes.map((n) => n.id)

describe('favorites tree', () => {
  it('finds items and keys, including nested ones', () => {
    expect(favoriteItems(tree()).map((f) => f.id)).toEqual(['docs', 'proj', 'acme'])
    expect(favoriteForKey(tree(), 'p')?.id).toBe('proj')
    expect(favoriteForKey(tree(), 'Shift+A')?.id).toBe('acme')
    expect(favoriteForKey(tree(), 'A')).toBeNull()
  })
  it('edits, replaces and removes without touching the original', () => {
    const t = tree()
    const coloured = updateFavorite(t, 'acme', { color: '#ff0000', icon: 'lucide:Star' })
    expect(findFavorite(coloured, 'acme')).toMatchObject({ color: '#ff0000', icon: 'lucide:Star' })
    expect(findFavorite(t, 'acme')).not.toHaveProperty('color')
    expect(findFavorite(updateFavorite(coloured, 'acme', { color: undefined }), 'acme')).not.toHaveProperty('color')
    const replaced = replaceFavorite(t, 'work', { type: 'group', id: 'work', label: 'Job', children: [] })
    expect(findFavorite(replaced, 'work')).toMatchObject({ label: 'Job' })
    expect(favoriteItems(replaced)).toHaveLength(3)
    expect(favoriteItems(removeFavorite(t, 'work')).map((f) => f.id)).toEqual(['docs'])
  })
  it('moves nodes before, after and inside groups, never into themselves', () => {
    const t = tree()
    expect(ids(moveFavorite(t, 'docs', 'work', 'after'))).toEqual(['s1', 'work', 'docs'])
    const inside = moveFavorite(t, 'docs', 'clients', 'inside')
    expect((findFavorite(inside, 'clients') as { children: FavoriteNode[] }).children.map((c) => c.id)).toEqual(['acme', 'docs'])
    expect(moveFavorite(t, 'work', 'clients', 'inside')).toEqual(t)
    expect(ids(insertFavorite(t, { type: 'separator', id: 'new' }, 'docs', 'before'))).toEqual(['new', 'docs', 's1', 'work'])
  })
  it('shifts among siblings and sorts groups first', () => {
    expect(ids(shiftFavorite(tree(), 'docs', 1))).toEqual(['s1', 'docs', 'work'])
    expect(ids(shiftFavorite(tree(), 'docs', -1))).toEqual(['docs', 's1', 'work'])
    expect(ids(sortFavorites(tree(), null))).toEqual(['work', 'docs'])
    const sortedWork = sortFavorites(tree(), 'work')
    expect((findFavorite(sortedWork, 'work') as { children: FavoriteNode[] }).children.map((c) => c.id)).toEqual(['clients', 'proj'])
  })
  it('keeps shortcut keys unique', () => {
    const t = releaseKey(tree(), 'p', 'docs')
    expect(findFavorite(t, 'proj')).not.toHaveProperty('key')
    expect(findFavorite(t, 'docs')).toMatchObject({ key: 'D' })
  })
  it('drops invalid styles when loading', () => {
    const [n] = normalizeFavorites([{ type: 'item', id: 'x', path: '/a', color: 'red; background:url(x)', background: '#123456', icon: 'lucide:Star', key: 'P' }])
    expect(n).toEqual({ type: 'item', id: 'x', path: '/a', background: '#123456', icon: 'lucide:Star', key: 'P' })
  })
})

describe('syntax highlighting', () => {
  it('picks the language from the file name', () => {
    expect(languageFor('main.c')).toBe('c')
    expect(languageFor('app.tsx')).toBe('typescript')
    expect(languageFor('/x/CMakeLists.txt')).toBe('cmake')
    expect(languageFor('Dockerfile')).toBe('dockerfile')
    expect(languageFor('notes.txt')).toBeNull()
  })
  it('splits highlighted HTML into self-contained lines', () => {
    expect(splitHtmlLines('<span class="a">x\ny</span>z\nw')).toEqual(['<span class="a">x</span>', '<span class="a">y</span>z', 'w'])
    const lines = highlightLines('/* multi\n   line */\nint main(void) {\n  return "a<b";\n}', 'main.c')!
    expect(lines).toHaveLength(5)
    expect(lines[0]).toContain('hljs-comment')
    expect(lines[1]).toContain('hljs-comment')
    expect(lines[2]).toContain('hljs-title function_')
    expect(lines[3]).toContain('hljs-keyword')
    expect(lines[3]).toContain('&lt;')
    for (const l of lines) expect((l.match(/<span/g) ?? []).length).toBe((l.match(/<\/span>/g) ?? []).length)
  })
  it('leaves plain text and huge files alone', () => {
    expect(highlightLines('hello', 'readme.txt')).toBeNull()
    expect(highlightLines('x'.repeat(500_000), 'big.js')).toBeNull()
  })
})
