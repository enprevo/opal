import hljs from 'highlight.js/lib/core'
import arduino from 'highlight.js/lib/languages/arduino'
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
import groovy from 'highlight.js/lib/languages/groovy'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import latex from 'highlight.js/lib/languages/latex'
import less from 'highlight.js/lib/languages/less'
import lua from 'highlight.js/lib/languages/lua'
import makefile from 'highlight.js/lib/languages/makefile'
import php from 'highlight.js/lib/languages/php'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { splitHighlightedLines } from '@shared/language'

const LANGUAGES = { arduino, bash, c, cmake, cpp, csharp, css, diff, dockerfile, dos, go, groovy, ini, java, javascript, json, kotlin, latex, less, lua, makefile, php, powershell, python, ruby, rust, scss, sql, swift, typescript, xml, yaml }
for (const [name, def] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, def)

/** Names fenced code blocks use ("```py", "```sh") that differ from the highlighter's own. */
const ALIASES: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', yml: 'yaml', html: 'xml', rs: 'rust', rb: 'ruby', cs: 'csharp', 'c++': 'cpp', ps1: 'powershell', jsonc: 'json', toml: 'ini' }

/** Beyond this the highlighter would make the preview sluggish; such files are shown as plain text. */
const MAX_CHARS = 300_000
const LONG_LINE = /[^\n]{20000}/

function canHighlight(text: string, language: string | null): language is string {
  return !!language && !!hljs.getLanguage(language) && text.length <= MAX_CHARS && !LONG_LINE.test(text)
}

/** One HTML string per line of `text` with the language's syntax colours, or null to show it as plain text. */
export function highlightLines(text: string, language: string | null): string[] | null {
  if (!canHighlight(text, language)) return null
  try {
    return splitHighlightedLines(hljs.highlight(text, { language, ignoreIllegals: true }).value)
  } catch {
    return null
  }
}

/** Colours the fenced code blocks (```lang) of already sanitised Markdown HTML. */
export function highlightMarkdownHtml(html: string): string {
  if (!html.includes('language-')) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('pre > code').forEach((el) => {
    const m = /(?:^|\s)language-([\w+#-]+)/.exec(el.className)
    if (!m) return
    const lang = ALIASES[m[1].toLowerCase()] ?? m[1].toLowerCase()
    const text = el.textContent ?? ''
    if (!canHighlight(text, lang)) return
    try {
      el.innerHTML = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
      el.classList.add('hljs')
    } catch {
      // keep the plain code block
    }
  })
  return doc.body.innerHTML
}
