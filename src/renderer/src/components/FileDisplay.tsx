import { useEffect, useRef, useState } from 'react'
import { X, Plus, ArrowLeft, ArrowRight, ArrowUp, ChevronRight, Filter } from 'lucide-react'
import { activeTab, findVisible, getState, setState, useStore, visibleEntries } from '../state/store'
import * as A from '../state/actions'
import { breadcrumbs, basename } from '@shared/paths'
import { formatSize, pluralize } from '@shared/format'
import { FileList } from './FileList'

export function FileDisplay({ pane }: { pane: 0 | 1 }) {
  const isSource = useStore((s) => s.activePane === pane)
  const dual = useStore((s) => s.prefs.dualDisplay)
  const showStatus = useStore((s) => s.prefs.showStatusBar)
  return (
    <div
      className={`file-display ${isSource ? 'is-source' : 'is-dest'}`}
      data-pane={pane}
      data-testid={`pane-${pane}`}
      onMouseDownCapture={() => A.setActivePane(pane)}
    >
      <TabBar pane={pane} />
      <LocationBar pane={pane} dual={dual} isSource={isSource} />
      <FileList pane={pane} />
      {showStatus && <DisplayStatus pane={pane} />}
    </div>
  )
}

function TabBar({ pane }: { pane: 0 | 1 }) {
  const ps = useStore((s) => s.panes[pane])
  const [dragOver, setDragOver] = useState<number | null>(null)
  return (
    <div className="tab-bar" onDoubleClick={(e) => e.target === e.currentTarget && A.newTab(pane)}>
      {ps.tabs.map((t, i) => (
        <div
          key={t.id}
          className={`tab${i === ps.activeTab ? ' active' : ''}${dragOver === i ? ' drop' : ''}`}
          title={t.path}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault()
              A.closeTab(pane, t.id)
            } else A.switchTab(pane, i)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(i)
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(null)
            const paths = readDragPaths(e.dataTransfer)
            if (paths.length) void A.dropPaths(paths, t.path, { ctrl: e.ctrlKey, shift: e.shiftKey })
          }}
        >
          <span className="tab-label">{t.path ? basename(t.path) || t.path : '…'}</span>
          {ps.tabs.length > 1 && (
            <button
              className="tab-close"
              onMouseDown={(e) => {
                e.stopPropagation()
                A.closeTab(pane, t.id)
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}
      <button className="tab-new" title="New tab (Ctrl+T)" onClick={() => A.newTab(pane)}>
        <Plus size={14} />
      </button>
    </div>
  )
}

export function readDragPaths(dt: DataTransfer): string[] {
  const internal = dt.getData('application/x-opal-paths')
  if (internal) {
    try {
      return JSON.parse(internal) as string[]
    } catch {
      return []
    }
  }
  const out: string[] = []
  for (const f of Array.from(dt.files)) {
    const p = window.opal.pathForFile(f)
    if (p) out.push(p)
  }
  return out
}

function LocationBar({ pane, dual, isSource }: { pane: 0 | 1; dual: boolean; isSource: boolean }) {
  const navLock = useStore((s) => s.navLock)
  const tab = useStore((s) => activeTab(pane, s))
  const editing = useStore((s) => s.editingPath === pane)
  const [text, setText] = useState(tab.path)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setText(tab.path)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing, tab.path])

  const crumbs = tab.path ? breadcrumbs(tab.path) : []
  const crumbsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = crumbsRef.current
    if (!el) return
    const toEnd = (): void => {
      el.scrollLeft = el.scrollWidth
    }
    toEnd()
    const ro = new ResizeObserver(toEnd)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tab.path, tab.loading, editing])

  return (
    <div className="location-bar">
      <div className="nav-btns">
        <button title="Back" disabled={tab.historyIndex <= 0} onClick={() => A.goHistory(pane, -1)}>
          <ArrowLeft size={14} />
        </button>
        <button title="Forward" disabled={tab.historyIndex >= tab.history.length - 1} onClick={() => A.goHistory(pane, 1)}>
          <ArrowRight size={14} />
        </button>
        <button title="Up" onClick={() => A.goUp(pane)}>
          <ArrowUp size={14} />
        </button>
      </div>
      {editing ? (
        <input
          ref={inputRef}
          className="path-input"
          data-testid={`path-input-${pane}`}
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setState({ editingPath: null })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setState({ editingPath: null })
              void A.navigate(pane, text)
            } else if (e.key === 'Escape') setState({ editingPath: null })
          }}
        />
      ) : (
        <div
          ref={crumbsRef}
          className="breadcrumbs"
          data-testid={`breadcrumbs-${pane}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) setState({ editingPath: pane })
          }}
        >
          {crumbs.map((c, i) => (
            <span key={c.path} className="crumb-wrap">
              {i > 0 && <ChevronRight size={12} className="crumb-sep" />}
              <button
                className="crumb"
                onClick={() => void A.navigate(pane, c.path)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const paths = readDragPaths(e.dataTransfer)
                  if (paths.length) void A.dropPaths(paths, c.path, { ctrl: e.ctrlKey, shift: e.shiftKey })
                }}
              >
                {c.label}
              </button>
            </span>
          ))}
          {tab.loading && <span className="spinner" />}
        </div>
      )}
      <FilterBox pane={pane} />
      {dual && navLock && (
        <span className="nav-lock-badge" title="Navigation Lock: both displays move together">
          LOCK
        </span>
      )}
      {dual && (
        <span
          className={`src-dest-badge ${isSource ? 'src' : 'dest'}`}
          title={isSource ? 'Source (active) — Tab switches' : 'Destination — click to make source'}
        >
          {isSource ? 'SOURCE' : 'DEST'}
        </span>
      )}
    </div>
  )
}

function FilterBox({ pane }: { pane: 0 | 1 }) {
  const filter = useStore((s) => activeTab(pane, s).filter)
  return (
    <div className={`filter-box${filter ? ' active' : ''}`}>
      <Filter size={12} />
      <input
        className="filter-input"
        data-testid={`filter-${pane}`}
        placeholder="Filter"
        value={filter}
        spellCheck={false}
        onChange={(e) => A.setTabProps(pane, { filter: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            A.setTabProps(pane, { filter: '' })
            ;(e.target as HTMLInputElement).blur()
          } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
            ;(e.target as HTMLInputElement).blur()
            focusList(pane)
          }
          e.stopPropagation()
        }}
      />
      {filter && (
        <button className="filter-clear" onClick={() => A.setTabProps(pane, { filter: '' })}>
          <X size={11} />
        </button>
      )}
    </div>
  )
}

export function focusList(pane: 0 | 1): void {
  document.querySelector<HTMLElement>(`[data-pane="${pane}"] .file-scroll`)?.focus()
}

function DisplayStatus({ pane }: { pane: 0 | 1 }) {
  const tab = useStore((s) => activeTab(pane, s))
  const prefs = useStore((s) => s.prefs)
  const entries = visibleEntries(tab, prefs)
  let dirs = 0
  let files = 0
  let bytes = 0
  let selDirs = 0
  let selFiles = 0
  let selBytes = 0
  for (const e of entries) {
    if (e.isDir) dirs++
    else files++
    bytes += e.size
    if (tab.selected.has(e.path)) {
      if (e.isDir) selDirs++
      else selFiles++
      selBytes += e.size
    }
  }
  const total = tab.listing?.entries.length ?? 0
  const hiddenCount = tab.viewMode === 'columns' || tab.expanded.size ? 0 : total - entries.length
  return (
    <div className="display-status" data-testid={`status-${pane}`}>
      <span>
        {selDirs + selFiles > 0
          ? `${selDirs + selFiles} of ${entries.length} selected (${formatSize(selBytes, prefs.sizeUnits)})`
          : `${pluralize(dirs, 'folder', 'folders')}, ${pluralize(files, 'file', 'files')} (${formatSize(bytes, prefs.sizeUnits)})`}
      </span>
      {hiddenCount > 0 && <span className="muted">{hiddenCount} hidden/filtered</span>}
      <span className="spacer" />
      {tab.listing?.freeBytes !== undefined && (
        <span className="muted">
          {formatSize(tab.listing.freeBytes)} free of {formatSize(tab.listing.totalBytes ?? 0)}
        </span>
      )}
    </div>
  )
}

export function getFocusedEntry(pane: 0 | 1) {
  const s = getState()
  const tab = activeTab(pane, s)
  return findVisible(tab, s.prefs, tab.focusPath)
}
