/**
 * Wildcard patterns, compiled to RegExp.
 *
 * Supported syntax:
 *   *        any sequence of characters
 *   ?        any single character
 *   #x       zero or more repetitions of x (x may be a char, set or group)
 *   [abc]    character set, [a-z] ranges, [~abc] negated set
 *   (a|b)    alternation
 *   ~(pat)   negation of a sub-pattern (or ~pat for the whole pattern)
 *   'x       escape the next character literally
 *   a;b      list of alternative patterns
 *   regex:…  raw JavaScript regular expression
 */
export interface MatchOptions {
  caseSensitive?: boolean
}

const REGEX_SPECIAL = /[\\^$.*+?()[\]{}|/]/

function escapeChar(c: string): string {
  return REGEX_SPECIAL.test(c) ? '\\' + c : c
}

class Compiler {
  private i = 0
  constructor(private readonly src: string) {}

  compile(): string {
    const out = this.sequence(false)
    return out
  }

  private sequence(inGroup: boolean): string {
    let out = ''
    while (this.i < this.src.length) {
      const c = this.src[this.i]
      if (inGroup && (c === '|' || c === ')')) break
      out += this.atom()
    }
    return out
  }

  private atom(): string {
    const c = this.src[this.i++]
    switch (c) {
      case '*':
        return '.*'
      case '?':
        return '.'
      case "'": {
        const next = this.src[this.i++]
        return next === undefined ? "'" : escapeChar(next)
      }
      case '#': {
        if (this.i >= this.src.length) return '#'
        const inner = this.atom()
        return `(?:${inner})*`
      }
      case '~': {
        if (this.src[this.i] === '(') {
          this.i++
          const alts = this.alternatives()
          // Negative lookahead consuming the remainder of the segment, implementing ~(x) (not x).
          return `(?:(?!(?:${alts})$).*)`
        }
        return escapeChar('~')
      }
      case '(': {
        const alts = this.alternatives()
        return `(?:${alts})`
      }
      case '[':
        return this.charSet()
      default:
        return escapeChar(c)
    }
  }

  private alternatives(): string {
    const parts: string[] = []
    for (;;) {
      parts.push(this.sequence(true))
      const c = this.src[this.i]
      if (c === '|') {
        this.i++
        continue
      }
      if (c === ')') this.i++
      break
    }
    return parts.join('|')
  }

  private charSet(): string {
    const end = this.src.indexOf(']', this.i)
    if (end === -1) return '\\['
    let body = this.src.slice(this.i, end)
    this.i = end + 1
    let negate = false
    if (body.startsWith('~') || body.startsWith('!') || body.startsWith('^')) {
      negate = true
      body = body.slice(1)
    }
    const escaped = body.replace(/[\\\]^]/g, (m) => '\\' + m)
    return `[${negate ? '^' : ''}${escaped}]`
  }
}

export function wildcardToRegexSource(pattern: string): string {
  return new Compiler(pattern).compile()
}

export function compilePattern(pattern: string, opts: MatchOptions = {}): (name: string) => boolean {
  const flags = opts.caseSensitive ? 'u' : 'iu'
  const trimmed = pattern.trim()
  if (trimmed === '' || trimmed === '*') return () => true

  if (trimmed.toLowerCase().startsWith('regex:')) {
    const re = new RegExp(trimmed.slice(6), flags)
    return (name) => re.test(name)
  }

  const pieces = splitTopLevel(trimmed, ';').filter((p) => p.trim() !== '')
  const positives: RegExp[] = []
  const negatives: RegExp[] = []
  for (const piece of pieces) {
    const p = piece.trim()
    if (p.startsWith('~') && !p.startsWith('~(')) {
      negatives.push(new RegExp(`^(?:${wildcardToRegexSource(p.slice(1))})$`, flags))
    } else {
      positives.push(new RegExp(`^(?:${wildcardToRegexSource(p)})$`, flags))
    }
  }
  return (name) => {
    if (negatives.some((re) => re.test(name))) return false
    if (positives.length === 0) return true
    return positives.some((re) => re.test(name))
  }
}

export function matchesPattern(name: string, pattern: string, opts: MatchOptions = {}): boolean {
  return compilePattern(pattern, opts)(name)
}

export function isWildcard(text: string): boolean {
  return /[*?#[\]()~;]/.test(text) || text.toLowerCase().startsWith('regex:')
}

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === "'" && i + 1 < s.length) {
      cur += c + s[++i]
      continue
    }
    if (c === '(' || c === '[') depth++
    else if ((c === ')' || c === ']') && depth > 0) depth--
    if (c === sep && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}
