import { formatDateTime } from './rename'

const UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB']

export function formatSize(bytes: number, mode: 'auto' | 'bytes' = 'auto'): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (mode === 'bytes') return bytes.toLocaleString('en-US') + ' bytes'
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`
  let v = bytes
  let u = 0
  while (v >= 1024 && u < UNITS.length - 1) {
    v /= 1024
    u++
  }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2
  return `${v.toFixed(digits)} ${UNITS[u]}`
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0')
}

export function formatDate(ms: number, mode: 'locale' | 'iso' | 'relative' | 'custom' = 'locale', custom = 'yyyy-MM-dd HH:mm', now = Date.now()): string {
  if (!ms) return ''
  const d = new Date(ms)
  if (mode === 'iso') {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  if (mode === 'custom') return formatDateTime(d, custom || 'yyyy-MM-dd HH:mm')
  if (mode === 'relative') {
    const diff = now - ms
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    if (diff >= 0 && diff < 60_000) return 'Just now'
    if (diff >= 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    if (ms >= today.getTime()) return `Today ${time}`
    if (ms >= today.getTime() - 86_400_000) return `Yesterday ${time}`
    if (ms >= today.getTime() - 6 * 86_400_000) return `${d.toLocaleDateString(undefined, { weekday: 'long' })} ${time}`
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function pluralize(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}
