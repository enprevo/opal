/**
 * Path helpers usable from both the renderer (no Node `path`) and main.
 * They accept either separator and infer the style from the input.
 */
export type PathStyle = 'win' | 'posix'

export function detectStyle(p: string): PathStyle {
  return /^[a-zA-Z]:/.test(p) || p.startsWith('\\\\') ? 'win' : 'posix'
}

export function sepFor(style: PathStyle): string {
  return style === 'win' ? '\\' : '/'
}

/** Index of the last separator. On POSIX a backslash is a legal filename character, not a separator. */
function lastSep(p: string, style: PathStyle): number {
  return style === 'win' ? Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) : p.lastIndexOf('/')
}

export function normalize(p: string): string {
  const style = detectStyle(p)
  if (style === 'win') {
    let s = p.replace(/\//g, '\\')
    const unc = s.startsWith('\\\\')
    s = s.replace(/\\{2,}/g, '\\')
    if (unc) s = '\\' + s
    if (/^[a-zA-Z]:$/.test(s)) s += '\\'
    if (s.length > 3 && s.endsWith('\\') && !isRoot(s)) s = s.slice(0, -1)
    return s.charAt(0).toUpperCase() + s.slice(1)
  }
  let s = p.replace(/\/{2,}/g, '/')
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1)
  return s || '/'
}

export function isRoot(p: string): boolean {
  if (/^[a-zA-Z]:[\\/]?$/.test(p)) return true
  if (p === '/') return true
  if (/^\\\\[^\\]+\\[^\\]+\\?$/.test(p)) return true
  return false
}

export function join(base: string, ...parts: string[]): string {
  const style = detectStyle(base)
  const sep = sepFor(style)
  let out = base
  for (const part of parts) {
    if (!part) continue
    const clean = (style === 'win' ? part.replace(/[\\/]+/g, sep) : part.replace(/\/{2,}/g, '/')).replace(new RegExp(`^\\${sep}+`), '')
    out = out.endsWith(sep) ? out + clean : out + sep + clean
  }
  return out
}

export function basename(p: string): string {
  const style = detectStyle(p)
  const n = style === 'win' ? p.replace(/[\\/]+$/, '') : p.replace(/\/+$/, '')
  if (isRoot(p)) return p
  const idx = lastSep(n, style)
  return idx === -1 ? n : n.slice(idx + 1)
}

export function dirname(p: string): string | null {
  if (isRoot(p)) return null
  const style = detectStyle(p)
  const n = style === 'win' ? p.replace(/[\\/]+$/, '') : p.replace(/\/+$/, '')
  const idx = lastSep(n, style)
  if (idx === -1) return null
  const head = n.slice(0, idx)
  if (style === 'win') {
    if (/^[a-zA-Z]:$/.test(head)) return head + '\\'
    if (/^\\\\[^\\]+$/.test(head)) return null
    return head
  }
  return head === '' ? '/' : head
}

export function extname(name: string): string {
  const base = basename(name)
  const idx = base.lastIndexOf('.')
  if (idx <= 0) return ''
  return base.slice(idx + 1)
}

export function stem(name: string): string {
  const ext = extname(name)
  return ext ? name.slice(0, name.length - ext.length - 1) : name
}

export interface Crumb {
  label: string
  path: string
}

export function breadcrumbs(p: string): Crumb[] {
  const crumbs: Crumb[] = []
  let cur: string | null = normalize(p)
  while (cur) {
    crumbs.unshift({ label: isRoot(cur) ? cur.replace(/[\\/]$/, '') || '/' : basename(cur), path: cur })
    cur = dirname(cur)
  }
  return crumbs
}

export function isAncestor(ancestor: string, child: string): boolean {
  const a = normalize(ancestor)
  const c = normalize(child)
  const win = detectStyle(a) === 'win'
  const A = win ? a.toLowerCase() : a
  const C = win ? c.toLowerCase() : c
  if (A === C) return false
  const sep = sepFor(detectStyle(a))
  return C.startsWith(A.endsWith(sep) ? A : A + sep)
}

export function samePath(a: string, b: string): boolean {
  const na = normalize(a)
  const nb = normalize(b)
  return detectStyle(na) === 'win' ? na.toLowerCase() === nb.toLowerCase() : na === nb
}

const INVALID_WIN = /[<>:"/\\|?*\u0000-\u001f]/
const RESERVED_WIN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

export function validateFileName(name: string, style: PathStyle): string | null {
  if (!name || !name.trim()) return 'Name cannot be empty'
  if (name === '.' || name === '..') return 'Invalid name'
  if (style === 'win') {
    if (INVALID_WIN.test(name)) return 'Name contains invalid characters: < > : " / \\ | ? *'
    if (RESERVED_WIN.test(name)) return 'Name is reserved by the system'
    if (/[. ]$/.test(name)) return 'Name cannot end with a dot or space'
  } else if (name.includes('/') || name.includes('\u0000')) {
    return 'Name cannot contain "/"'
  }
  return null
}
