import { describe, expect, it } from 'vitest'
import { parseCommandLine, parseCommands, tokenize, expandPlaceholders, argFlag, argString } from '@shared/commands'
import { breadcrumbs, dirname, basename, join, normalize, isRoot, isAncestor, samePath, validateFileName, extname, stem } from '@shared/paths'
import { formatSize } from '@shared/format'
import { sortEntries, naturalCompare } from '@shared/sort'
import type { FileEntry } from '@shared/types'

describe('command parser', () => {
  it('tokenizes quotes', () => {
    expect(tokenize('Copy TO="C:\\My Files" MOVE')).toEqual(['Copy', 'TO=C:\\My Files', 'MOVE'])
    expect(tokenize('Say "he said ""hi"""')).toEqual(['Say', 'he said "hi"'])
    expect(() => tokenize('Copy "oops')).toThrow()
  })
  it('parses args and flags', () => {
    const c = parseCommandLine('Copy MOVE TO={destpath}')!
    expect(c.name).toBe('copy')
    expect(argFlag(c.args, 'move')).toBe(true)
    expect(argString(c.args, 'to')).toBe('{destpath}')
    const g = parseCommandLine('Go "C:\\My Dir=1"')!
    expect(g.positional).toEqual(['C:\\My Dir=1'])
  })
  it('parses multi-line scripts with comments', () => {
    const cmds = parseCommands('// comment\nGo UP\n\nSelect PATTERN=*.txt')
    expect(cmds.map((c) => c.name)).toEqual(['go', 'select'])
  })
  it('expands placeholders', () => {
    const s = expandPlaceholders('{sourcepath}|{destpath}|{file}|{allfilepath}', {
      sourcepath: '/a',
      destpath: '/b',
      selected: ['/a/x.txt', '/a/y.txt']
    })
    expect(s).toBe('/a|/b|x.txt|"/a/x.txt" "/a/y.txt"')
  })
})

describe('paths', () => {
  it('handles windows paths', () => {
    expect(normalize('c:/Users//me/')).toBe('C:\\Users\\me')
    expect(normalize('C:')).toBe('C:\\')
    expect(dirname('C:\\Users\\me')).toBe('C:\\Users')
    expect(dirname('C:\\Users')).toBe('C:\\')
    expect(dirname('C:\\')).toBeNull()
    expect(basename('C:\\Users\\me')).toBe('me')
    expect(join('C:\\', 'a', 'b')).toBe('C:\\a\\b')
    expect(isRoot('D:\\')).toBe(true)
    expect(breadcrumbs('C:\\Users\\me').map((c) => c.path)).toEqual(['C:\\', 'C:\\Users', 'C:\\Users\\me'])
    expect(samePath('c:\\A\\b', 'C:\\a\\B')).toBe(true)
    expect(isAncestor('C:\\a', 'C:\\a\\b\\c')).toBe(true)
    expect(isAncestor('C:\\a', 'C:\\ab')).toBe(false)
  })
  it('handles posix paths', () => {
    expect(normalize('/home//me/')).toBe('/home/me')
    expect(dirname('/home/me')).toBe('/home')
    expect(dirname('/home')).toBe('/')
    expect(dirname('/')).toBeNull()
    expect(join('/', 'usr', 'bin')).toBe('/usr/bin')
    expect(breadcrumbs('/usr/bin').map((c) => c.label)).toEqual(['/', 'usr', 'bin'])
    expect(samePath('/A', '/a')).toBe(false)
  })
  it('handles UNC paths', () => {
    expect(isRoot('\\\\server\\share')).toBe(true)
    expect(dirname('\\\\server\\share\\dir')).toBe('\\\\server\\share')
    expect(dirname('\\\\server\\share')).toBeNull()
  })
  it('extensions and validation', () => {
    expect(extname('a.tar.gz')).toBe('gz')
    expect(extname('.gitignore')).toBe('')
    expect(stem('a.tar.gz')).toBe('a.tar')
    expect(validateFileName('a:b', 'win')).not.toBeNull()
    expect(validateFileName('CON.txt', 'win')).not.toBeNull()
    expect(validateFileName('a:b', 'posix')).toBeNull()
    expect(validateFileName('', 'posix')).not.toBeNull()
  })
})

describe('format and sort', () => {
  it('formats sizes', () => {
    expect(formatSize(0)).toBe('0 bytes')
    expect(formatSize(1)).toBe('1 byte')
    expect(formatSize(1536)).toBe('1.50 KB')
    expect(formatSize(10 * 1024 * 1024)).toBe('10.0 MB')
    expect(formatSize(1234, 'bytes')).toBe('1,234 bytes')
  })

  const mk = (name: string, isDir = false, size = 0, mtime = 0): FileEntry => ({
    name,
    path: '/' + name,
    isDir,
    isSymlink: false,
    size,
    mtime,
    ctime: 0,
    atime: 0,
    ext: isDir ? '' : (name.split('.').pop() ?? ''),
    hidden: false,
    readonly: false,
    mode: 0
  })

  it('natural sort with folders first', () => {
    const list = [mk('file10.txt'), mk('file2.txt'), mk('zdir', true), mk('adir', true), mk('File1.txt')]
    expect(sortEntries(list, { column: 'name', descending: false }).map((e) => e.name)).toEqual([
      'adir',
      'zdir',
      'File1.txt',
      'file2.txt',
      'file10.txt'
    ])
    expect(sortEntries(list, { column: 'name', descending: true }).map((e) => e.name)).toEqual([
      'zdir',
      'adir',
      'file10.txt',
      'file2.txt',
      'File1.txt'
    ])
    expect(naturalCompare('a2', 'a10')).toBeLessThan(0)
  })

  it('sorts by size and date', () => {
    const list = [mk('a', false, 30, 1), mk('b', false, 10, 3), mk('c', false, 20, 2)]
    expect(sortEntries(list, { column: 'size', descending: false }).map((e) => e.name)).toEqual(['b', 'c', 'a'])
    expect(sortEntries(list, { column: 'mtime', descending: true }).map((e) => e.name)).toEqual(['b', 'c', 'a'])
  })
})

describe('placeholders with date macros', () => {
  it('expands {date|…} and {time|…}', () => {
    const now = new Date(2026, 0, 5, 9, 3).getTime()
    expect(expandPlaceholders('{date|yyyy-MM-dd} {time|HH-mm}', { sourcepath: '', destpath: '', selected: [], now })).toBe('2026-01-05 09-03')
  })
})

describe('POSIX paths with backslashes in names', () => {
  it('treats a backslash as part of the file name on Linux/macOS', () => {
    expect(basename('/home/me/a\\b.txt')).toBe('a\\b.txt')
    expect(dirname('/home/me/a\\b.txt')).toBe('/home/me')
    expect(join('/home/me', 'a\\b.txt')).toBe('/home/me/a\\b.txt')
    expect(dirname('/home/me/dir/')).toBe('/home/me')
  })
  it('still accepts both separators on Windows', () => {
    expect(basename('C:/Users/me\\x.txt')).toBe('x.txt')
    expect(join('C:\\Users', 'a/b')).toBe('C:\\Users\\a\\b')
  })
})
