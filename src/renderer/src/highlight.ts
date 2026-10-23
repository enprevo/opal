import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cmake from 'highlight.js/lib/languages/cmake'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import dos from 'highlight.js/lib/languages/dos'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import latex from 'highlight.js/lib/languages/latex'
import lua from 'highlight.js/lib/languages/lua'
import makefile from 'highlight.js/lib/languages/makefile'
import markdown from 'highlight.js/lib/languages/markdown'
import perl from 'highlight.js/lib/languages/perl'
import php from 'highlight.js/lib/languages/php'
import powershell from 'highlight.js/lib/languages/powershell'
import properties from 'highlight.js/lib/languages/properties'
import python from 'highlight.js/lib/languages/python'
import r from 'highlight.js/lib/languages/r'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import vbnet from 'highlight.js/lib/languages/vbnet'
import x86asm from 'highlight.js/lib/languages/x86asm'
import armasm from 'highlight.js/lib/languages/armasm'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const LANGS = {
  bash, c, cmake, cpp, csharp, css, diff, dockerfile, dos, go, ini, java, javascript, json, kotlin, latex, lua, makefile,
  markdown, perl, php, powershell, properties, python, r, ruby, rust, scss, sql, swift, typescript, vbnet, x86asm, armasm,
  xml, yaml
}
for (const [name, def] of Object.entries(LANGS)) hljs.registerLanguage(name, def)

const BY_EXT: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  json: 'json', jsonc: 'json', json5: 'json',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', xaml: 'xml', csproj: 'xml', vcxproj: 'xml', plist: 'xml', vue: 'xml', svelte: 'xml',
  css: 'css', scss: 'scss', less: 'scss',
  py: 'python', pyw: 'python', pyi: 'python',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', ino: 'cpp',
  cs: 'csharp', java: 'java', kt: 'kotlin', kts: 'kotlin', go: 'go', rs: 'rust', swift: 'swift',
  sh: 'bash', bash: 'bash', zsh: 'bash', env: 'bash',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  bat: 'dos', cmd: 'dos',
  sql: 'sql', yml: 'yaml', yaml: 'yaml',
  ini: 'ini', cfg: 'ini', conf: 'ini', toml: 'ini', editorconfig: 'ini', gitconfig: 'ini',
  properties: 'properties', gradle: 'properties',
  md: 'markdown', markdown: 'markdown',
  dockerfile: 'dockerfile', makefile: 'makefile', mk: 'makefile', cmake: 'cmake',
  lua: 'lua', php: 'php', rb: 'ruby', pl: 'perl', pm: 'perl', r: 'r',
  tex: 'latex', vb: 'vbnet', vbs: 'vbnet',
  asm: 'x86asm', nasm: 'x86asm', s: 'armasm',
  diff: 'diff', patch: 'diff'
}

const BY_NAME: Record<string, string> = { dockerfile: 'dockerfile', makefile: 'makefile', gnumakefile: 'makefile', 'cmakelists.txt': 'cmake' }

/** Highlight.js language for a file name, or null for plain text. */
export function languageFor(fileName: string): string | null {
  const name = fileName.toLowerCase().split(/[\\/]/).pop() ?? ''
  if (BY_NAME[name]) return BY_NAME[name]
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  return BY_EXT[ext] ?? null
}

export function languageName(lang: string): string {
  return hljs.getLanguage(lang)?.name ?? lang
}

/** Larger texts are shown plain: highlighting them would make the preview slow. */
const MAX_HIGHLIGHT = 400_000

/**
 * Splits highlighted HTML into lines. Spans that cross a line break are closed at the end of the line and
 * reopened on the next one, so every line is valid HTML on its own (and line numbers stay aligned).
 */
export function splitHtmlLines(html: string): string[] {
  const lines: string[] = []
  const open: string[] = []
  let cur = ''
  const re = /(<span[^>]*>)|(<\/span>)|([^<]+)|(<)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (m[1]) {
      open.push(m[1])
      cur += m[1]
    } else if (m[2]) {
      open.pop()
      cur += m[2]
    } else {
      const parts = (m[3] ?? m[4]).split('\n')
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
          lines.push(cur + '</span>'.repeat(open.length))
          cur = open.join('')
        }
        cur += parts[i]
      }
    }
  }
  lines.push(cur + '</span>'.repeat(open.length))
  return lines
}

/** HTML of each line with syntax colours, or null when the file type isn't code (or the text is too large). */
export function highlightLines(text: string, fileName: string, lang = languageFor(fileName)): string[] | null {
  if (!lang || text.length > MAX_HIGHLIGHT || !hljs.getLanguage(lang)) return null
  try {
    return splitHtmlLines(hljs.highlight(text, { language: lang, ignoreIllegals: true }).value)
  } catch {
    return null
  }
}

/** Highlighted HTML of a code block (Markdown fences); falls back to escaped text. */
export function highlightBlock(code: string, lang: string | undefined): string {
  const l = lang && hljs.getLanguage(lang) ? lang : null
  try {
    if (l) return hljs.highlight(code, { language: l, ignoreIllegals: true }).value
  } catch {
    // fall through
  }
  return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
