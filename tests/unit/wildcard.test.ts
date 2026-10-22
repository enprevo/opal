import { describe, expect, it } from 'vitest'
import { compilePattern, matchesPattern, isWildcard } from '@shared/wildcard'

describe('wildcard patterns', () => {
  it('matches * and ?', () => {
    expect(matchesPattern('photo.jpg', '*.jpg')).toBe(true)
    expect(matchesPattern('photo.JPG', '*.jpg')).toBe(true)
    expect(matchesPattern('photo.png', '*.jpg')).toBe(false)
    expect(matchesPattern('a1.txt', 'a?.txt')).toBe(true)
    expect(matchesPattern('a12.txt', 'a?.txt')).toBe(false)
  })

  it('supports alternation and ; lists', () => {
    expect(matchesPattern('x.png', '*.(jpg|png)')).toBe(true)
    expect(matchesPattern('x.gif', '*.(jpg|png)')).toBe(false)
    expect(matchesPattern('x.gif', '*.jpg;*.gif')).toBe(true)
  })

  it('supports negation', () => {
    expect(matchesPattern('readme.md', '~(*.txt)')).toBe(true)
    expect(matchesPattern('notes.txt', '~(*.txt)')).toBe(false)
    expect(matchesPattern('notes.txt', '*;~*.txt')).toBe(false)
    expect(matchesPattern('notes.md', '*;~*.txt')).toBe(true)
  })

  it('supports character sets and repetition', () => {
    expect(matchesPattern('file3.log', 'file[0-9].log')).toBe(true)
    expect(matchesPattern('filex.log', 'file[~0-9].log')).toBe(true)
    expect(matchesPattern('file3.log', 'file[~0-9].log')).toBe(false)
    expect(matchesPattern('aaab', '#ab')).toBe(true)
    expect(matchesPattern('b', '#ab')).toBe(true)
  })

  it('escapes regex specials and supports quote escape', () => {
    expect(matchesPattern('a+b(1).txt', "a+b'(1').txt")).toBe(true)
    expect(matchesPattern('a.b', 'a.b')).toBe(true)
    expect(matchesPattern('axb', 'a.b')).toBe(false)
  })

  it('supports regex: prefix and case sensitivity', () => {
    expect(matchesPattern('IMG_0001.JPG', 'regex:^img_\\d+')).toBe(true)
    expect(compilePattern('*.JPG', { caseSensitive: true })('a.jpg')).toBe(false)
  })

  it('empty/star match everything', () => {
    expect(matchesPattern('anything', '')).toBe(true)
    expect(matchesPattern('anything', '*')).toBe(true)
  })

  it('detects wildcards', () => {
    expect(isWildcard('*.txt')).toBe(true)
    expect(isWildcard('report')).toBe(false)
  })
})
