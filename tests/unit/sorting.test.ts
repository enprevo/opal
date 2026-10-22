import { describe, expect, it } from 'vitest'
import { groupEntries, groupOf, sortEntries } from '@shared/sort'
import { formatDate } from '@shared/format'
import { kindOf } from '@shared/filetypes'
import type { FileEntry } from '@shared/types'

const mk = (name: string, o: Partial<FileEntry> = {}): FileEntry => ({
  name,
  path: '/x/' + name,
  isDir: false,
  isSymlink: false,
  size: 0,
  mtime: 0,
  ctime: 0,
  atime: 0,
  ext: name.includes('.') ? name.split('.').pop()! : '',
  hidden: false,
  readonly: false,
  mode: 0,
  ...o
})

describe('sorting options', () => {
  const list = [mk('b.txt'), mk('Dir', { isDir: true }), mk('a10.txt'), mk('a2.txt')]
  it('places folders first, mixed or last', () => {
    expect(sortEntries(list, { column: 'name', descending: false }, { placement: 'first' }).map((e) => e.name)).toEqual(['Dir', 'a2.txt', 'a10.txt', 'b.txt'])
    expect(sortEntries(list, { column: 'name', descending: false }, { placement: 'last' }).map((e) => e.name)).toEqual(['a2.txt', 'a10.txt', 'b.txt', 'Dir'])
    expect(sortEntries(list, { column: 'name', descending: false }, { placement: 'mixed' }).map((e) => e.name)).toEqual(['a2.txt', 'a10.txt', 'b.txt', 'Dir'])
  })
  it('natural vs plain order', () => {
    expect(sortEntries(list, { column: 'name', descending: false }, { placement: 'mixed', natural: false }).map((e) => e.name).slice(0, 2)).toEqual(['a10.txt', 'a2.txt'])
  })
  it('sorts by label, dimensions and item count', () => {
    const a = mk('a.png')
    const b = mk('b.png')
    const labels = { [b.path]: ['blue'], [a.path]: ['red'] }
    expect(sortEntries([a, b], { column: 'label', descending: false }, { labels }).map((e) => e.name)).toEqual(['b.png', 'a.png'])
    const meta = { [a.path]: { width: 10, height: 10 }, [b.path]: { width: 100, height: 100 } }
    expect(sortEntries([b, a], { column: 'dimensions', descending: false }, { meta }).map((e) => e.name)).toEqual(['a.png', 'b.png'])
  })
})

describe('grouping', () => {
  const now = new Date(2026, 9, 20, 15, 0).getTime()
  it('groups by date buckets', () => {
    expect(groupOf(mk('a', { mtime: now - 3600_000 }), 'mtime', { now }).label).toBe('Today')
    expect(groupOf(mk('a', { mtime: now - 3600_000 * 20 }), 'mtime', { now }).label).toBe('Yesterday')
    expect(groupOf(mk('a', { mtime: now - 400 * 86_400_000 }), 'mtime', { now }).label).toBe('A long time ago')
  })
  it('groups by kind and keeps group order', () => {
    const entries = [mk('z.txt'), mk('pic.jpg'), mk('Folder', { isDir: true }), mk('song.mp3')]
    const groups = groupEntries(entries, 'kind')
    expect(groups.map((g) => g.group.label)).toEqual(['Folders', 'Images', 'Music', 'Documents'])
    expect(kindOf(mk('x.tsx')).label).toBe('Code')
  })
  it('groups by size and first letter', () => {
    expect(groupOf(mk('a', { size: 5 * 1024 * 1024 }), 'size').label).toBe('Medium (1 – 128 MB)')
    expect(groupOf(mk('9lives'), 'name').label).toBe('0 – 9')
    expect(groupEntries([mk('a')], 'none')).toHaveLength(1)
  })
})

describe('date formats', () => {
  const now = new Date(2026, 9, 20, 15, 0).getTime()
  it('relative and custom', () => {
    expect(formatDate(now - 30_000, 'relative', '', now)).toBe('Just now')
    expect(formatDate(now - 5 * 60_000, 'relative', '', now)).toBe('5 min ago')
    expect(formatDate(new Date(2026, 9, 20, 9, 7).getTime(), 'relative', '', now)).toBe('Today 09:07')
    expect(formatDate(new Date(2026, 9, 19, 9, 7).getTime(), 'relative', '', now)).toBe('Yesterday 09:07')
    expect(formatDate(new Date(2026, 0, 2, 3, 4).getTime(), 'custom', 'dd/MM/yy HH.mm')).toBe('02/01/26 03.04')
  })
})
