import { describe, expect, it } from 'vitest'
import hljs from 'highlight.js/lib/core'
import python from 'highlight.js/lib/languages/python'
import { languageFor, splitHighlightedLines } from '../../src/shared/language'

describe('languageFor', () => {
  it('recognises code by extension, case-insensitively', () => {
    expect(languageFor('main.py', 'py')).toBe('python')
    expect(languageFor('App.TSX', 'TSX')).toBe('typescript')
    expect(languageFor('config.json', 'json')).toBe('json')
    expect(languageFor('index.html', 'html')).toBe('xml')
    expect(languageFor('pyproject.toml', 'toml')).toBe('ini')
    expect(languageFor('firmware.ino', 'ino')).toBe('arduino')
  })
  it('recognises well-known files by name', () => {
    expect(languageFor('Makefile', '')).toBe('makefile')
    expect(languageFor('Dockerfile', '')).toBe('dockerfile')
    expect(languageFor('CMakeLists.txt', 'txt')).toBe('cmake')
  })
  it('leaves plain text and data files uncoloured', () => {
    for (const [n, e] of [['notes.txt', 'txt'], ['app.log', 'log'], ['data.csv', 'csv'], ['README.md', 'md'], ['uv.lock', 'lock'], ['photo', '']]) expect(languageFor(n, e), n).toBeNull()
  })
  it('uses a #! line for files without a known extension', () => {
    expect(languageFor('run', '', '#!/usr/bin/env python3')).toBe('python')
    expect(languageFor('deploy', '', '#!/bin/bash')).toBe('bash')
    expect(languageFor('run', '', 'hello')).toBeNull()
    expect(languageFor('notes.txt', 'txt', '#!/bin/bash')).toBeNull()
  })
})

describe('splitHighlightedLines', () => {
  it('gives one HTML string per line', () => {
    expect(splitHighlightedLines('a\nb\nc')).toEqual(['a', 'b', 'c'])
    expect(splitHighlightedLines('a\n\nb')).toEqual(['a', '', 'b'])
  })
  it('closes a token that runs over several lines and opens it again on the next', () => {
    const lines = splitHighlightedLines('<span class="hljs-comment">/* one\ntwo\nthree */</span> x')
    expect(lines).toEqual(['<span class="hljs-comment">/* one</span>', '<span class="hljs-comment">two</span>', '<span class="hljs-comment">three */</span> x'])
  })
  it('keeps nested tokens balanced on every line', () => {
    const lines = splitHighlightedLines('<span class="a">x<span class="b">y\nz</span>w</span>')
    expect(lines).toEqual(['<span class="a">x<span class="b">y</span></span>', '<span class="a"><span class="b">z</span>w</span>'])
  })
  it('matches the line count of real highlighter output, including multi-line strings and comments', () => {
    hljs.registerLanguage('python', python)
    const code = 'def f(x):\n    """doc\n    string\"""\n    return x  # done\n\nprint("a<b>&c")\n'
    const html = hljs.highlight(code, { language: 'python' }).value
    const lines = splitHighlightedLines(html)
    expect(lines).toHaveLength(code.split('\n').length)
    expect(lines.some((l) => l.includes('hljs-keyword'))).toBe(true)
    for (const l of lines) expect((l.match(/<span/g) ?? []).length, l).toBe((l.match(/<\/span>/g) ?? []).length)
    expect(lines[5]).toContain('&lt;b&gt;&amp;c')
  })
})
