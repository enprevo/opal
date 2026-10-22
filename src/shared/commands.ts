import { formatDateTime } from './rename'

/**
 * Parser for the internal command language.
 *
 *   Copy MOVE TO="{destpath}"
 *   Go UP
 *   Select PATTERN=*.txt DESELECTNOMATCH
 *   Set VIEW=thumbnails
 *
 * Each non-empty line is one command; `//` starts a comment line. Argument keys are
 * case-insensitive and normalised to upper case. Bare words become boolean flags.
 */
export interface ParsedCommand {
  name: string
  args: Record<string, string | true>
  /** Bare (non key=value) tokens with original case, e.g. a path in `Go "C:\Dir"`. */
  positional: string[]
  raw: string
}

export function tokenize(line: string): string[] {
  const tokens: string[] = []
  let cur = ''
  let inQuote = false
  let hasToken = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"'
        i++
        continue
      }
      inQuote = !inQuote
      hasToken = true
      continue
    }
    if (!inQuote && /\s/.test(c)) {
      if (hasToken) tokens.push(cur)
      cur = ''
      hasToken = false
      continue
    }
    cur += c
    hasToken = true
  }
  if (inQuote) throw new Error('Unterminated quote')
  if (hasToken) tokens.push(cur)
  return tokens
}

export function parseCommandLine(line: string): ParsedCommand | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('//')) return null
  const tokens = tokenize(trimmed)
  if (tokens.length === 0) return null
  const [name, ...rest] = tokens
  const args: Record<string, string | true> = {}
  const positional: string[] = []
  for (const t of rest) {
    const eq = t.indexOf('=')
    if (eq > 0 && /^[A-Za-z_]+$/.test(t.slice(0, eq))) args[t.slice(0, eq).toUpperCase()] = t.slice(eq + 1)
    else {
      args[t.toUpperCase()] = true
      positional.push(t)
    }
  }
  return { name: name.toLowerCase(), args, positional, raw: trimmed }
}

export function parseCommands(script: string): ParsedCommand[] {
  return script
    .split(/\r?\n/)
    .map(parseCommandLine)
    .filter((c): c is ParsedCommand => c !== null)
}

export interface CommandContext {
  sourcepath: string
  destpath: string
  /** Full paths of selected items (or the focused item if nothing selected). */
  selected: string[]
  focused?: string
  now?: number
}

/** Expand placeholders such as {sourcepath}, {destpath}, {filepath}, {file}, {allfilepath}. */
export function expandPlaceholders(text: string, ctx: CommandContext): string {
  const first = ctx.selected[0] ?? ctx.focused ?? ''
  const quoteAll = ctx.selected.map((p) => `"${p}"`).join(' ')
  const name = first.split(/[\\/]/).pop() ?? ''
  return text
    .replace(/\{sourcepath\}/gi, ctx.sourcepath)
    .replace(/\{s\}/gi, ctx.sourcepath)
    .replace(/\{destpath\}/gi, ctx.destpath)
    .replace(/\{d\}/gi, ctx.destpath)
    .replace(/\{filepath\}/gi, first)
    .replace(/\{f\}/gi, first)
    .replace(/\{file\}/gi, name)
    .replace(/\{o\}/gi, name)
    .replace(/\{allfilepath\}/gi, quoteAll)
    .replace(/\{(date|time)\|([^}]+)\}/gi, (_m, _k: string, fmt: string) => formatDateTime(new Date(ctx.now ?? Date.now()), fmt))
}

export function argString(args: Record<string, string | true>, key: string): string | undefined {
  const v = args[key.toUpperCase()]
  return typeof v === 'string' ? v : undefined
}

export function argFlag(args: Record<string, string | true>, key: string): boolean {
  const v = args[key.toUpperCase()]
  return v === true || (typeof v === 'string' && /^(on|yes|true|1)$/i.test(v))
}
