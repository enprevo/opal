import { useEffect, useState } from 'react'

const cache = new Map<string, string>()
const pending = new Map<string, Promise<string>>()

export type IconSize = 'small' | 'normal' | 'large'

function keyFor(path: string, size: IconSize): string {
  const m = /\.[^.\\/]+$/.exec(path)
  const ext = m ? m[0].toLowerCase() : ''
  return (['.exe', '.lnk', '.ico', '.url', '.app', ''].includes(ext) ? path : ext) + '|' + size
}

/** Native file-type icon (folders use a built-in icon for a consistent look on every platform). */
export function useFileIcon(path: string, isDir: boolean, size: IconSize = 'small'): string | undefined {
  const key = isDir ? '' : keyFor(path, size)
  const [url, setUrl] = useState<string | undefined>(() => cache.get(key))
  useEffect(() => {
    if (isDir) return
    const hit = cache.get(key)
    if (hit !== undefined) {
      setUrl(hit)
      return
    }
    let alive = true
    let p = pending.get(key)
    if (!p) {
      p = window.opal.icon(path, false, size).then((u) => {
        cache.set(key, u)
        pending.delete(key)
        return u
      })
      pending.set(key, p)
    }
    void p.then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [key, path, isDir, size])
  return url
}

const FOLDER_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#e8b84a" d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/></svg>'
  )
const FILE_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#9aa4b2" d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path fill="#c8ced8" d="M14 2v6h6"/></svg>'
  )

export function FileIcon({ path, isDir, size = 16 }: { path: string; isDir: boolean; size?: number }) {
  const url = useFileIcon(path, isDir, size > 24 ? 'large' : 'small')
  const src = url || (isDir ? FOLDER_SVG : FILE_SVG)
  return <img className="file-icon" src={src} width={size} height={size} draggable={false} alt="" />
}

export function thumbUrl(path: string, size: number): string {
  return `opal://thumb/?p=${encodeURIComponent(path)}&s=${size}`
}

export function fileUrl(path: string): string {
  return `opal://file/?p=${encodeURIComponent(path)}`
}
