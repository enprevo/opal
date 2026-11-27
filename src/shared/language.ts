/** Maps files to the syntax-highlighting language used by the preview (highlight.js language names). */

const BY_EXT: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  jsonc: 'json',
  xml: 'xml',
  svg: 'xml',
  html: 'xml',
  htm: 'xml',
  xhtml: 'xml',
  vue: 'xml',
  svelte: 'xml',
  plist: 'xml',
  csproj: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  ino: 'arduino',
  cs: 'csharp',
  java: 'java',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  lua: 'lua',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  bat: 'dos',
  cmd: 'dos',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  properties: 'ini',
  editorconfig: 'ini',
  diff: 'diff',
  patch: 'diff',
  gradle: 'groovy',
  tex: 'latex',
  mk: 'makefile',
  makefile: 'makefile',
  dockerfile: 'dockerfile',
  cmake: 'cmake'
}

/** Files known by their whole name (no extension to go by). */
const BY_NAME: Record<string, string> = {
  makefile: 'makefile',
  gnumakefile: 'makefile',
  dockerfile: 'dockerfile',
  'cmakelists.txt': 'cmake'
}

const SHEBANG: [RegExp, string][] = [
  [/^#!.*\b(bash|sh|zsh|dash|ash)\b/, 'bash'],
  [/^#!.*\bpython[\d.]*\b/, 'python'],
  [/^#!.*\b(node|nodejs|deno|bun)\b/, 'javascript'],
  [/^#!.*\bruby\b/, 'ruby'],
  [/^#!.*\bphp\b/, 'php'],
  [/^#!.*\blua\b/, 'lua']
]

/**
 * Language of a file from its name and extension, or null when it is plain text (txt, log, csv…).
 * Files without a known name or extension are recognised by a `#!` line when `firstLine` is given.
 */
export function languageFor(name: string, ext: string, firstLine?: string): string | null {
  const byName = BY_NAME[name.toLowerCase()]
  if (byName) return byName
  const e = ext.toLowerCase()
  if (e && BY_EXT[e]) return BY_EXT[e]
  if (!e && firstLine) for (const [re, lang] of SHEBANG) if (re.test(firstLine)) return lang
  return null
}

/**
 * Splits highlighted HTML (only `<span class>` tags and escaped text) into one HTML string per source line.
 * A token that runs over several lines, such as a block comment, is closed at the end of each line and opened
 * again on the next, so every line is valid HTML on its own.
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = []
  const open: string[] = []
  let cur = ''
  for (const tok of html.match(/<span[^>]*>|<\/span>|\n|[^<\n]+/g) ?? []) {
    if (tok === '\n') {
      cur += '</span>'.repeat(open.length)
      lines.push(cur)
      cur = open.join('')
    } else {
      if (tok.startsWith('<span')) open.push(tok)
      else if (tok === '</span>') open.pop()
      cur += tok
    }
  }
  lines.push(cur)
  return lines
}
