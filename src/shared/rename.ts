import { wildcardToRegexSource } from './wildcard'
import { extname, stem, validateFileName, type PathStyle } from './paths'

export type RenameMode = 'standard' | 'regex' | 'findreplace'
export type CaseMode = 'none' | 'lower' | 'upper' | 'title' | 'sentence' | 'lowerExt' | 'upperExt'

export interface RenameOptions {
  mode: RenameMode
  oldPattern: string
  newPattern: string
  caseMode?: CaseMode
  caseSensitive?: boolean
  /** Ignore the extension when matching/renaming (operate on the stem only). */
  ignoreExtension?: boolean
  numberStart?: number
  numberStep?: number
  numberPad?: number
  /** For find & replace: replace every occurrence (true) or only the first. */
  replaceAll?: boolean
  /** Clock used by {date|…}/{time|…} macros (defaults to now). */
  now?: number
}

/** Formats a date with .NET-style tokens: yyyy yy MM M dd d HH H hh h mm ss tt. */
export function formatDateTime(d: Date, fmt: string): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  const tokens: Record<string, () => string> = {
    yyyy: () => String(d.getFullYear()),
    yy: () => p(d.getFullYear() % 100),
    MM: () => p(d.getMonth() + 1),
    M: () => String(d.getMonth() + 1),
    dd: () => p(d.getDate()),
    d: () => String(d.getDate()),
    HH: () => p(d.getHours()),
    H: () => String(d.getHours()),
    hh: () => p(d.getHours() % 12 || 12),
    h: () => String(d.getHours() % 12 || 12),
    mm: () => p(d.getMinutes()),
    ss: () => p(d.getSeconds()),
    tt: () => (d.getHours() < 12 ? 'AM' : 'PM')
  }
  return fmt.replace(/yyyy|yy|MM|M|dd|d|HH|H|hh|h|mm|ss|tt/g, (t) => tokens[t]())
}

export interface RenameInput {
  name: string
  mtime?: number
}

export interface RenamePreview {
  oldName: string
  newName: string
  changed: boolean
  error?: string
}

function applyCase(name: string, mode: CaseMode | undefined): string {
  if (!mode || mode === 'none') return name
  const ext = extname(name)
  const base = stem(name)
  switch (mode) {
    case 'lower':
      return name.toLowerCase()
    case 'upper':
      return name.toUpperCase()
    case 'title': {
      const t = base.toLowerCase().replace(/(^|[\s_\-.([])(\p{L})/gu, (_, p, c: string) => p + c.toUpperCase())
      return ext ? `${t}.${ext}` : t
    }
    case 'sentence': {
      const lower = base.toLowerCase()
      const t = lower.charAt(0).toUpperCase() + lower.slice(1)
      return ext ? `${t}.${ext}` : t
    }
    case 'lowerExt':
      return ext ? `${base}.${ext.toLowerCase()}` : name
    case 'upperExt':
      return ext ? `${base}.${ext.toUpperCase()}` : name
  }
}

/**
 * Standard wildcard rename: each `*` / `?` in the old pattern captures text that is
 * substituted, in order, into the corresponding `*` / `?` of the new pattern.
 * Example: old="*.jpeg" new="* - photo.jpg" renames "a.jpeg" to "a - photo.jpg".
 */
function standardRename(name: string, oldPattern: string, newPattern: string, caseSensitive: boolean): string | null {
  const parts: string[] = []
  let source = ''
  let i = 0
  while (i < oldPattern.length) {
    const c = oldPattern[i]
    if (c === '*') {
      source += '(.*?)'
      parts.push('*')
      i++
    } else if (c === '?') {
      source += '(.)'
      parts.push('?')
      i++
    } else {
      let j = i
      while (j < oldPattern.length && oldPattern[j] !== '*' && oldPattern[j] !== '?') j++
      source += wildcardToRegexSource(oldPattern.slice(i, j).replace(/[#[\]()~']/g, (m) => "'" + m))
      i = j
    }
  }
  const re = new RegExp(`^${source}$`, caseSensitive ? 'u' : 'iu')
  const m = re.exec(name)
  if (!m) return null
  const captures = m.slice(1)
  let k = 0
  let out = ''
  for (const c of newPattern) {
    if ((c === '*' || c === '?') && k < captures.length) out += captures[k++]
    else if (c === '*') out += ''
    else out += c
  }
  return out
}

function expandMacros(template: string, input: RenameInput, index: number, opts: RenameOptions): string {
  const start = opts.numberStart ?? 1
  const step = opts.numberStep ?? 1
  const n = start + index * step
  return template
    .replace(/\[#+\]/g, (m) => String(n).padStart(Math.max(opts.numberPad ?? 0, m.length - 2), '0'))
    .replace(/\{name\}/gi, stem(input.name))
    .replace(/\{ext\}/gi, extname(input.name))
    .replace(/\{date\}/gi, () => formatDateTime(new Date(input.mtime ?? Date.now()), 'yyyy-MM-dd'))
    .replace(/\{(date|time|modified)\|([^}]+)\}/gi, (_m, kind: string, fmt: string) =>
      formatDateTime(new Date(kind.toLowerCase() === 'modified' ? input.mtime ?? Date.now() : opts.now ?? Date.now()), fmt)
    )
}

export function computeRename(input: RenameInput, index: number, opts: RenameOptions): string | null {
  const caseSensitive = opts.caseSensitive ?? false
  const ext = extname(input.name)
  const target = opts.ignoreExtension && ext ? stem(input.name) : input.name
  let result: string | null

  switch (opts.mode) {
    case 'regex': {
      if (!opts.oldPattern) return null
      // A trailing unescaped "#" repeats the substitution until the name stops changing.
      const repeat = /(^|[^\\])#$/.test(opts.oldPattern)
      const source = repeat ? opts.oldPattern.slice(0, -1) : opts.oldPattern
      const re = new RegExp(source, caseSensitive ? 'u' : 'iu')
      if (!re.test(target)) return null
      // Accept both \1 and JavaScript-style $1 back-references.
      const replacement = opts.newPattern.replace(/\\(\d)/g, '$$$1')
      let out = target.replace(re, replacement)
      for (let i = 0; repeat && i < 100 && re.test(out); i++) {
        const next: string = out.replace(re, replacement)
        if (next === out) break
        out = next
      }
      result = out
      break
    }
    case 'findreplace': {
      if (!opts.oldPattern) {
        result = target
        break
      }
      const escaped = opts.oldPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const flags = (caseSensitive ? '' : 'i') + (opts.replaceAll === false ? '' : 'g')
      const re = new RegExp(escaped, flags)
      if (!re.test(target)) return null
      re.lastIndex = 0
      result = target.replace(re, () => opts.newPattern)
      break
    }
    case 'standard':
    default: {
      const oldP = opts.oldPattern || '*'
      const newP = opts.newPattern || '*'
      result = standardRename(target, oldP, newP, caseSensitive)
      break
    }
  }
  if (result === null) return null
  result = expandMacros(result, input, index, opts)
  if (opts.ignoreExtension && ext) result = `${result}.${ext}`
  return applyCase(result, opts.caseMode)
}

export function previewRename(inputs: RenameInput[], opts: RenameOptions, style: PathStyle): RenamePreview[] {
  let regexError: string | undefined
  const results: RenamePreview[] = inputs.map((input, i) => {
    let newName: string | null = null
    try {
      newName = computeRename(input, i, opts)
    } catch (e) {
      regexError = (e as Error).message
    }
    if (newName === null) return { oldName: input.name, newName: input.name, changed: false }
    return { oldName: input.name, newName, changed: newName !== input.name }
  })
  if (regexError) return results.map((r) => ({ ...r, changed: false, error: regexError }))

  const fold = (s: string): string => (style === 'win' ? s.toLowerCase() : s)
  const finalNames = new Map<string, number>()
  for (const r of results) finalNames.set(fold(r.newName), (finalNames.get(fold(r.newName)) ?? 0) + 1)
  for (const r of results) {
    if (!r.changed) continue
    const invalid = validateFileName(r.newName, style)
    if (invalid) r.error = invalid
    else if ((finalNames.get(fold(r.newName)) ?? 0) > 1) r.error = 'Duplicate name'
  }
  return results
}
