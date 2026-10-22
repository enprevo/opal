import { describe, expect, it } from 'vitest'
import { computeRename, previewRename, formatDateTime } from '@shared/rename'

describe('advanced rename', () => {
  it('standard wildcard mode maps captures', () => {
    expect(computeRename({ name: 'a.jpeg' }, 0, { mode: 'standard', oldPattern: '*.jpeg', newPattern: '* - photo.jpg' })).toBe(
      'a - photo.jpg'
    )
    expect(computeRename({ name: 'IMG_01.png' }, 0, { mode: 'standard', oldPattern: 'IMG_*.*', newPattern: 'Holiday *.*' })).toBe(
      'Holiday 01.png'
    )
    expect(computeRename({ name: 'x.txt' }, 0, { mode: 'standard', oldPattern: '*.jpg', newPattern: '*.png' })).toBeNull()
  })

  it('regex mode uses capture groups', () => {
    expect(computeRename({ name: 'IMG_1234.JPG' }, 0, { mode: 'regex', oldPattern: '^IMG_(\\d+)\\.(\\w+)$', newPattern: 'Photo $1.$2' })).toBe(
      'Photo 1234.JPG'
    )
  })

  it('find & replace mode', () => {
    expect(computeRename({ name: 'my file file.txt' }, 0, { mode: 'findreplace', oldPattern: 'file', newPattern: 'doc' })).toBe(
      'my doc doc.txt'
    )
    expect(
      computeRename({ name: 'my file file.txt' }, 0, { mode: 'findreplace', oldPattern: 'file', newPattern: 'doc', replaceAll: false })
    ).toBe('my doc file.txt')
  })

  it('numbering and macros', () => {
    const opts = { mode: 'standard' as const, oldPattern: '*', newPattern: 'pic_[###].{ext}', numberStart: 1 }
    expect(computeRename({ name: 'a.jpg' }, 0, { ...opts, ignoreExtension: true, newPattern: 'pic_[###]' })).toBe('pic_001.jpg')
    expect(computeRename({ name: 'b.png' }, 4, { ...opts, ignoreExtension: true, newPattern: 'pic_[###]' })).toBe('pic_005.png')
    expect(computeRename({ name: 'c.png' }, 0, { mode: 'standard', oldPattern: '*', newPattern: '{name}-x.{ext}' })).toBe('c-x.png')
  })

  it('case conversion', () => {
    const base = { mode: 'standard' as const, oldPattern: '*', newPattern: '*' }
    expect(computeRename({ name: 'Hello World.TXT' }, 0, { ...base, caseMode: 'lower' })).toBe('hello world.txt')
    expect(computeRename({ name: 'hello world.txt' }, 0, { ...base, caseMode: 'title' })).toBe('Hello World.txt')
    expect(computeRename({ name: 'HELLO world.TXT' }, 0, { ...base, caseMode: 'sentence' })).toBe('Hello world.TXT')
    expect(computeRename({ name: 'a.TXT' }, 0, { ...base, caseMode: 'lowerExt' })).toBe('a.txt')
  })

  it('preview flags duplicates and invalid names', () => {
    const res = previewRename([{ name: 'a.txt' }, { name: 'b.txt' }], { mode: 'standard', oldPattern: '*.txt', newPattern: 'same.txt' }, 'win')
    expect(res.every((r) => r.error === 'Duplicate name')).toBe(true)
    const bad = previewRename([{ name: 'a.txt' }], { mode: 'findreplace', oldPattern: 'a', newPattern: 'x:y' }, 'win')
    expect(bad[0].error).toMatch(/invalid/)
    const ok = previewRename([{ name: 'a.txt' }], { mode: 'findreplace', oldPattern: 'a', newPattern: 'x:y' }, 'posix')
    expect(ok[0].error).toBeUndefined()
  })

  it('preview reports regex errors', () => {
    const res = previewRename([{ name: 'a.txt' }], { mode: 'regex', oldPattern: '(', newPattern: '' }, 'posix')
    expect(res[0].error).toBeDefined()
  })
})

describe('wildcard and regex rename compatibility', () => {
  it('accepts \\1 back-references', () => {
    expect(computeRename({ name: 'a-b.txt' }, 0, { mode: 'regex', oldPattern: '(.*)-(.*)', newPattern: '\\2-\\1' })).toBe('b.txt-a')
  })
  it('trailing # repeats until stable (Make Web-safe)', () => {
    const opts = { mode: 'regex' as const, oldPattern: '(.*)([^-0-9a-zA-Z._]+)(.*)#', newPattern: '\\1_\\3' }
    expect(computeRename({ name: 'my file (1)&x.txt' }, 0, opts)).toBe('my_file__1__x.txt')
  })
  it('Number Files preset', () => {
    const opts = { mode: 'regex' as const, oldPattern: '(.*)', newPattern: '[####]', ignoreExtension: true }
    expect(computeRename({ name: 'photo.jpg' }, 2, opts)).toBe('0003.jpg')
  })
  it('date/time macros', () => {
    const now = new Date(2026, 9, 19, 14, 5, 9).getTime()
    expect(formatDateTime(new Date(now), 'yyyy-MM-dd HH-mm-ss')).toBe('2026-10-19 14-05-09')
    const r = computeRename({ name: 'a.txt' }, 0, { mode: 'standard', oldPattern: '*', newPattern: '* - {date|yyyy-MM-dd} {time|HH-mm}', ignoreExtension: true, now })
    expect(r).toBe('a - 2026-10-19 14-05.txt')
    expect(computeRename({ name: 'b.txt', mtime: new Date(2020, 0, 2).getTime() }, 0, { mode: 'standard', oldPattern: '*', newPattern: '{modified|yyyyMMdd}_*' })).toBe('20200102_b.txt')
  })
})
