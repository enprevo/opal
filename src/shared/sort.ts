import type { FileEntry, FolderPlacement, GroupBy, ItemMeta, SortSpec } from './types'
import { fileTypeLabel, kindOf } from './filetypes'
import { dirname } from './paths'

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const plainCollator = new Intl.Collator(undefined, { numeric: false, sensitivity: 'base' })

export function naturalCompare(a: string, b: string): number {
  return naturalCollator.compare(a, b)
}

export function attrString(e: Pick<FileEntry, 'isDir' | 'hidden' | 'readonly' | 'isSymlink'>): string {
  return (e.isDir ? 'd' : '-') + (e.readonly ? 'r' : '-') + (e.hidden ? 'h' : '-') + (e.isSymlink ? 'l' : '-')
}

export interface SortContext {
  placement?: FolderPlacement
  natural?: boolean
  /** Labels per path (first label id is used for sorting/grouping). */
  labels?: Record<string, string[]>
  /** Lazily computed metadata (image dimensions, folder item counts). */
  meta?: Record<string, ItemMeta>
  /** Base path used for the Path column (relative display in Flat View). */
  base?: string
}

function parentOf(p: string): string {
  return dirname(p) ?? p
}

function compareBy(a: FileEntry, b: FileEntry, spec: SortSpec, ctx: SortContext, cmp: (x: string, y: string) => number): number {
  switch (spec.column) {
    case 'size':
      return a.size - b.size
    case 'mtime':
      return a.mtime - b.mtime
    case 'ctime':
      return a.ctime - b.ctime
    case 'atime':
      return a.atime - b.atime
    case 'ext':
      return cmp(a.ext, b.ext)
    case 'type':
      return cmp(fileTypeLabel(a), fileTypeLabel(b))
    case 'attr':
      return cmp(attrString(a), attrString(b))
    case 'path':
      return cmp(parentOf(a.path), parentOf(b.path))
    case 'label': {
      const la = ctx.labels?.[a.path]?.[0] ?? '\uffff'
      const lb = ctx.labels?.[b.path]?.[0] ?? '\uffff'
      return cmp(la, lb)
    }
    case 'dimensions': {
      const ma = ctx.meta?.[a.path]
      const mb = ctx.meta?.[b.path]
      return (ma?.width ?? 0) * (ma?.height ?? 0) - (mb?.width ?? 0) * (mb?.height ?? 0)
    }
    case 'items':
      return (ctx.meta?.[a.path]?.items ?? -1) - (ctx.meta?.[b.path]?.items ?? -1)
    case 'name':
    default:
      return 0
  }
}

export function sortEntries(entries: FileEntry[], spec: SortSpec, opts: SortContext | boolean = {}): FileEntry[] {
  const ctx: SortContext = typeof opts === 'boolean' ? { placement: opts ? 'first' : 'mixed' } : opts
  const placement = ctx.placement ?? 'first'
  const cmp = ctx.natural === false ? (x: string, y: string) => plainCollator.compare(x, y) : naturalCompare
  const dir = spec.descending ? -1 : 1
  return [...entries].sort((a, b) => {
    if (placement !== 'mixed' && a.isDir !== b.isDir) return (a.isDir ? -1 : 1) * (placement === 'first' ? 1 : -1)
    const primary = compareBy(a, b, spec, ctx, cmp) * dir
    if (primary !== 0) return primary
    const byName = cmp(a.name, b.name)
    return spec.column === 'name' ? byName * dir : byName
  })
}

// ---------------------------------------------------------------------------
// Grouping ("Group By")
// ---------------------------------------------------------------------------

export interface GroupInfo {
  key: string
  label: string
  /** Sort order of the group itself. */
  order: number
}

const DAY = 86_400_000

function dateGroup(ms: number, now: number): GroupInfo {
  if (!ms) return { key: 'unknown', label: 'Unknown', order: 99 }
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const today = start.getTime()
  if (ms >= today) return { key: 'today', label: 'Today', order: 0 }
  if (ms >= today - DAY) return { key: 'yesterday', label: 'Yesterday', order: 1 }
  if (ms >= today - 7 * DAY) return { key: 'week', label: 'Earlier this week', order: 2 }
  if (ms >= today - 30 * DAY) return { key: 'month', label: 'Earlier this month', order: 3 }
  if (ms >= today - 365 * DAY) return { key: 'year', label: 'Earlier this year', order: 4 }
  return { key: 'older', label: 'A long time ago', order: 5 }
}

function sizeGroup(e: FileEntry): GroupInfo {
  if (e.isDir) return { key: 'folders', label: 'Folders', order: -1 }
  const s = e.size
  if (s === 0) return { key: 'empty', label: 'Empty (0 KB)', order: 0 }
  if (s < 16 * 1024) return { key: 'tiny', label: 'Tiny (0 – 16 KB)', order: 1 }
  if (s < 1024 * 1024) return { key: 'small', label: 'Small (16 KB – 1 MB)', order: 2 }
  if (s < 128 * 1024 * 1024) return { key: 'medium', label: 'Medium (1 – 128 MB)', order: 3 }
  if (s < 1024 * 1024 * 1024) return { key: 'large', label: 'Large (128 MB – 1 GB)', order: 4 }
  return { key: 'huge', label: 'Huge (> 1 GB)', order: 5 }
}

function nameGroup(name: string): GroupInfo {
  const c = name.charAt(0).toUpperCase()
  if (/[A-Z]/.test(c)) return { key: c, label: c, order: c.charCodeAt(0) }
  if (/[0-9]/.test(c)) return { key: '0-9', label: '0 – 9', order: 1 }
  return { key: '#', label: 'Other', order: 0 }
}

export function groupOf(e: FileEntry, by: GroupBy, ctx: SortContext & { labelNames?: Record<string, string>; now?: number } = {}): GroupInfo {
  switch (by) {
    case 'type': {
      const t = fileTypeLabel(e)
      return { key: t, label: t, order: e.isDir ? -1 : 0 }
    }
    case 'kind': {
      const k = kindOf(e)
      return { key: k.key, label: k.label, order: k.order }
    }
    case 'ext': {
      if (e.isDir) return { key: '<dir>', label: 'Folders', order: -1 }
      const x = e.ext.toLowerCase()
      return { key: x || '<none>', label: x ? `.${x}` : 'No extension', order: 0 }
    }
    case 'mtime':
      return dateGroup(e.mtime, ctx.now ?? Date.now())
    case 'size':
      return sizeGroup(e)
    case 'name':
      return nameGroup(e.name)
    case 'label': {
      const id = ctx.labels?.[e.path]?.[0]
      if (!id) return { key: '<none>', label: 'No label', order: 999 }
      return { key: id, label: ctx.labelNames?.[id] ?? id, order: 0 }
    }
    case 'none':
    default:
      return { key: '', label: '', order: 0 }
  }
}

/** Stable-sorts already sorted entries into groups (group order first, items keep their relative order). */
export function groupEntries(
  sorted: FileEntry[],
  by: GroupBy,
  ctx: SortContext & { labelNames?: Record<string, string>; now?: number } = {}
): { group: GroupInfo; entries: FileEntry[] }[] {
  if (by === 'none') return [{ group: { key: '', label: '', order: 0 }, entries: sorted }]
  const map = new Map<string, { group: GroupInfo; entries: FileEntry[] }>()
  for (const e of sorted) {
    const g = groupOf(e, by, ctx)
    const bucket = map.get(g.key)
    if (bucket) bucket.entries.push(e)
    else map.set(g.key, { group: g, entries: [e] })
  }
  return [...map.values()].sort((a, b) => a.group.order - b.group.order || naturalCompare(a.group.label, b.group.label))
}
