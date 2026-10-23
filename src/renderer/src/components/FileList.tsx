import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Check,
  Columns3,
  ArrowDownAZ,
  Group,
  MoveHorizontal,
  RotateCcw,
  FolderOpen
} from 'lucide-react'
import {
  activeColumnDir,
  activeTab,
  displayRows,
  getState,
  prepareList,
  setState,
  treeMode,
  updateTab,
  useStore,
  visibleEntries,
  type DisplayRow,
  type TabState
} from '../state/store'
import * as A from '../state/actions'
import type { FileEntry, GroupBy, LabelDef, Prefs, SortColumn } from '@shared/types'
import { formatDate, formatSize, pluralize } from '@shared/format'
import { fileTypeLabel, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '@shared/filetypes'
import { attrString } from '@shared/sort'
import { basename, dirname, stem, validateFileName } from '@shared/paths'
import { NameText } from './FindAsYouType'
import { FileIcon, thumbUrl } from './FileIcon'
import { readDragPaths } from './FileDisplay'

interface RenderCtx {
  tab: TabState
  prefs: Prefs
  meta: ReturnType<typeof getState>['meta']
  labels: ReturnType<typeof getState>['labels']
  labelDefs: LabelDef[]
}

interface ColDef {
  label: string
  /** Short explanation shown by the helper popup. */
  desc: string
  width: number
  align?: 'right'
  needsMeta?: boolean
  defaultDescending?: boolean
  render: (e: FileEntry, c: RenderCtx) => string
}

function displayName(e: FileEntry, prefs: Prefs): string {
  return !prefs.showExtensions && !e.isDir && e.ext ? stem(e.name) : e.name
}

export const COLS: Record<SortColumn, ColDef> = {
  name: { label: 'Name', desc: 'File or folder name (natural sort: 2 before 10)', width: 300, render: (e, c) => displayName(e, c.prefs) },
  ext: { label: 'Ext', desc: 'File extension', width: 60, render: (e) => e.ext },
  size: {
    label: 'Size',
    desc: 'File size; folders show their total after "Calculate folder sizes"',
    width: 90,
    align: 'right',
    defaultDescending: true,
    render: (e, c) =>
      e.isDir ? (c.tab.sizes[e.path] !== undefined ? formatSize(c.tab.sizes[e.path], c.prefs.sizeUnits) : '') : formatSize(e.size, c.prefs.sizeUnits)
  },
  type: { label: 'Type', desc: 'Kind of file, from its extension', width: 140, render: (e) => fileTypeLabel(e) },
  mtime: { label: 'Modified', desc: 'Date the content was last modified', width: 140, defaultDescending: true, render: (e, c) => formatDate(e.mtime, c.prefs.dateFormat, c.prefs.customDateFormat) },
  ctime: { label: 'Created', desc: 'Date the item was created', width: 140, defaultDescending: true, render: (e, c) => formatDate(e.ctime, c.prefs.dateFormat, c.prefs.customDateFormat) },
  atime: { label: 'Accessed', desc: 'Date the item was last opened', width: 140, defaultDescending: true, render: (e, c) => formatDate(e.atime, c.prefs.dateFormat, c.prefs.customDateFormat) },
  attr: { label: 'Attr', desc: 'Attributes: d folder, r read-only, h hidden, l link', width: 56, render: (e) => attrString(e) },
  path: { label: 'Location', desc: 'Folder that contains the item (useful in Flat View and expanded folders)', width: 220, render: (e) => dirname(e.path) ?? '' },
  label: {
    label: 'Labels',
    desc: 'Colour labels (tags) you assigned with the context menu or Ctrl+0…7',
    width: 110,
    render: (e, c) => (c.labels[e.path] ?? []).map((id) => c.labelDefs.find((l) => l.id === id)?.name ?? id).join(', ')
  },
  dimensions: {
    label: 'Dimensions',
    desc: 'Pixel size of images (read from the file header)',
    width: 100,
    needsMeta: true,
    defaultDescending: true,
    render: (e, c) => {
      const m = c.meta[e.path]
      return m?.width && m.height ? `${m.width} × ${m.height}` : ''
    }
  },
  items: {
    label: 'Items',
    desc: 'Number of items inside a folder',
    width: 70,
    align: 'right',
    needsMeta: true,
    defaultDescending: true,
    render: (e, c) => (e.isDir && c.meta[e.path]?.items !== undefined ? String(c.meta[e.path].items) : '')
  }
}
export const ALL_COLUMNS = Object.keys(COLS) as SortColumn[]
export const COLUMN_LABELS: Record<SortColumn, string> = Object.fromEntries(ALL_COLUMNS.map((c) => [c, COLS[c].label])) as Record<SortColumn, string>

export const GROUP_OPTIONS: { id: GroupBy; label: string; desc: string }[] = [
  { id: 'none', label: 'No grouping', desc: 'Show a single flat list' },
  { id: 'kind', label: 'Kind', desc: 'Folders, Images, Documents, Code, Archives… (Finder style)' },
  { id: 'type', label: 'Type', desc: 'One group per file type' },
  { id: 'ext', label: 'Extension', desc: 'One group per extension' },
  { id: 'mtime', label: 'Date modified', desc: 'Today, Yesterday, This week, This month…' },
  { id: 'size', label: 'Size', desc: 'Empty, Tiny, Small, Medium, Large, Huge' },
  { id: 'name', label: 'Name', desc: 'A–Z by first letter' },
  { id: 'label', label: 'Label', desc: 'Grouped by colour label' }
]

/** Column widths are saved in the settings file (so they are exported and imported with everything else). */
function loadWidths(): Record<string, number> {
  return getState().ui.columnWidths ?? {}
}

function saveWidths(next: Record<string, number>): void {
  A.setUi({ columnWidths: next })
}

function useSharedWidths(): Record<string, number> {
  return useStore((s) => s.ui.columnWidths) ?? EMPTY_WIDTHS
}

const EMPTY_WIDTHS: Record<string, number> = {}

function visibleColumns(prefs: Prefs): SortColumn[] {
  const cols = prefs.columns.filter((c) => c in COLS)
  return cols.includes('name') ? cols : ['name', ...cols]
}

function gridTemplate(columns: SortColumn[], widths: Record<string, number>): string {
  return columns.map((c) => `${widths[c] ?? COLS[c].width}px`).join(' ')
}

let measureCanvas: HTMLCanvasElement | null = null
function textWidth(text: string, font: string): number {
  measureCanvas ??= document.createElement('canvas')
  const ctx = measureCanvas.getContext('2d')!
  ctx.font = font
  return ctx.measureText(text).width
}

/** Width that fits the widest visible value of a column (autosize). */
export function autosizeColumn(pane: 0 | 1, col: SortColumn): number {
  const s = getState()
  const tab = activeTab(pane, s)
  const entries = visibleEntries(tab, s.prefs).slice(0, 3000)
  const ctx: RenderCtx = { tab, prefs: s.prefs, meta: s.meta, labels: s.labels, labelDefs: s.labelDefs }
  const font = `${(13 * s.prefs.fontScale) / 100}px ${getComputedStyle(document.body).fontFamily}`
  let w = textWidth(COLS[col].label, font) + 30
  for (const e of entries) {
    const extra = col === 'name' ? 46 + (e.depth ?? 0) * 16 : 18
    w = Math.max(w, textWidth(COLS[col].render(e, ctx), font) + extra)
  }
  return Math.min(900, Math.ceil(w))
}

export function autosizeAll(pane: 0 | 1): void {
  const next = { ...loadWidths() }
  for (const c of visibleColumns(getState().prefs)) next[c] = autosizeColumn(pane, c)
  saveWidths(next)
}

// "Set AUTOSIZECOLUMNS" (sent by the command handler, which can't import this component module).
window.addEventListener('opal-autosize', (e) => autosizeAll((e as CustomEvent<0 | 1>).detail))

export function FileList({ pane }: { pane: 0 | 1 }) {
  const tab = useStore((s) => activeTab(pane, s))
  const prefs = useStore((s) => s.prefs)
  const isSource = useStore((s) => s.activePane === pane)
  const clipboard = useStore((s) => s.clipboard)
  const labels = useStore((s) => s.labels)
  const labelDefs = useStore((s) => s.labelDefs)
  const meta = useStore((s) => s.meta)
  const entries = visibleEntries(tab, prefs)
  const rowsData = displayRows(tab, prefs)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [size, setSize] = useState({ w: 600, h: 400 })
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const pendingClick = useRef<FileEntry | null>(null)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const mode = tab.viewMode
  const layout = useMemo(() => {
    const scale = prefs.fontScale / 100
    const rowH = Math.round(A.ROW_HEIGHTS[prefs.density] * scale)
    if (mode === 'details') return { cellW: size.w, cellH: rowH, cols: 1, header: A.ROW_HEIGHTS[prefs.density] }
    const cell =
      mode === 'list'
        ? { w: Math.round(240 * scale), h: rowH }
        : mode === 'icons'
          ? { w: Math.round(96 * scale), h: Math.round(84 * scale) }
          : { w: Math.round(156 * scale), h: Math.round(156 * scale) }
    return { cellW: cell.w, cellH: cell.h, cols: Math.max(1, Math.floor((size.w - 8) / cell.w)), header: 0 }
  }, [mode, size.w, prefs.fontScale, prefs.density])

  // Details view renders rows (items + group headers); other views render entries.
  const useRows = mode === 'details'
  const count = useRows ? rowsData.length : entries.length
  const rows = Math.ceil(count / layout.cols)

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !tab.focusPath || mode === 'columns') return
    const idx = useRows ? rowsData.findIndex((r) => r.entry?.path === tab.focusPath) : entries.findIndex((e) => e.path === tab.focusPath)
    if (idx < 0) return
    const row = Math.floor(idx / layout.cols)
    const top = row * layout.cellH
    const bottom = top + layout.cellH
    const viewH = el.clientHeight - layout.header
    if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + viewH) el.scrollTop = bottom - viewH
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.scrollTick, layout.cols, layout.cellH])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [tab.path, tab.id])

  const firstRow = Math.max(0, Math.floor(scrollTop / layout.cellH) - 4)
  const lastRow = Math.min(rows, Math.ceil((scrollTop + size.h) / layout.cellH) + 4)

  // Lazily read metadata for columns that need it (dimensions, item counts).
  const columns = visibleColumns(prefs)
  const metaCols = mode === 'details' && (columns.some((c) => COLS[c].needsMeta) || tab.sort.column === 'dimensions' || tab.sort.column === 'items')
  useEffect(() => {
    if (!metaCols) return
    const from = firstRow * layout.cols
    const slice = useRows ? rowsData.slice(from, from + 120).flatMap((r) => (r.entry ? [r.entry.path] : [])) : entries.slice(from, from + 120).map((e) => e.path)
    const all = tab.sort.column === 'dimensions' || tab.sort.column === 'items' ? entries.map((e) => e.path) : slice
    A.requestMeta(all)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaCols, firstRow, entries, tab.sort.column])

  const cutSet = clipboard?.cut ? new Set(clipboard.paths) : null
  const ctx: RenderCtx = { tab, prefs, meta, labels, labelDefs }

  const onItemMouseDown = (e: React.MouseEvent, entry: FileEntry): void => {
    if (e.button === 2) {
      if (!tab.selected.has(entry.path)) A.clickEntry(pane, entry, { ctrl: false, shift: false })
      return
    }
    if (e.button !== 0) return
    scrollRef.current?.focus()
    const mods = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }
    if (tab.selected.has(entry.path) && !mods.ctrl && !mods.shift) pendingClick.current = entry
    else {
      pendingClick.current = null
      A.clickEntry(pane, entry, mods)
    }
  }
  const onItemClick = (e: React.MouseEvent, entry: FileEntry): void => {
    if (pendingClick.current === entry) {
      pendingClick.current = null
      A.clickEntry(pane, entry, { ctrl: false, shift: false })
    }
    if (prefs.singleClickOpen && !e.ctrlKey && !e.shiftKey && !e.metaKey) void A.openEntry(pane, entry)
  }
  const onItemDouble = (e: React.MouseEvent, entry: FileEntry): void => {
    if (!prefs.singleClickOpen) void A.openEntry(pane, entry, e.shiftKey)
  }
  const onDragStart = (e: React.DragEvent, entry: FileEntry): void => {
    pendingClick.current = null
    let sel = activeTab(pane).selected
    if (!sel.has(entry.path)) {
      A.clickEntry(pane, entry, { ctrl: false, shift: false })
      sel = new Set([entry.path])
    }
    const paths = entries.filter((x) => sel.has(x.path)).map((x) => x.path)
    e.dataTransfer.setData('application/x-opal-paths', JSON.stringify(paths))
    e.dataTransfer.setData('text/plain', paths.join('\n'))
    e.dataTransfer.effectAllowed = 'copyMove'
  }
  const onDropOn = (e: React.DragEvent, dest: string): void => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    const paths = readDragPaths(e.dataTransfer)
    if (paths.length) void A.dropPaths(paths, dest, { ctrl: e.ctrlKey, shift: e.shiftKey })
  }
  const onContextMenu = (e: React.MouseEvent, entry: FileEntry | null): void => {
    e.preventDefault()
    e.stopPropagation()
    A.setActivePane(pane)
    setState({ contextMenu: { x: e.clientX, y: e.clientY, pane, target: entry } })
  }

  const itemProps = (entry: FileEntry) => ({
    'data-path': entry.path,
    'data-help-path': prefs.infotips ? entry.path : undefined,
    draggable: tab.renaming !== entry.path,
    onMouseDown: (e: React.MouseEvent) => onItemMouseDown(e, entry),
    onClick: (e: React.MouseEvent) => onItemClick(e, entry),
    onDoubleClick: (e: React.MouseEvent) => onItemDouble(e, entry),
    onDragStart: (e: React.DragEvent) => onDragStart(e, entry),
    onContextMenu: (e: React.MouseEvent) => onContextMenu(e, entry),
    onDragOver: entry.isDir
      ? (e: React.DragEvent) => {
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = e.shiftKey ? 'move' : 'copy'
          if (dropTarget !== entry.path) setDropTarget(entry.path)
        }
      : undefined,
    onDragLeave: entry.isDir ? () => setDropTarget((d) => (d === entry.path ? null : d)) : undefined,
    onDrop: entry.isDir ? (e: React.DragEvent) => onDropOn(e, entry.path) : undefined
  })

  const cls = (entry: FileEntry, index: number): string =>
    [
      'item',
      tab.selected.has(entry.path) && 'selected',
      tab.focusPath === entry.path && 'focused',
      entry.hidden && 'hidden-item',
      cutSet?.has(entry.path) && 'cut',
      dropTarget === entry.path && 'drop-target',
      entry.isDir && 'dir',
      index % 2 === 1 && 'odd'
    ]
      .filter(Boolean)
      .join(' ')

  if (mode === 'columns') {
    return (
      <ColumnView
        pane={pane}
        tab={tab}
        prefs={prefs}
        ctx={ctx}
        cls={cls}
        itemProps={itemProps}
        isSource={isSource}
        onContextMenu={onContextMenu}
        onDropOn={onDropOn}
      />
    )
  }

  const items: React.ReactElement[] = []
  if (useRows) {
    for (let i = firstRow; i < Math.min(rowsData.length, lastRow); i++) {
      const r = rowsData[i]
      if (r.kind === 'group') items.push(<GroupHeader key={`g-${r.group!.key}`} row={r} top={i * layout.cellH} height={layout.cellH} pane={pane} />)
      else
        items.push(
          <DetailsRow
            key={r.entry!.path}
            entry={r.entry!}
            top={i * layout.cellH}
            height={layout.cellH}
            pane={pane}
            ctx={ctx}
            className={cls(r.entry!, i)}
            itemProps={itemProps(r.entry!)}
          />
        )
    }
  } else {
    for (let i = firstRow * layout.cols; i < Math.min(entries.length, lastRow * layout.cols); i++) {
      const e = entries[i]
      items.push(
        <GridCell
          key={e.path}
          entry={e}
          mode={mode}
          pane={pane}
          prefs={prefs}
          labels={labels[e.path]}
          labelDefs={labelDefs}
          renaming={tab.renaming === e.path}
          style={{
            position: 'absolute',
            top: Math.floor(i / layout.cols) * layout.cellH,
            left: 4 + (i % layout.cols) * layout.cellW,
            width: layout.cellW - 4,
            height: layout.cellH - (mode === 'list' ? 0 : 4)
          }}
          className={cls(e, i)}
          itemProps={itemProps(e)}
        />
      )
    }
  }

  return (
    <div
      ref={scrollRef}
      className={`file-scroll view-${mode}${isSource ? ' source' : ''}`}
      style={prefs.fontScale !== 100 ? { fontSize: `${(13 * prefs.fontScale) / 100}px` } : undefined}
      tabIndex={0}
      data-testid={`list-${pane}`}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('list-canvas')) {
          scrollRef.current?.focus()
          if (e.button === 0) A.clickEntry(pane, null, { ctrl: e.ctrlKey, shift: e.shiftKey })
        }
      }}
      onContextMenu={(e) => onContextMenu(e, null)}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = e.shiftKey ? 'move' : 'copy'
      }}
      onDrop={(e) => onDropOn(e, tab.path)}
    >
      {mode === 'details' && <DetailsHeader pane={pane} tab={tab} prefs={prefs} width={size.w} height={layout.header} />}
      {tab.error && !tab.listing && <div className="list-message error">{tab.error}</div>}
      {tab.listing && entries.length === 0 && <div className="list-message">{tab.filter ? 'No items match the filter' : 'This folder is empty'}</div>}
      <div className={`list-canvas${mode !== 'details' ? ' grid-view' : ''}`} data-columns={layout.cols} style={{ height: rows * layout.cellH, position: 'relative' }}>
        {items}
      </div>
    </div>
  )
}

function GroupHeader({ row, top, height, pane }: { row: DisplayRow; top: number; height: number; pane: 0 | 1 }) {
  return (
    <div
      className="group-header"
      data-testid="group-header"
      style={{ top, height }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => A.toggleGroup(pane, row.group!.key)}
    >
      {row.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
      <span className="group-label">{row.group!.label}</span>
      <span className="group-count">{pluralize(row.count ?? 0, 'item', 'items')}</span>
      <span className="group-line" />
    </div>
  )
}

function DetailsHeader({ pane, tab, prefs, width, height }: { pane: 0 | 1; tab: TabState; prefs: Prefs; width: number; height: number }) {
  const widths = useSharedWidths()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [dragCol, setDragCol] = useState<SortColumn | null>(null)
  const columns = visibleColumns(prefs)
  const setWidth = (c: string, w: number): void => saveWidths({ ...loadWidths(), [c]: w })
  return (
    <div
      className="details-header"
      style={{ gridTemplateColumns: gridTemplate(columns, widths), minWidth: width, height }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {columns.map((c) => (
        <div
          key={c}
          data-testid={`hcell-${c}`}
          data-help-title={`${COLS[c].label} column`}
          data-help-desc={`${COLS[c].desc}. Click to sort, click again to reverse. Drag to reorder, right-click for more columns and grouping.`}
          data-help-place="below"
          className={`hcell${COLS[c].align === 'right' ? ' right' : ''}${tab.sort.column === c ? ' sorted' : ''}${dragCol && dragCol !== c ? ' drop-col' : ''}`}
          draggable
          onDragStart={(e) => {
            setDragCol(c)
            e.dataTransfer.setData('application/x-opal-column', c)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => setDragCol(null)}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/x-opal-column')) {
              e.preventDefault()
              e.stopPropagation()
            }
          }}
          onDrop={(e) => {
            const from = e.dataTransfer.getData('application/x-opal-column') as SortColumn
            if (!from) return
            e.preventDefault()
            e.stopPropagation()
            setDragCol(null)
            const next = columns.filter((x) => x !== from)
            next.splice(next.indexOf(c), 0, from)
            A.setPrefs({ columns: next })
          }}
          onClick={() =>
            A.setFormat(pane, {
              sort: { column: c, descending: tab.sort.column === c ? !tab.sort.descending : !!COLS[c].defaultDescending }
            })
          }
        >
          <span>{COLS[c].label}</span>
          {tab.sort.column === c && (tab.sort.descending ? <ChevronDown size={12} /> : <ChevronUp size={12} />)}
          <div
            className="col-resize"
            title="Drag to resize, double-click to fit contents"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              e.stopPropagation()
              setWidth(c, autosizeColumn(pane, c))
            }}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const startX = e.clientX
              const startW = widths[c] ?? COLS[c].width
              const move = (ev: MouseEvent): void => setWidth(c, Math.max(40, startW + ev.clientX - startX))
              const up = (): void => {
                window.removeEventListener('mousemove', move)
                window.removeEventListener('mouseup', up)
              }
              window.addEventListener('mousemove', move)
              window.addEventListener('mouseup', up)
            }}
          />
        </div>
      ))}
      {menu && <ColumnMenu x={menu.x} y={menu.y} pane={pane} tab={tab} columns={columns} onClose={() => setMenu(null)} />}
    </div>
  )
}

function ColumnMenu({ x, y, pane, tab, columns, onClose }: { x: number; y: number; pane: 0 | 1; tab: TabState; columns: SortColumn[]; onClose: () => void }) {
  useEffect(() => {
    const h = (): void => onClose()
    setTimeout(() => window.addEventListener('mousedown', h), 0)
    return () => window.removeEventListener('mousedown', h)
  }, [onClose])
  const item = (key: string, icon: React.ReactElement, label: string, desc: string, active: boolean, action: () => void) => (
    <div key={key} className="cm-item" data-help-title={label} data-help-desc={desc} data-help-place="side" onClick={() => {
      action()
      onClose()
    }}>
      <span className="cm-icon">{icon}</span>
      <span className="cm-label">{label}</span>
      <span className="cm-check">{active ? <Check size={13} /> : null}</span>
    </div>
  )
  return (
    <div className="context-menu column-menu" data-testid="column-menu" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="cm-section">
        <Columns3 size={12} /> Columns
      </div>
      {ALL_COLUMNS.filter((c) => c !== 'name').map((c) =>
        item(`c-${c}`, <span className="cm-dot" />, COLS[c].label, COLS[c].desc, columns.includes(c), () => {
          const has = columns.includes(c)
          A.setPrefs({ columns: has ? columns.filter((v) => v !== c) : [...columns, c] })
        })
      )}
      <div className="cm-sep" />
      <div className="cm-section">
        <Group size={12} /> Group by
      </div>
      {GROUP_OPTIONS.map((g) => item(`g-${g.id}`, <span className="cm-dot" />, g.label, g.desc, tab.groupBy === g.id, () => A.setFormat(pane, { groupBy: g.id })))}
      <div className="cm-sep" />
      {item('autosize', <MoveHorizontal size={14} />, 'Autosize all columns', 'Fit every column to its widest value', false, () => autosizeAll(pane))}
      {item('reset', <RotateCcw size={14} />, 'Reset column widths', 'Restore the default width of every column', false, () => saveWidths({}))}
      {item('reverse', <ArrowDownAZ size={14} />, tab.sort.descending ? 'Sort ascending' : 'Sort descending', 'Reverse the current sort order', false, () =>
        A.setFormat(pane, { sort: { ...tab.sort, descending: !tab.sort.descending } })
      )}
    </div>
  )
}

function LabelDots({ ids, defs }: { ids?: string[]; defs: LabelDef[] }) {
  if (!ids?.length) return null
  return (
    <span className="label-dots" data-testid="label-dots">
      {ids.map((id) => (
        <span key={id} className="label-dot" style={{ background: defs.find((d) => d.id === id)?.color ?? '#888' }} />
      ))}
    </span>
  )
}

interface RowProps {
  entry: FileEntry
  top: number
  height: number
  pane: 0 | 1
  ctx: RenderCtx
  className: string
  itemProps: Record<string, unknown>
}

function DetailsRow({ entry, top, height, pane, ctx, className, itemProps }: RowProps) {
  const widths = useSharedWidths()
  const { tab, prefs } = ctx
  const columns = visibleColumns(prefs)
  const tree = treeMode(tab, prefs)
  return (
    <div className={`${className} row`} style={{ top, height, gridTemplateColumns: gridTemplate(columns, widths) }} {...itemProps}>
      {columns.map((c) =>
        c === 'name' ? (
          <div key={c} className="cell name-cell" style={tree ? { paddingLeft: 2 + (entry.depth ?? 0) * 18 } : undefined}>
            {tree && (
              <span
                className={`expander${entry.isDir ? '' : ' leaf'}`}
                data-testid={entry.isDir ? 'expander' : undefined}
                onMouseDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  if (!entry.isDir) return
                  if (tab.expanded.has(entry.path)) A.collapseFolder(pane, entry.path)
                  else void A.expandFolder(pane, entry.path, { recursive: e.shiftKey })
                }}
              >
                {entry.isDir && (tab.expanded.has(entry.path) ? <ChevronDown size={16} strokeWidth={2.4} /> : <ChevronRight size={16} strokeWidth={2.4} />)}
              </span>
            )}
            <FileIcon path={entry.path} isDir={entry.isDir} />
            {tab.renaming === entry.path ? (
              <RenameInput pane={pane} entry={entry} />
            ) : (
              <span className="name-text" data-help-anchor="">
                <NameText pane={pane} name={displayName(entry, prefs)} />
              </span>
            )}
            {c === 'name' && !columns.includes('label') && <LabelDots ids={ctx.labels[entry.path]} defs={ctx.labelDefs} />}
          </div>
        ) : c === 'label' ? (
          <div key={c} className="cell">
            <LabelDots ids={ctx.labels[entry.path]} defs={ctx.labelDefs} />
            <span className="muted"> {COLS.label.render(entry, ctx)}</span>
          </div>
        ) : (
          <div key={c} className={`cell${COLS[c].align === 'right' ? ' right' : ''}`}>
            {COLS[c].render(entry, ctx)}
          </div>
        )
      )}
    </div>
  )
}

function GridCell({
  entry,
  mode,
  pane,
  prefs,
  labels,
  labelDefs,
  renaming,
  style,
  className,
  itemProps
}: {
  entry: FileEntry
  mode: string
  pane: 0 | 1
  prefs: Prefs
  labels?: string[]
  labelDefs: LabelDef[]
  renaming: boolean
  style: React.CSSProperties
  className: string
  itemProps: Record<string, unknown>
}) {
  const [thumbFailed, setThumbFailed] = useState(false)
  const ext = entry.ext.toLowerCase()
  const wantsThumb = mode === 'thumbnails' && !entry.isDir && (IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext) || ext === 'pdf')
  return (
    <div className={`${className} cell-${mode}`} style={style} {...itemProps}>
      <div className="thumb">
        {wantsThumb && !thumbFailed ? (
          <img src={thumbUrl(entry.path, 256)} loading="lazy" draggable={false} alt="" onError={() => setThumbFailed(true)} />
        ) : (
          <FileIcon path={entry.path} isDir={entry.isDir} size={mode === 'list' ? 16 : mode === 'icons' ? 40 : 64} />
        )}
      </div>
      {renaming ? (
        <RenameInput pane={pane} entry={entry} />
      ) : (
        <div className="label" data-help-anchor="">
          <NameText pane={pane} name={displayName(entry, prefs)} />
          <LabelDots ids={labels} defs={labelDefs} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Column view (Finder-style Miller columns)
// ---------------------------------------------------------------------------

function ColumnView({
  pane,
  tab,
  prefs,
  ctx,
  cls,
  itemProps,
  isSource,
  onContextMenu,
  onDropOn
}: {
  pane: 0 | 1
  tab: TabState
  prefs: Prefs
  ctx: RenderCtx
  cls: (e: FileEntry, i: number) => string
  itemProps: (e: FileEntry) => Record<string, unknown>
  isSource: boolean
  onContextMenu: (e: React.MouseEvent, entry: FileEntry | null) => void
  onDropOn: (e: React.DragEvent, dest: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const active = activeColumnDir(tab)
  // Chain of folders from the tab root to the active column.
  const chain: string[] = []
  {
    let cur: string | null = active
    while (cur && cur.length >= tab.path.length) {
      chain.unshift(cur)
      if (cur === tab.path) break
      cur = dirname(cur)
    }
    if (chain[0] !== tab.path) chain.splice(0, chain.length, tab.path)
  }
  const listFor = (dir: string): FileEntry[] => prepareList(tab, prefs, dir === tab.path ? tab.listing?.entries ?? [] : tab.children[dir] ?? [])
  // Resolve the focused item from the same live list the active column renders.
  const focused = tab.focusPath ? listFor(active).find((e) => e.path === tab.focusPath) ?? null : null
  const previewDir = focused?.isDir ? focused.path : null

  useEffect(() => {
    if (previewDir && !tab.children[previewDir]) void A.loadColumn(pane, previewDir)
  }, [previewDir, pane, tab.children])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [chain.length, previewDir])

  const columns = [...chain, ...(previewDir ? [previewDir] : [])]

  return (
    <div
      ref={scrollRef}
      className={`file-scroll column-view${isSource ? ' source' : ''}`}
      tabIndex={0}
      data-testid={`list-${pane}`}
      onContextMenu={(e) => onContextMenu(e, null)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => onDropOn(e, active)}
    >
      {columns.map((dir, ci) => {
        const list = listFor(dir)
        const selectedChild = ci < chain.length - 1 ? chain[ci + 1] : ci === chain.length - 1 ? tab.focusPath : null
        return (
          <div key={dir} className={`mcol${dir === active ? ' active' : ''}`} data-testid="mcol">
            {list.length === 0 && <div className="mcol-empty">{tab.children[dir] || dir === tab.path ? 'Empty folder' : 'Loading…'}</div>}
            {list.map((e, i) => {
              const inActive = dir === active
              const base = inActive ? cls(e, i) : `item${e.path === selectedChild ? ' path-selected' : ''}${e.isDir ? ' dir' : ''}`
              const props = inActive
                ? itemProps(e)
                : {
                    'data-path': e.path,
                    onMouseDown: () => A.clickEntry(pane, e, { ctrl: false, shift: false }),
                    onDoubleClick: () => void A.openEntry(pane, e),
                    onContextMenu: (ev: React.MouseEvent) => onContextMenu(ev, e)
                  }
              return (
                <div key={e.path} className={`${base} mrow`} {...props}>
                  <FileIcon path={e.path} isDir={e.isDir} />
                  <span className="name-text">
                    <NameText pane={pane} name={displayName(e, prefs)} />
                  </span>
                  <LabelDots ids={ctx.labels[e.path]} defs={ctx.labelDefs} />
                  {e.isDir && <ChevronRight size={12} className="mrow-arrow" />}
                </div>
              )
            })}
          </div>
        )
      })}
      {focused && !focused.isDir && <ColumnPreview entry={focused} prefs={prefs} />}
      {!focused && !tab.listing?.entries.length && (
        <div className="mcol-empty">
          <FolderOpen size={16} /> Empty folder
        </div>
      )}
    </div>
  )
}

function ColumnPreview({ entry, prefs }: { entry: FileEntry; prefs: Prefs }) {
  const ext = entry.ext.toLowerCase()
  const img = IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext) || ext === 'pdf'
  return (
    <div className="mcol mcol-preview" data-testid="column-preview">
      <div className="mprev-thumb">{img ? <img src={thumbUrl(entry.path, 512)} alt="" draggable={false} /> : <FileIcon path={entry.path} isDir={false} size={96} />}</div>
      <div className="mprev-name">{entry.name}</div>
      <div className="muted">
        {fileTypeLabel(entry)} · {formatSize(entry.size, prefs.sizeUnits)}
      </div>
      <table className="mprev-info">
        <tbody>
          <tr>
            <th>Created</th>
            <td>{formatDate(entry.ctime, prefs.dateFormat, prefs.customDateFormat)}</td>
          </tr>
          <tr>
            <th>Modified</th>
            <td>{formatDate(entry.mtime, prefs.dateFormat, prefs.customDateFormat)}</td>
          </tr>
        </tbody>
      </table>
      <div className="muted small">Space for Quick Look</div>
    </div>
  )
}

function RenameInput({ pane, entry }: { pane: 0 | 1; entry: FileEntry }) {
  const ref = useRef<HTMLInputElement>(null)
  const original = basename(entry.path)
  const [value, setValue] = useState(original)
  const done = useRef(false)
  const style = getState().info.platform === 'win32' ? 'win' : 'posix'
  const error = value !== original ? validateFileName(value, style) : null

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const s = entry.isDir ? original : stem(original)
    el.setSelectionRange(0, s.length || original.length)
  }, [entry, original])

  const finish = (commit: boolean): void => {
    if (done.current) return
    done.current = true
    if (commit && !error) void A.commitInlineRename(pane, entry.path, value.trim())
    else updateTab(pane, null, () => ({ renaming: null }))
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-pane="${pane}"] .file-scroll`)?.focus())
  }

  return (
    <input
      ref={ref}
      className={`rename-input${error ? ' invalid' : ''}`}
      data-testid="rename-input"
      title={error ?? ''}
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(true)
        else if (e.key === 'Escape') finish(false)
      }}
      onBlur={() => finish(true)}
    />
  )
}

export function visibleCount(pane: 0 | 1): number {
  const s = getState()
  return visibleEntries(activeTab(pane, s), s.prefs).length
}
