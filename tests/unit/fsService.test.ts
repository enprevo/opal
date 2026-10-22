import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fsx from '../../src/main/fsService'
import { SettingsStore } from '../../src/main/settings'
import type { FileEntry, JobProgress } from '@shared/types'

let tmp: string

async function write(rel: string, content = 'x', mtime?: number): Promise<string> {
  const p = path.join(tmp, rel)
  await fsp.mkdir(path.dirname(p), { recursive: true })
  await fsp.writeFile(p, content)
  if (mtime) await fsp.utimes(p, new Date(mtime), new Date(mtime))
  return p
}

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'opal-test-'))
})
afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true })
})

describe('listing', () => {
  it('lists entries with metadata and parent', async () => {
    await write('a.txt', 'hello')
    await write('sub/b.txt')
    await write('.hidden')
    const l = await fsx.listDir(tmp)
    const names = l.entries.map((e) => e.name).sort()
    expect(names).toEqual(['.hidden', 'a.txt', 'sub'])
    const a = l.entries.find((e) => e.name === 'a.txt')!
    expect(a.size).toBe(5)
    expect(a.ext).toBe('txt')
    expect(l.entries.find((e) => e.name === 'sub')!.isDir).toBe(true)
    expect(l.entries.find((e) => e.name === '.hidden')!.hidden).toBe(true)
    expect(l.parent).toBe(path.dirname(tmp))
  })

  it('lists only subdirectories', async () => {
    await write('a.txt')
    await write('d1/x')
    await write('.d2/x')
    expect((await fsx.listSubdirs(tmp, false)).map((e) => e.name)).toEqual(['d1'])
    expect((await fsx.listSubdirs(tmp, true)).map((e) => e.name).sort()).toEqual(['.d2', 'd1'])
  })

  it('returns roots including home', async () => {
    const roots = await fsx.getRoots()
    expect(roots.some((r) => r.kind === 'home')).toBe(true)
    expect(roots.some((r) => r.kind === 'drive' || r.kind === 'root')).toBe(true)
  })
})

describe('simple operations', () => {
  it('creates folders and files, refusing duplicates', async () => {
    const d = await fsx.makeDir(tmp, 'New Folder')
    expect((await fsp.stat(d)).isDirectory()).toBe(true)
    await expect(fsx.makeDir(tmp, 'New Folder')).rejects.toThrow()
    const f = await fsx.createFile(tmp, 'new.txt')
    expect((await fsp.stat(f)).size).toBe(0)
    await expect(fsx.createFile(tmp, 'new.txt')).rejects.toThrow()
  })

  it('renames and handles case-only renames', async () => {
    const p = await write('a.txt')
    const to = await fsx.renameItem(p, 'b.txt')
    expect(await fsx.pathExists(to)).toBe(true)
    const upper = await fsx.renameItem(to, 'B.txt')
    expect((await fsp.readdir(tmp))).toContain('B.txt')
    await write('c.txt')
    await expect(fsx.renameItem(upper, 'c.txt')).rejects.toThrow(/already exists/)
  })

  it('renameMany supports swaps', async () => {
    const a = await write('a.txt', 'A')
    const b = await write('b.txt', 'B')
    const r = await fsx.renameMany([
      { from: a, to: b },
      { from: b, to: a }
    ])
    expect(r.errors).toEqual([])
    expect(await fsp.readFile(a, 'utf8')).toBe('B')
    expect(await fsp.readFile(b, 'utf8')).toBe('A')
  })

  it('uniqueName appends counters', async () => {
    await write('x.txt')
    await write('x (2).txt')
    expect(path.basename(await fsx.uniqueName(tmp, 'x.txt'))).toBe('x (3).txt')
    expect(path.basename(await fsx.uniqueName(tmp, 'y.txt'))).toBe('y.txt')
  })

  it('deletes permanently', async () => {
    const p = await write('d/e/f.txt')
    expect(await fsx.deletePermanent([path.dirname(path.dirname(p))])).toEqual([])
    expect(await fsx.pathExists(path.join(tmp, 'd'))).toBe(false)
  })
})

describe('transfer', () => {
  it('copies files and folders recursively with progress', async () => {
    await write('src/a.txt', 'aaa')
    await write('src/dir/b.txt', 'bb')
    await fsp.mkdir(path.join(tmp, 'dst'))
    const events: JobProgress[] = []
    const r = await fsx.transfer(
      { op: 'copy', sources: [path.join(tmp, 'src/a.txt'), path.join(tmp, 'src/dir')], destDir: path.join(tmp, 'dst'), conflict: 'skip' },
      'j1',
      (p) => events.push(p)
    )
    expect(r.progress.errors).toEqual([])
    expect(r.progress.doneFiles).toBe(2)
    expect(r.progress.totalBytes).toBe(5)
    expect(await fsp.readFile(path.join(tmp, 'dst/dir/b.txt'), 'utf8')).toBe('bb')
    expect(events.at(-1)!.finished).toBe(true)
    expect(r.undo).toEqual({ type: 'copy', created: [path.join(tmp, 'dst', 'a.txt'), path.join(tmp, 'dst', 'dir')] })
  })

  it('preserves modification times', async () => {
    const t = Date.UTC(2020, 0, 1)
    await write('src/a.txt', 'aaa', t)
    await fsp.mkdir(path.join(tmp, 'dst'))
    await fsx.transfer({ op: 'copy', sources: [path.join(tmp, 'src/a.txt')], destDir: path.join(tmp, 'dst'), conflict: 'skip' }, 'j', () => {})
    const st = await fsp.stat(path.join(tmp, 'dst/a.txt'))
    expect(Math.abs(st.mtimeMs - t)).toBeLessThan(2000)
  })

  it('copy into same folder creates a unique copy', async () => {
    const a = await write('a.txt', '1')
    await fsx.transfer({ op: 'copy', sources: [a], destDir: tmp, conflict: 'skip' }, 'j', () => {})
    expect((await fsp.readdir(tmp)).sort()).toEqual(['a (2).txt', 'a.txt'])
  })

  it('applies conflict policies', async () => {
    const src = await write('src/a.txt', 'new', Date.UTC(2022, 0, 1))
    await write('dst/a.txt', 'old', Date.UTC(2021, 0, 1))
    const dst = path.join(tmp, 'dst')

    await fsx.transfer({ op: 'copy', sources: [src], destDir: dst, conflict: 'skip' }, 'j', () => {})
    expect(await fsp.readFile(path.join(dst, 'a.txt'), 'utf8')).toBe('old')

    await fsx.transfer({ op: 'copy', sources: [src], destDir: dst, conflict: 'rename' }, 'j', () => {})
    expect(await fsp.readFile(path.join(dst, 'a (2).txt'), 'utf8')).toBe('new')

    await fsx.transfer({ op: 'copy', sources: [src], destDir: dst, conflict: 'newer' }, 'j', () => {})
    expect(await fsp.readFile(path.join(dst, 'a.txt'), 'utf8')).toBe('new')

    await write('src/a.txt', 'newest')
    await fsx.transfer({ op: 'copy', sources: [src], destDir: dst, conflict: 'overwrite' }, 'j', () => {})
    expect(await fsp.readFile(path.join(dst, 'a.txt'), 'utf8')).toBe('newest')
  })

  it('moves and merges folders', async () => {
    await write('src/d/a.txt', 'A')
    await write('dst/d/b.txt', 'B')
    const r = await fsx.transfer({ op: 'move', sources: [path.join(tmp, 'src/d')], destDir: path.join(tmp, 'dst'), conflict: 'skip' }, 'j', () => {})
    expect(r.progress.errors).toEqual([])
    expect((await fsp.readdir(path.join(tmp, 'dst/d'))).sort()).toEqual(['a.txt', 'b.txt'])
    expect(await fsx.pathExists(path.join(tmp, 'src/d'))).toBe(false)
  })

  it('refuses to copy a folder into itself', async () => {
    await write('d/a.txt')
    const r = await fsx.transfer({ op: 'copy', sources: [path.join(tmp, 'd')], destDir: path.join(tmp, 'd'), conflict: 'skip' }, 'j', () => {})
    expect(r.progress.errors[0]).toMatch(/into itself/)
  })

  it('can be cancelled', async () => {
    for (let i = 0; i < 20; i++) await write(`src/f${i}.txt`, 'x')
    await fsp.mkdir(path.join(tmp, 'dst'))
    const token = { cancelled: true }
    const r = await fsx.transfer({ op: 'copy', sources: [path.join(tmp, 'src')], destDir: path.join(tmp, 'dst'), conflict: 'skip' }, 'j', () => {}, token)
    expect(r.progress.cancelled).toBe(true)
  })
})

describe('undo', () => {
  it('undoes rename, move, copy', async () => {
    const undo = new fsx.UndoManager()
    const a = await write('a.txt', 'A')
    const b = await fsx.renameItem(a, 'b.txt')
    await undo.push({ type: 'rename', pairs: [{ from: a, to: b }] })
    expect(undo.peekLabel()).toBe('Rename (1 item)')
    expect(await undo.undo()).toEqual([])
    expect(await fsx.pathExists(a)).toBe(true)

    await fsp.mkdir(path.join(tmp, 'dst'))
    const mv = await fsx.transfer({ op: 'move', sources: [a], destDir: path.join(tmp, 'dst'), conflict: 'skip' }, 'j', () => {})
    await undo.push(mv.undo!)
    await undo.undo()
    expect(await fsx.pathExists(a)).toBe(true)
    expect(await fsx.pathExists(path.join(tmp, 'dst/a.txt'))).toBe(false)

    const cp = await fsx.transfer({ op: 'copy', sources: [a], destDir: path.join(tmp, 'dst'), conflict: 'skip' }, 'j', () => {})
    await undo.push(cp.undo!)
    await undo.undo()
    expect(await fsx.pathExists(path.join(tmp, 'dst/a.txt'))).toBe(false)
    expect(undo.size).toBe(0)
  })
})

describe('sizes, find, preview, attributes, compare, split/join', () => {
  it('computes folder sizes', async () => {
    await write('d/a', '12345')
    await write('d/e/b', '123')
    expect(await fsx.folderSize(path.join(tmp, 'd'))).toEqual({ bytes: 8, files: 2, dirs: 1 })
  })

  it('finds by pattern, recursion and content', async () => {
    await write('a.txt', 'needle here')
    await write('b.log', 'nothing')
    await write('sub/c.txt', 'no')
    const found: FileEntry[] = []
    await fsx.find({ root: tmp, pattern: '*.txt', recursive: true, includeDirs: false }, (e) => found.push(...e))
    expect(found.map((e) => e.name).sort()).toEqual(['a.txt', 'c.txt'])
    const found2: FileEntry[] = []
    await fsx.find({ root: tmp, pattern: '*', recursive: true, includeDirs: false, contains: 'NEEDLE' }, (e) => found2.push(...e))
    expect(found2.map((e) => e.name)).toEqual(['a.txt'])
    const found3: FileEntry[] = []
    await fsx.find({ root: tmp, pattern: '*.txt', recursive: false, includeDirs: false }, (e) => found3.push(...e))
    expect(found3.map((e) => e.name)).toEqual(['a.txt'])
  })

  it('reads previews', async () => {
    const t = await write('a.txt', 'hello')
    expect(await fsx.readPreview(t)).toMatchObject({ kind: 'text', text: 'hello', truncated: false })
    const bin = path.join(tmp, 'b.bin')
    await fsp.writeFile(bin, Buffer.from([0, 1, 2, 3]))
    expect((await fsx.readPreview(bin)).kind).toBe('binary')
    expect((await fsx.readPreview(path.join(tmp, 'pic.png'))).kind).toBe('error')
    await write('pic.png', 'x')
    expect((await fsx.readPreview(path.join(tmp, 'pic.png'))).kind).toBe('image')
    expect((await fsx.readPreview(tmp)).kind).toBe('dir')
  })

  it('sets readonly and mtime', async () => {
    const p = await write('a.txt')
    await fsx.setAttributes(p, { readonly: true })
    expect((await fsx.statEntry(p)).readonly).toBe(true)
    await fsx.setAttributes(p, { readonly: false })
    expect((await fsx.statEntry(p)).readonly).toBe(false)
    const t = Date.UTC(2019, 5, 1)
    await fsx.setAttributes(p, { mtime: t })
    expect(Math.abs((await fsp.stat(p)).mtimeMs - t)).toBeLessThan(2000)
  })

  it('compares folders', async () => {
    await write('L/only-left.txt')
    await write('R/only-right.txt')
    await write('L/same.txt', 'x', Date.UTC(2020, 0, 1))
    await write('R/same.txt', 'x', Date.UTC(2020, 0, 1))
    await write('L/newer.txt', 'x', Date.UTC(2022, 0, 1))
    await write('R/newer.txt', 'x', Date.UTC(2020, 0, 1))
    const items = await fsx.compareFolders(path.join(tmp, 'L'), path.join(tmp, 'R'), true)
    const by = Object.fromEntries(items.map((i) => [i.rel, i.status]))
    expect(by).toEqual({ 'newer.txt': 'leftNewer', 'only-left.txt': 'leftOnly', 'only-right.txt': 'rightOnly', 'same.txt': 'same' })
  })

  it('splits and joins files', async () => {
    const p = await write('big.dat', 'abcdefghij')
    await fsp.mkdir(path.join(tmp, 'parts'))
    const parts = await fsx.splitFile(p, path.join(tmp, 'parts'), 4)
    expect(parts.map((x) => path.basename(x))).toEqual(['big.dat.001', 'big.dat.002', 'big.dat.003'])
    const out = path.join(tmp, 'joined.dat')
    await fsx.joinFiles(parts, out)
    expect(await fsp.readFile(out, 'utf8')).toBe('abcdefghij')
  })
})

describe('settings store', () => {
  it('persists and merges defaults', async () => {
    const file = path.join(tmp, 'cfg', 's.json')
    const s = new SettingsStore(file)
    const st = await s.load()
    expect(st.prefs.dualDisplay).toBe(true)
    s.update({ favorites: [{ path: '/x' }], prefs: { ...st.prefs, theme: 'light' } })
    await s.flush()
    const s2 = new SettingsStore(file)
    const st2 = await s2.load()
    expect(st2.favorites).toEqual([{ path: '/x' }])
    expect(st2.prefs.theme).toBe('light')
    expect(st2.prefs.showTree).toBe(true)
  })
})

describe('flat view, duplicates, hashing', () => {
  it('lists files recursively with relative names', async () => {
    await write('a.txt')
    await write('d/b.txt')
    await write('d/e/c.txt')
    const l = await fsx.listFlat(tmp)
    expect(l.entries.map((e) => e.name).sort()).toEqual(['a.txt', path.join('d', 'b.txt'), path.join('d', 'e', 'c.txt')])
    expect(l.entries.every((e) => !e.isDir)).toBe(true)
  })

  it('hashes files', async () => {
    const p = await write('h.txt', 'abc')
    expect(await fsx.hashFile(p, 'md5')).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(await fsx.hashFile(p, 'sha256')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('finds duplicate files by content', async () => {
    await write('one.txt', 'same content')
    await write('sub/two.txt', 'same content')
    await write('sub/deep/three.txt', 'same content')
    await write('different.txt', 'same contenX')
    await write('unique.txt', 'abc')
    const groups = await fsx.findDuplicates(tmp, { minSize: 1 })
    expect(groups).toHaveLength(1)
    expect(groups[0].paths.map((p) => path.basename(p)).sort()).toEqual(['one.txt', 'three.txt', 'two.txt'])
    expect(groups[0].size).toBe(12)
  })
})

describe('safety (review regressions)', () => {
  it('undo of a move merged into an existing folder only moves back what was moved', async () => {
    await write('src/d/a.txt', 'A')
    await write('dst/d/b.txt', 'B')
    const undo = new fsx.UndoManager()
    const r = await fsx.transfer({ op: 'move', sources: [path.join(tmp, 'src/d')], destDir: path.join(tmp, 'dst'), conflict: 'skip' }, 'j', () => {})
    await undo.push(r.undo!)
    expect(await undo.undo()).toEqual([])
    expect(await fsp.readFile(path.join(tmp, 'src/d/a.txt'), 'utf8')).toBe('A')
    expect(await fsp.readFile(path.join(tmp, 'dst/d/b.txt'), 'utf8')).toBe('B')
    expect(await fsx.pathExists(path.join(tmp, 'dst/d/a.txt'))).toBe(false)
  })

  it('undo refuses to touch a path that now holds a different file', async () => {
    await write('src/a.txt', 'A')
    await fsp.mkdir(path.join(tmp, 'dst'))
    const undo = new fsx.UndoManager()
    const r = await fsx.transfer({ op: 'copy', sources: [path.join(tmp, 'src/a.txt')], destDir: path.join(tmp, 'dst'), conflict: 'skip' }, 'j', () => {})
    await undo.push(r.undo!)
    await fsp.rm(path.join(tmp, 'dst/a.txt'))
    await write('dst/a.txt', 'unrelated new file')
    const errors = await undo.undo()
    expect(errors[0]).toMatch(/changed since/)
    expect(await fsp.readFile(path.join(tmp, 'dst/a.txt'), 'utf8')).toBe('unrelated new file')
  })

  it('overwrite leaves no temporary files and replaces content', async () => {
    await write('src/a.txt', 'new')
    await write('dst/a.txt', 'old')
    await fsx.transfer({ op: 'copy', sources: [path.join(tmp, 'src/a.txt')], destDir: path.join(tmp, 'dst'), conflict: 'overwrite' }, 'j', () => {})
    expect(await fsp.readdir(path.join(tmp, 'dst'))).toEqual(['a.txt'])
    expect(await fsp.readFile(path.join(tmp, 'dst/a.txt'), 'utf8')).toBe('new')
  })

  it('renameMany validates targets up front and changes nothing on conflict', async () => {
    const a = await write('a.txt', 'A')
    const b = await write('b.txt', 'B')
    await write('c.txt', 'C')
    const dup = await fsx.renameMany([
      { from: a, to: path.join(tmp, 'x.txt') },
      { from: b, to: path.join(tmp, 'x.txt') }
    ])
    expect(dup.done).toEqual([])
    expect(dup.errors[0]).toMatch(/duplicate/)
    const taken = await fsx.renameMany([{ from: a, to: path.join(tmp, 'c.txt') }])
    expect(taken.done).toEqual([])
    expect((await fsp.readdir(tmp)).sort()).toEqual(['a.txt', 'b.txt', 'c.txt'])
    const chain = await fsx.renameMany([
      { from: a, to: b },
      { from: b, to: path.join(tmp, 'd.txt') }
    ])
    expect(chain.errors).toEqual([])
    expect(await fsp.readFile(b, 'utf8')).toBe('A')
    expect(await fsp.readFile(path.join(tmp, 'd.txt'), 'utf8')).toBe('B')
  })

  it('refuses to copy a folder into a link that points inside it', async () => {
    await write('tree/inner/f.txt', 'x')
    const link = path.join(tmp, 'link')
    await fsp.symlink(path.join(tmp, 'tree', 'inner'), link, process.platform === 'win32' ? 'junction' : 'dir')
    const r = await fsx.transfer({ op: 'move', sources: [path.join(tmp, 'tree')], destDir: link, conflict: 'skip' }, 'j', () => {})
    expect(r.progress.errors[0]).toMatch(/into itself/)
    expect(await fsp.readFile(path.join(tmp, 'tree/inner/f.txt'), 'utf8')).toBe('x')
  })

  it('copies symlinks as links instead of following them', async () => {
    await write('target/big.txt', 'payload')
    await fsp.mkdir(path.join(tmp, 'src'))
    await fsp.symlink(path.join(tmp, 'target'), path.join(tmp, 'src', 'lnk'), process.platform === 'win32' ? 'junction' : 'dir')
    await fsp.mkdir(path.join(tmp, 'dst'))
    const r = await fsx.transfer({ op: 'copy', sources: [path.join(tmp, 'src')], destDir: path.join(tmp, 'dst'), conflict: 'skip' }, 'j', () => {})
    expect(r.progress.errors).toEqual([])
    expect((await fsp.lstat(path.join(tmp, 'dst/src/lnk'))).isSymbolicLink()).toBe(true)
  })

  it('compareFolders does not loop through self-referencing links', async () => {
    await write('L/a.txt')
    await fsp.symlink(path.join(tmp, 'L'), path.join(tmp, 'L', 'loop'), process.platform === 'win32' ? 'junction' : 'dir')
    await fsp.mkdir(path.join(tmp, 'R'))
    const items = await fsx.compareFolders(path.join(tmp, 'L'), path.join(tmp, 'R'), true)
    expect(items.map((i) => i.rel).sort()).toEqual(['a.txt', 'loop'])
  })

  it('reports same volume for sibling folders', async () => {
    await fsp.mkdir(path.join(tmp, 'x'))
    await fsp.mkdir(path.join(tmp, 'y'))
    expect(await fsx.sameVolume(path.join(tmp, 'x'), path.join(tmp, 'y'))).toBe(true)
  })
})

describe('copy variants', () => {
  it('Copy AS renames on the fly', async () => {
    const a = await write('src/a.txt', 'A')
    await fsp.mkdir(path.join(tmp, 'dst'))
    await fsx.transfer({ op: 'copy', sources: [a], destDir: path.join(tmp, 'dst'), conflict: 'skip', renames: { [a]: 'renamed.txt' } }, 'j', () => {})
    expect(await fsp.readdir(path.join(tmp, 'dst'))).toEqual(['renamed.txt'])
  })
  it('UPDATEEXISTING only replaces files already in the destination', async () => {
    await write('src/a.txt', 'new', Date.UTC(2023, 0, 1))
    await write('src/b.txt', 'new', Date.UTC(2023, 0, 1))
    await write('dst/a.txt', 'old', Date.UTC(2020, 0, 1))
    await fsx.transfer({ op: 'copy', sources: [path.join(tmp, 'src/a.txt'), path.join(tmp, 'src/b.txt')], destDir: path.join(tmp, 'dst'), conflict: 'newer', onlyExisting: true }, 'j', () => {})
    expect(await fsp.readdir(path.join(tmp, 'dst'))).toEqual(['a.txt'])
    expect(await fsp.readFile(path.join(tmp, 'dst/a.txt'), 'utf8')).toBe('new')
  })
  it('ensureDestDir creates the destination (CREATEFOLDER / nested structure)', async () => {
    const a = await write('src/a.txt', 'A')
    await fsx.transfer({ op: 'copy', sources: [a], destDir: path.join(tmp, 'dst', 'new', 'deep'), conflict: 'skip', ensureDestDir: true }, 'j', () => {})
    expect(await fsp.readFile(path.join(tmp, 'dst/new/deep/a.txt'), 'utf8')).toBe('A')
  })
})
