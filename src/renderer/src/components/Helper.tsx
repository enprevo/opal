import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { activeTab, getState, useStore } from '../state/store'
import type { FileEntry } from '@shared/types'
import { formatDate, formatSize } from '@shared/format'
import { fileTypeLabel, IMAGE_EXTENSIONS } from '@shared/filetypes'
import { dirname } from '@shared/paths'
import { FileIcon, thumbUrl } from './FileIcon'
import { requestMeta } from '../state/actions'

/**
 * Helper popups ("infotips"): a card shown beside the element under the mouse, never on top of it.
 *
 * Any element can opt in with:
 *   data-help-title / data-help-desc / data-help-keys   generic help card
 *   data-help-path                                       file infotip (name, kind, size, dates, labels…)
 *   data-help-place="below" | "side"                     preferred placement (default: side)
 * Menus place the card beside the whole menu so it never hides other items.
 */
interface HelpContent {
  title?: string
  desc?: string
  keys?: string
  path?: string
}

interface Placement {
  left: number
  top: number
  side: 'left' | 'right' | 'below' | 'above'
}

const GAP = 10

function findHelpTarget(el: Element | null): HTMLElement | null {
  // closest() also works when the event target is an SVG icon inside a button.
  const hit = el?.closest?.('[data-help-title],[data-help-desc],[data-help-path]')
  return hit instanceof HTMLElement ? hit : null
}

function contentOf(el: HTMLElement): HelpContent {
  return { title: el.dataset.helpTitle, desc: el.dataset.helpDesc, keys: el.dataset.helpKeys, path: el.dataset.helpPath }
}

/** Rect the card must not cover: menus protect the whole menu, rows protect the item. */
function protectedRect(el: HTMLElement): DOMRect {
  const menu = el.closest('.context-menu')
  if (menu) {
    const m = menu.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    return new DOMRect(m.left, r.top, m.width, r.height)
  }
  const anchor = el.querySelector<HTMLElement>('[data-help-anchor]')
  const base = el.getBoundingClientRect()
  if (anchor && el.classList.contains('row')) {
    // In Details view keep the card right next to the name, but never on the row's icon+name.
    const a = anchor.getBoundingClientRect()
    return new DOMRect(base.left, base.top, Math.max(0, a.right - base.left), base.height)
  }
  return base
}

export function placeCard(target: DOMRect, card: { width: number; height: number }, viewport: { width: number; height: number }, prefer: string | undefined): Placement {
  const fitsRight = target.right + GAP + card.width <= viewport.width - 4
  const fitsLeft = target.left - GAP - card.width >= 4
  const fitsBelow = target.bottom + GAP + card.height <= viewport.height - 4
  const clampY = (y: number): number => Math.max(4, Math.min(viewport.height - card.height - 4, y))
  const clampX = (x: number): number => Math.max(4, Math.min(viewport.width - card.width - 4, x))
  if (prefer === 'below') {
    if (fitsBelow) return { left: clampX(target.left + target.width / 2 - card.width / 2), top: target.bottom + GAP, side: 'below' }
    return { left: clampX(target.left + target.width / 2 - card.width / 2), top: Math.max(4, target.top - GAP - card.height), side: 'above' }
  }
  if (fitsRight) return { left: target.right + GAP, top: clampY(target.top + target.height / 2 - card.height / 2), side: 'right' }
  if (fitsLeft) return { left: target.left - GAP - card.width, top: clampY(target.top + target.height / 2 - card.height / 2), side: 'left' }
  if (fitsBelow) return { left: clampX(target.left), top: target.bottom + GAP, side: 'below' }
  return { left: clampX(target.left), top: Math.max(4, target.top - GAP - card.height), side: 'above' }
}

function findEntry(path: string): FileEntry | null {
  const s = getState()
  for (const pane of [0, 1] as const) {
    const t = activeTab(pane, s)
    const hit = t.listing?.entries.find((e) => e.path === path) ?? Object.values(t.children).flat().find((e) => e.path === path)
    if (hit) return hit
  }
  return null
}

export function HelperLayer() {
  const enabled = useStore((s) => s.prefs.helpers || s.prefs.infotips)
  const delay = useStore((s) => s.prefs.helperDelay)
  const [content, setContent] = useState<HelpContent | null>(null)
  const [pos, setPos] = useState<Placement | null>(null)
  const targetRef = useRef<HTMLElement | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled) return
    const hide = (): void => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      targetRef.current = null
      setContent(null)
      setPos(null)
    }
    const over = (e: MouseEvent): void => {
      const t = findHelpTarget(e.target as Element)
      if (t === targetRef.current) return
      hide()
      if (!t) return
      const prefs = getState().prefs
      const isFile = !!t.dataset.helpPath
      if ((isFile && !prefs.infotips) || (!isFile && !prefs.helpers)) return
      targetRef.current = t
      timer.current = setTimeout(() => {
        if (targetRef.current !== t || !t.isConnected) return
        setContent(contentOf(t))
      }, isFile ? Math.max(delay, 700) : delay)
    }
    window.addEventListener('mouseover', over, true)
    window.addEventListener('mousedown', hide, true)
    window.addEventListener('keydown', hide, true)
    window.addEventListener('wheel', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      window.removeEventListener('mouseover', over, true)
      window.removeEventListener('mousedown', hide, true)
      window.removeEventListener('keydown', hide, true)
      window.removeEventListener('wheel', hide, true)
      window.removeEventListener('blur', hide)
      hide()
    }
  }, [enabled, delay])

  useLayoutEffect(() => {
    const t = targetRef.current
    const card = cardRef.current
    if (!content || !t || !card) return
    const r = card.getBoundingClientRect()
    setPos(placeCard(protectedRect(t), { width: r.width, height: r.height }, { width: window.innerWidth, height: window.innerHeight }, t.dataset.helpPlace))
  }, [content])

  if (!enabled || !content) return null
  return (
    <div
      ref={cardRef}
      className={`helper-card${pos ? ` side-${pos.side}` : ''}${content.path ? ' file' : ''}`}
      data-testid="helper-card"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      {content.path ? <FileInfotip path={content.path} /> : <GenericHelp content={content} />}
    </div>
  )
}

function GenericHelp({ content }: { content: HelpContent }) {
  return (
    <>
      {content.title && <div className="helper-title">{content.title}</div>}
      {content.desc && <div className="helper-desc">{content.desc}</div>}
      {content.keys && (
        <div className="helper-keys">
          {content.keys.split(' / ').map((k) => (
            <kbd key={k}>{k}</kbd>
          ))}
        </div>
      )}
    </>
  )
}

function FileInfotip({ path }: { path: string }) {
  const prefs = useStore((s) => s.prefs)
  const meta = useStore((s) => s.meta[path])
  const labels = useStore((s) => s.labels[path])
  const labelDefs = useStore((s) => s.labelDefs)
  const e = findEntry(path)
  useEffect(() => {
    if (e && (e.isDir || IMAGE_EXTENSIONS.has(e.ext.toLowerCase()))) requestMeta([path])
  }, [e, path])
  if (!e) return null
  const isImage = IMAGE_EXTENSIONS.has(e.ext.toLowerCase())
  return (
    <div className="infotip">
      <div className="infotip-head">
        {isImage ? <img className="infotip-thumb" src={thumbUrl(path, 128)} alt="" /> : <FileIcon path={path} isDir={e.isDir} size={32} />}
        <div className="infotip-name">{e.name}</div>
      </div>
      <table>
        <tbody>
          <tr>
            <th>Kind</th>
            <td>{fileTypeLabel(e)}</td>
          </tr>
          {!e.isDir && (
            <tr>
              <th>Size</th>
              <td>{formatSize(e.size, prefs.sizeUnits)}</td>
            </tr>
          )}
          {e.isDir && meta?.items !== undefined && (
            <tr>
              <th>Contains</th>
              <td>{meta.items} items</td>
            </tr>
          )}
          {meta?.width && (
            <tr>
              <th>Dimensions</th>
              <td>
                {meta.width} × {meta.height}
              </td>
            </tr>
          )}
          <tr>
            <th>Modified</th>
            <td>{formatDate(e.mtime, prefs.dateFormat, prefs.customDateFormat)}</td>
          </tr>
          <tr>
            <th>Created</th>
            <td>{formatDate(e.ctime, prefs.dateFormat, prefs.customDateFormat)}</td>
          </tr>
          {e.depth ? (
            <tr>
              <th>In</th>
              <td>{dirname(e.path)}</td>
            </tr>
          ) : null}
          {labels?.length ? (
            <tr>
              <th>Labels</th>
              <td>{labels.map((id) => labelDefs.find((l) => l.id === id)?.name ?? id).join(', ')}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className="infotip-hint">Space: Quick Look · F2: rename</div>
    </div>
  )
}
