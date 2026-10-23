import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, Filter, FolderTree, Search, Star, X } from 'lucide-react'
import { getState, useStore, type FaytMode } from '../state/store'
import * as A from '../state/actions'
import { favoriteLabel } from '@shared/favorites'
import { favoriteEntries } from './Favorites'
import { FavoriteIconView } from './FavoriteIcon'

const MODES: { id: FaytMode; label: string; icon: typeof Search; desc: string }[] = [
  { id: 'find', label: 'Find', icon: Search, desc: 'Jump to matching names (↑/↓ for the next one)' },
  { id: 'filter', label: 'Filter', icon: Filter, desc: 'Show only matching items' },
  { id: 'deep', label: 'Subfolders', icon: FolderTree, desc: 'Search this folder and all its subfolders' }
]

const IDLE_CLOSE_MS = 6000

/** Text matched by a name, for highlighting ('' when wildcards are used). */
export function NameText({ pane, name }: { pane: 0 | 1; name: string }) {
  const q = useStore((s) => (s.fayt?.pane === pane && !s.fayt.text.startsWith('/') && !/[*?]/.test(s.fayt.text) ? s.fayt.text.trim() : ''))
  if (!q) return <>{name}</>
  const i = name.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return <>{name}</>
  return (
    <>
      {name.slice(0, i)}
      <mark className="fayt-hit">{name.slice(i, i + q.length)}</mark>
      {name.slice(i + q.length)}
    </>
  )
}

/**
 * Find-as-you-type: start typing in a file list. Find jumps to matches, Filter hides the rest, Subfolders searches
 * the whole branch; "/" lists favorites and recent folders to jump to (or type a path).
 */
export function FaytBar({ pane }: { pane: 0 | 1 }) {
  const fayt = useStore((s) => (s.fayt?.pane === pane ? s.fayt : null))
  const favorites = useStore((s) => s.favorites)
  const recent = useStore((s) => s.recent)
  useStore((s) => s.panes[pane])
  const ref = useRef<HTMLInputElement>(null)
  const [pick, setPick] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (fayt && el && document.activeElement !== el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [fayt])

  // Find mode closes by itself after a few idle seconds, like a type-to-select buffer.
  useEffect(() => {
    if (!fayt || fayt.mode !== 'find') return
    const t = setTimeout(() => void A.closeFayt(true), IDLE_CLOSE_MS)
    return () => clearTimeout(t)
  }, [fayt])

  const goto = fayt?.text.startsWith('/') ?? false
  const suggestions = useMemo(() => {
    if (!goto || !fayt) return []
    const q = fayt.text.slice(1).trim().toLowerCase()
    const favs = favoriteEntries(favorites)
      .filter(({ item, group }) => !q || favoriteLabel(item).toLowerCase().includes(q) || item.path.toLowerCase().includes(q) || group.toLowerCase().includes(q))
      .map(({ item, group }) => ({ kind: 'fav' as const, item, label: favoriteLabel(item), detail: group ? `${group} · ${item.path}` : item.path }))
    const rec = recent
      .filter((r) => !favs.some((f) => f.item.path === r) && (!q || r.toLowerCase().includes(q)))
      .slice(0, 6)
      .map((r) => ({ kind: 'recent' as const, path: r, label: r.split(/[\\/]/).filter(Boolean).pop() ?? r, detail: r }))
    return [...favs.slice(0, 10), ...rec]
  }, [goto, fayt, favorites, recent])

  useEffect(() => setPick(0), [fayt?.text])

  if (!fayt) return null
  const matches = goto ? [] : A.faytMatches(pane, fayt.text)
  const focusPath = getState().panes[pane].tabs[getState().panes[pane].activeTab].focusPath
  const index = matches.findIndex((m) => m.path === focusPath)
  const noMatch = !goto && fayt.text.trim() !== '' && matches.length === 0 && fayt.mode === 'find'

  const runGoto = (): void => {
    const s = suggestions[pick]
    void A.closeFayt(true)
    if (s?.kind === 'fav') void A.openFavorite(s.item)
    else if (s?.kind === 'recent') void A.navigate(pane, s.path)
    else if (fayt.text.length > 1) void A.navigate(pane, fayt.text.slice(1).trim() || fayt.text)
  }

  return (
    <div className={`fayt${noMatch ? ' no-match' : ''}`} data-testid={`fayt-${pane}`}>
      {goto && (
        <div className="fayt-suggest" data-testid="fayt-suggest">
          {suggestions.length === 0 && <div className="muted small pad">Type a favorite name, or a full path and Enter</div>}
          {suggestions.map((s, i) => (
            <div
              key={s.kind === 'fav' ? s.item.id : s.path}
              className={`fayt-sug${i === pick ? ' on' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                setPick(i)
              }}
              onClick={runGoto}
            >
              {s.kind === 'fav' ? <FavoriteIconView icon={s.item.icon} fallback={Star} size={13} color={s.item.color} /> : <CornerDownLeft size={13} />}
              <b style={s.kind === 'fav' ? { color: s.item.color } : undefined}>{s.label}</b>
              <span className="muted ellipsis">{s.detail}</span>
              {s.kind === 'fav' && s.item.key && <kbd className="sb-key">{s.item.key}</kbd>}
            </div>
          ))}
        </div>
      )}
      <div className="fayt-modes">
        {goto ? (
          <span className="fayt-mode on">
            <Star size={12} /> Go to
          </span>
        ) : (
          MODES.map((m) => (
            <button
              key={m.id}
              className={`fayt-mode${fayt.mode === m.id ? ' on' : ''}`}
              title={`${m.desc} (Tab cycles)`}
              data-testid={`fayt-mode-${m.id}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void A.setFaytMode(m.id)}
            >
              <m.icon size={12} /> {m.label}
            </button>
          ))
        )}
      </div>
      <input
        ref={ref}
        className="fayt-input"
        data-testid="fayt-input"
        value={fayt.text}
        spellCheck={false}
        onChange={(e) => {
          if (!e.target.value) void A.closeFayt(false)
          else A.setFaytText(e.target.value)
        }}
        onBlur={() => {
          if (getState().fayt?.mode === 'find') void A.closeFayt(true)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') {
            e.preventDefault()
            void A.closeFayt(false)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (goto) return runGoto()
            if ((e.ctrlKey || e.metaKey) && fayt.mode !== 'deep') return void A.setFaytMode('deep')
            const s = getState()
            const tab = s.panes[pane].tabs[s.panes[pane].activeTab]
            const entry = A.faytMatches(pane, fayt.text).find((m) => m.path === tab.focusPath) ?? A.faytMatches(pane, fayt.text)[0]
            void A.closeFayt(true)
            if (entry) void A.openEntry(pane, entry)
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'F3') {
            e.preventDefault()
            const dir = e.key === 'ArrowUp' || (e.key === 'F3' && e.shiftKey) ? -1 : 1
            if (goto) setPick((p) => Math.max(0, Math.min(suggestions.length - 1, p + dir)))
            else A.faytStep(dir)
          } else if (['Home', 'End', 'PageUp', 'PageDown'].includes(e.key) && !goto && !e.shiftKey) {
            // Navigation keys end the search and act on the list.
            e.preventDefault()
            void A.closeFayt(true)
            const move = e.key === 'Home' ? 'home' : e.key === 'End' ? 'end' : e.key === 'PageUp' ? -20 : 20
            A.moveFocus(pane, move, { shift: false, ctrl: false })
          } else if (e.key === 'Tab' && !goto) {
            e.preventDefault()
            const order: FaytMode[] = ['find', 'filter', 'deep']
            void A.setFaytMode(order[(order.indexOf(fayt.mode) + (e.shiftKey ? 2 : 1)) % 3])
          }
        }}
      />
      {!goto && (
        <span className="fayt-count" data-testid="fayt-count">
          {fayt.text.trim() ? (matches.length ? `${index >= 0 ? `${index + 1} of ` : ''}${matches.length}` : 'No match') : ''}
        </span>
      )}
      <span className="fayt-hint muted">{goto ? '↑↓ choose · Enter go' : '↑↓ next · Tab mode · Ctrl+Enter subfolders · Enter open'}</span>
      <button className="icon-btn" title="Close (Esc)" onMouseDown={(e) => e.preventDefault()} onClick={() => void A.closeFayt(false)}>
        <X size={13} />
      </button>
    </div>
  )
}
