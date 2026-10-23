import { useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CircleOff,
  ExternalLink,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  Keyboard,
  Minus,
  Palette,
  PanelRightOpen,
  PencilLine,
  Settings2,
  Shapes,
  SquarePlus,
  Star,
  Trash2,
  Type,
  X
} from 'lucide-react'
import { activeTab, closeDialog, getState, openDialog, setState, useStore } from '../state/store'
import * as A from '../state/actions'
import { favoriteCombo, keyFor } from '../state/commands'
import {
  favoriteItems,
  favoriteLabel,
  findFavorite,
  insertFavorite,
  moveFavorite,
  newFavoriteId,
  releaseKey,
  removeFavorite,
  replaceFavorite,
  shiftFavorite,
  sortFavorites,
  updateFavorite,
  walkFavorites,
  type DropPosition,
  type FavoriteGroup,
  type FavoriteItem,
  type FavoriteNode
} from '@shared/favorites'
import { samePath } from '@shared/paths'
import { readDragPaths } from './FileDisplay'
import { Modal } from './Dialogs'
import type { MenuEntry } from './ContextMenu'
import { backgroundCss, EMOJI_SUGGESTIONS, FAVORITE_COLORS, FAVORITE_ICONS, FavoriteIconView } from './FavoriteIcon'

const FAV_MIME = 'application/x-opal-favorite'

const looksLikeFile = (p: string): boolean => /[^\\/]\.[a-z0-9]{1,6}$/i.test(p) && !/^[a-z]:\\?$/i.test(p)

function keyLabel(key: string): string {
  return getState().info.platform === 'darwin' ? key.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧') : key
}

// ------------------------------------------------------------------ context menu

function colorItems(node: FavoriteItem | FavoriteGroup, prop: 'color' | 'background'): MenuEntry[] {
  return [
    { icon: CircleOff, label: 'Default', checked: !node[prop], action: () => A.editFavorites((n) => updateFavorite(n, node.id, { [prop]: undefined })) },
    'sep',
    ...FAVORITE_COLORS.map((c) => ({
      color: c.value,
      label: c.name,
      checked: node[prop]?.toLowerCase() === c.value,
      testId: `fav-${prop}-${c.name.toLowerCase()}`,
      action: () => A.editFavorites((n) => updateFavorite(n, node.id, { [prop]: c.value }))
    })),
    'sep',
    { icon: Palette, label: 'Custom colour…', action: () => void editFavorite(node.id) }
  ]
}

function iconItems(node: FavoriteItem | FavoriteGroup): MenuEntry[] {
  const quick = ['Star', 'Folder', 'Home', 'Briefcase', 'Building2', 'Users', 'FileText', 'Code', 'Cpu', 'Server', 'Cloud', 'Download', 'Wrench', 'Rocket', 'Heart']
  return [
    { icon: CircleOff, label: 'Default', checked: !node.icon, action: () => A.editFavorites((n) => updateFavorite(n, node.id, { icon: undefined })) },
    'sep',
    ...quick.map((name) => ({
      icon: FAVORITE_ICONS[name],
      label: name.replace(/([a-z])([A-Z0-9])/g, '$1 $2'),
      checked: node.icon === `lucide:${name}`,
      testId: `fav-icon-${name.toLowerCase()}`,
      action: () => A.editFavorites((n) => updateFavorite(n, node.id, { icon: `lucide:${name}` }))
    })),
    'sep',
    { icon: Shapes, label: 'More icons and emoji…', action: () => void editFavorite(node.id) }
  ]
}

export function favoriteMenuItems(node: FavoriteNode): MenuEntry[] {
  const common: MenuEntry[] = [
    { icon: ArrowUp, label: 'Move up', action: () => A.editFavorites((n) => shiftFavorite(n, node.id, -1)) },
    { icon: ArrowDown, label: 'Move down', action: () => A.editFavorites((n) => shiftFavorite(n, node.id, 1)) },
    { icon: FolderPlus, label: 'New group…', action: () => void A.newFavoriteGroup(node.id) },
    { icon: Minus, label: 'Add a separator below', action: () => A.editFavorites((n) => insertFavorite(n, { type: 'separator', id: newFavoriteId() }, node.id, 'after')) },
    { icon: Settings2, label: 'Organize favorites…', desc: 'Reorder, group, colour and assign keys to all favorites', testId: 'fav-organize', action: () => void openDialog('favorites', { select: node.id }) }
  ]
  if (node.type === 'separator') return [...common, 'sep', { icon: Trash2, label: 'Remove separator', danger: true, action: () => A.removeFavorite(node.id) }]
  const style: MenuEntry[] = [
    { icon: PencilLine, label: 'Edit…', desc: 'Name, path, shortcut key, icon and colours', testId: 'fav-edit', action: () => void editFavorite(node.id) },
    { icon: Type, label: 'Rename…', testId: 'favorite-rename', action: () => void A.renameFavorite(node.id) },
    { icon: Palette, label: 'Text colour', testId: 'fav-text-colour', submenu: colorItems(node, 'color') },
    { icon: Palette, label: 'Background', testId: 'fav-background', submenu: colorItems(node, 'background') },
    { icon: Shapes, label: 'Icon', testId: 'fav-icon', submenu: iconItems(node) }
  ]
  if (node.type === 'group') {
    return [
      { icon: node.collapsed ? ChevronDown : ChevronRight, label: node.collapsed ? 'Expand' : 'Collapse', action: () => A.toggleFavoriteGroup(node.id) },
      { icon: Star, label: 'Add the current folder here', action: () => addCurrentTo(node.id) },
      { icon: ArrowDownAZ, label: 'Sort by name', action: () => A.editFavorites((n) => sortFavorites(n, node.id)) },
      'sep',
      ...style,
      'sep',
      ...common,
      'sep',
      { icon: Trash2, label: 'Remove group…', danger: true, action: () => void removeGroup(node) }
    ]
  }
  return [
    { icon: FolderInput, label: 'Open', hint: node.key ? keyLabel(node.key) : undefined, action: () => void A.openFavorite(node, 'source') },
    { icon: PanelRightOpen, label: 'Open in the other pane', action: () => void A.openFavorite(node, 'other') },
    { icon: SquarePlus, label: 'Open in a new tab', action: () => void A.openFavorite(node, 'newtab') },
    { icon: ExternalLink, label: 'Show in system file manager', action: () => void window.opal.reveal(node.path) },
    'sep',
    ...style,
    { icon: Keyboard, label: node.key ? `Shortcut key: ${keyLabel(node.key)}…` : 'Shortcut key…', testId: 'fav-key', action: () => void editFavorite(node.id, 'key') },
    'sep',
    ...common,
    'sep',
    { icon: Trash2, label: 'Remove from favorites', danger: true, testId: 'fav-remove', action: () => A.removeFavorite(node.id) }
  ]
}

function openFavoriteMenu(e: React.MouseEvent, node: FavoriteNode): void {
  e.preventDefault()
  e.stopPropagation()
  setState({ contextMenu: { x: e.clientX, y: e.clientY, pane: getState().activePane, target: null, items: favoriteMenuItems(node) } })
}

function addCurrentTo(groupId: string | null): void {
  const path = activeTab(getState().activePane).path
  A.editFavorites((n) => insertFavorite(n, { type: 'item', id: newFavoriteId(), path }, groupId, groupId ? 'inside' : 'after'))
}

async function removeGroup(g: FavoriteGroup): Promise<void> {
  const count = favoriteItems(g.children).length
  if (count) {
    const ok = await openDialog<boolean>('confirm', { title: 'Remove group', message: `Remove "${g.label}" and the ${count} favorite(s) it contains?`, danger: true, okLabel: 'Remove' })
    if (!ok) return
  }
  A.removeFavorite(g.id)
}

export async function editFavorite(id: string, focus?: 'key'): Promise<void> {
  const node = findFavorite(getState().favorites, id)
  if (!node || node.type === 'separator') return
  const result = await openDialog<FavoriteItem | FavoriteGroup>('favoriteEdit', { node, focus })
  if (!result) return
  A.editFavorites((n) => replaceFavorite(result.type === 'item' && result.key ? releaseKey(n, result.key, id) : n, id, result))
}

// ------------------------------------------------------------------ sidebar section

interface DropState {
  id: string
  pos: DropPosition
}

function dropPosition(e: React.DragEvent, node: FavoriteNode): DropPosition {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const y = (e.clientY - r.top) / r.height
  if (node.type === 'group') return y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'inside'
  return y < 0.5 ? 'before' : 'after'
}

function rowStyle(n: FavoriteItem | FavoriteGroup, depth: number): React.CSSProperties {
  return { paddingLeft: 10 + depth * 14, color: n.color, background: backgroundCss(n.background) }
}

export function FavoritesSection({ currentPath }: { currentPath: string }) {
  const favorites = useStore((s) => s.favorites)
  useStore((s) => s.hotkeys)
  const [drop, setDrop] = useState<DropState | null>(null)
  const [dropTitle, setDropTitle] = useState(false)

  const dragProps = (node: FavoriteNode) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(FAV_MIME, node.id)
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragEnd: () => setDrop(null),
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      if (e.dataTransfer.types.includes(FAV_MIME)) {
        const pos = dropPosition(e, node)
        if (drop?.id !== node.id || drop.pos !== pos) setDrop({ id: node.id, pos })
      } else if (drop) setDrop(null)
    },
    onDragLeave: () => setDrop((d) => (d?.id === node.id ? null : d)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setDrop(null)
      const moved = e.dataTransfer.getData(FAV_MIME)
      if (moved) {
        const pos = dropPosition(e, node)
        A.editFavorites((n) => moveFavorite(n, moved, node.id, pos))
        return
      }
      // Files dropped on a favorite folder are copied / moved into it.
      const paths = readDragPaths(e.dataTransfer)
      if (paths.length && node.type === 'item') void A.dropPaths(paths, node.path, { ctrl: e.ctrlKey, shift: e.shiftKey })
    }
  })
  const dropClass = (id: string): string => (drop?.id === id ? ` drop-${drop.pos}` : '')

  const render = (nodes: FavoriteNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      if (node.type === 'separator')
        return <div key={node.id} className={`sb-sep${dropClass(node.id)}`} style={{ marginLeft: 10 + depth * 14 }} onContextMenu={(e) => openFavoriteMenu(e, node)} {...dragProps(node)} />
      if (node.type === 'group') {
        return (
          <div key={node.id} data-testid="favorite-group">
            <div
              className={`sb-item sb-group${dropClass(node.id)}`}
              style={rowStyle(node, depth)}
              title={node.label}
              onClick={() => A.toggleFavoriteGroup(node.id)}
              onContextMenu={(e) => openFavoriteMenu(e, node)}
              {...dragProps(node)}
            >
              {node.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <FavoriteIconView icon={node.icon} fallback={Folder} size={13} />
              <span className="sb-label">{node.label}</span>
              <span className="sb-count">{favoriteItems(node.children).length}</span>
            </div>
            {!node.collapsed && render(node.children, depth + 1)}
          </div>
        )
      }
      const fallback: LucideIcon = looksLikeFile(node.path) ? FileText : Star
      return (
        <div
          key={node.id}
          className={`sb-item sb-fav${samePath(node.path, currentPath) ? ' current' : ''}${dropClass(node.id)}`}
          style={rowStyle(node, depth)}
          title={`${node.path}${node.key ? `\nShortcut: ${node.key}` : ''}`}
          data-testid="favorite-item"
          data-fav-id={node.id}
          onClick={() => void A.openFavorite(node)}
          onAuxClick={(e) => e.button === 1 && void A.openFavorite(node, 'newtab')}
          onContextMenu={(e) => openFavoriteMenu(e, node)}
          {...dragProps(node)}
        >
          <FavoriteIconView icon={node.icon} fallback={fallback} size={13} />
          <span className="sb-label">{favoriteLabel(node)}</span>
          {node.key && <kbd className="sb-key">{keyLabel(node.key)}</kbd>}
          <button
            className="sb-remove"
            title="Remove favorite"
            onClick={(e) => {
              e.stopPropagation()
              A.removeFavorite(node.id)
            }}
          >
            <X size={11} />
          </button>
        </div>
      )
    })

  return (
    <div className="sb-section" data-testid="favorites-section">
      <div
        className={`sb-title sb-title-actions${dropTitle ? ' drop-inside' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDropTitle(true)
        }}
        onDragLeave={() => setDropTitle(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDropTitle(false)
          const moved = e.dataTransfer.getData(FAV_MIME)
          if (moved) {
            const first = getState().favorites[0]
            A.editFavorites((n) => (first ? moveFavorite(n, moved, first.id, 'before') : n))
            return
          }
          // Folders dropped on the title become favorites.
          const paths = readDragPaths(e.dataTransfer)
          if (paths.length) A.editFavorites((n) => [...n, ...paths.map((path) => ({ type: 'item' as const, id: newFavoriteId(), path }))])
        }}
      >
        <span>Favorites</span>
        <button className="sb-title-btn" title="Organize favorites…" data-testid="fav-organize-btn" onClick={() => void openDialog('favorites', {})}>
          <Settings2 size={12} />
        </button>
      </div>
      {favorites.length === 0 && <div className="sb-empty">{keyFor('Favorites ADD') || 'The star button'} adds the current folder</div>}
      {render(favorites, 0)}
    </div>
  )
}

// ------------------------------------------------------------------ editor

function ColorPicker({ value, onChange, testId }: { value?: string; onChange: (v: string | undefined) => void; testId: string }) {
  return (
    <div className="fav-colors" data-testid={testId}>
      <button className={`swatch none${!value ? ' on' : ''}`} title="Default" onClick={() => onChange(undefined)}>
        <CircleOff size={12} />
      </button>
      {FAVORITE_COLORS.map((c) => (
        <button key={c.value} className={`swatch${value?.toLowerCase() === c.value ? ' on' : ''}`} title={c.name} style={{ background: c.value }} onClick={() => onChange(c.value)} />
      ))}
      <input type="color" value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#4c8dff'} title="Custom colour" onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

function IconPicker({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const [filter, setFilter] = useState('')
  const [emoji, setEmoji] = useState(value?.startsWith('emoji:') ? value.slice(6) : '')
  const names = Object.keys(FAVORITE_ICONS).filter((n) => n.toLowerCase().includes(filter.toLowerCase()))
  return (
    <div className="fav-icon-picker" data-testid="fav-icon-picker">
      <div className="row-flex">
        <input placeholder="Search icons" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className={`btn small${!value ? ' on' : ''}`} onClick={() => onChange(undefined)}>
          Default
        </button>
      </div>
      <div className="fav-icon-grid">
        {names.map((n) => {
          const Icon = FAVORITE_ICONS[n]
          return (
            <button key={n} className={`icon-cell${value === `lucide:${n}` ? ' on' : ''}`} title={n} data-testid={`icon-${n}`} onClick={() => onChange(`lucide:${n}`)}>
              <Icon size={16} />
            </button>
          )
        })}
      </div>
      <div className="fav-icon-grid emoji">
        {EMOJI_SUGGESTIONS.map((em) => (
          <button key={em} className={`icon-cell${value === `emoji:${em}` ? ' on' : ''}`} onClick={() => onChange(`emoji:${em}`)}>
            {em}
          </button>
        ))}
        <input
          className="emoji-input"
          placeholder="Any emoji"
          value={emoji}
          maxLength={8}
          onChange={(e) => {
            setEmoji(e.target.value)
            if (e.target.value.trim()) onChange(`emoji:${e.target.value.trim()}`)
          }}
        />
      </div>
    </div>
  )
}

function KeyField({ value, onChange, autoFocus, selfId }: { value?: string; onChange: (v: string | undefined) => void; autoFocus?: boolean; selfId: string }) {
  const [recording, setRecording] = useState(!!autoFocus)
  const ref = useRef<HTMLButtonElement>(null)
  const hotkeys = useStore((s) => s.hotkeys)
  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])
  const other = value ? favoriteItems(getState().favorites).find((f) => f.id !== selfId && f.key?.toLowerCase() === value.toLowerCase()) : undefined
  const command = value ? hotkeys[value.replace(/^Shift\+([A-Z])$/, '$1')] : undefined
  return (
    <div>
      <div className="row-flex">
        <button
          ref={ref}
          className={`key-capture${recording ? ' rec' : ''}`}
          data-testid="fav-key-capture"
          onClick={() => setRecording(true)}
          onBlur={() => setRecording(false)}
          onKeyDown={(e) => {
            if (!recording) return
            e.preventDefault()
            e.stopPropagation()
            if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
            if (e.key === 'Escape') return setRecording(false)
            if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.metaKey) {
              onChange(undefined)
              return setRecording(false)
            }
            onChange(favoriteCombo(e.nativeEvent))
            setRecording(false)
          }}
        >
          {recording ? 'Press a key…' : value ? keyLabel(value) : 'None'}
        </button>
        {value && (
          <button className="btn small" onClick={() => onChange(undefined)}>
            Clear
          </button>
        )}
      </div>
      <div className="muted small">
        {other
          ? `Now used by “${favoriteLabel(other)}”: it will move here.`
          : command
            ? `Replaces the shortcut for “${command}” while the file list has the focus.`
            : 'A single letter works while the file list has the focus (type-to-find then starts with any other letter).'}
      </div>
    </div>
  )
}

export function FavoriteEditor({ node, onChange, focus }: { node: FavoriteItem | FavoriteGroup; onChange: (n: FavoriteItem | FavoriteGroup) => void; focus?: 'key' }) {
  const set = (patch: Record<string, unknown>): void => {
    const next = { ...node, ...patch } as FavoriteItem & Record<string, unknown>
    for (const [k, v] of Object.entries(patch)) if (v === undefined || v === '') delete next[k]
    onChange(next as FavoriteItem)
  }
  const item = node.type === 'item' ? node : null
  return (
    <div className="fav-editor" data-testid="fav-editor">
      <div className="fav-preview">
        <div className="sb-item" style={{ color: node.color, background: backgroundCss(node.background) }}>
          <FavoriteIconView icon={node.icon} fallback={node.type === 'group' ? Folder : item && looksLikeFile(item.path) ? FileText : Star} size={14} />
          <span className="sb-label">{favoriteLabel(node) || '—'}</span>
          {item?.key && <kbd className="sb-key">{keyLabel(item.key)}</kbd>}
        </div>
      </div>
      <label className="field">
        <span>Name</span>
        <input data-testid="fav-name" value={node.type === 'group' ? node.label : (node.label ?? '')} placeholder={item ? favoriteLabel({ ...item, label: undefined }) : ''} onChange={(e) => set({ label: e.target.value })} />
      </label>
      {item && (
        <>
          <label className="field">
            <span>Folder or file</span>
            <div className="row-flex">
              <input data-testid="fav-path" value={item.path} spellCheck={false} onChange={(e) => onChange({ ...item, path: e.target.value })} />
              <button className="btn" onClick={() => void window.opal.pickFolder().then((p) => p && onChange({ ...item, path: p }))}>
                Browse…
              </button>
              <button className="btn" title="Use the folder shown in the active pane" onClick={() => onChange({ ...item, path: activeTab(getState().activePane).path })}>
                Current
              </button>
            </div>
          </label>
          <div className="field">
            <span>Shortcut key</span>
            <KeyField value={item.key} onChange={(k) => set({ key: k })} autoFocus={focus === 'key'} selfId={item.id} />
          </div>
          <div className="field">
            <span>Opens in</span>
            <div className="seg">
              {(
                [
                  ['source', 'Active pane'],
                  ['dest', 'Other pane'],
                  ['newtab', 'New tab']
                ] as const
              ).map(([v, l]) => (
                <button key={v} className={(item.openIn ?? 'source') === v ? 'on' : ''} onClick={() => set({ openIn: v === 'source' ? undefined : v })}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      <div className="field">
        <span>Text colour</span>
        <ColorPicker value={node.color} onChange={(v) => set({ color: v })} testId="fav-color-picker" />
      </div>
      <div className="field">
        <span>Background</span>
        <ColorPicker value={node.background} onChange={(v) => set({ background: v })} testId="fav-bg-picker" />
      </div>
      <div className="field">
        <span>Icon</span>
        <IconPicker value={node.icon} onChange={(v) => set({ icon: v })} />
      </div>
    </div>
  )
}

export function FavoriteEditDialog({ node, focus }: { node: FavoriteItem | FavoriteGroup; focus?: 'key' }) {
  const [draft, setDraft] = useState(node)
  const valid = draft.type === 'group' ? !!draft.label.trim() : !!draft.path.trim()
  return (
    <Modal
      title={node.type === 'group' ? 'Edit group' : 'Edit favorite'}
      testId="fav-edit-dialog"
      footer={
        <>
          <button className="btn" onClick={() => closeDialog(null)}>
            Cancel
          </button>
          <button className="btn primary" data-testid="fav-save" disabled={!valid} onClick={() => closeDialog(draft)}>
            Save
          </button>
        </>
      }
    >
      <FavoriteEditor node={draft} onChange={setDraft} focus={focus} />
    </Modal>
  )
}

// ------------------------------------------------------------------ manager

export function FavoritesManager({ select }: { select?: string }) {
  const [draft, setDraft] = useState<FavoriteNode[]>(() => getState().favorites)
  const [selected, setSelected] = useState<string | null>(select ?? draft[0]?.id ?? null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [drop, setDrop] = useState<DropState | null>(null)
  const node = selected ? findFavorite(draft, selected) : null
  const flat = useMemo(() => {
    const out: { node: FavoriteNode; depth: number }[] = []
    const add = (list: FavoriteNode[], depth: number): void => {
      for (const n of list) {
        out.push({ node: n, depth })
        if (n.type === 'group' && !collapsed.has(n.id)) add(n.children, depth + 1)
      }
    }
    add(draft, 0)
    return out
  }, [draft, collapsed])
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.fm-row.selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const after = selected
  const place = (n: FavoriteNode): void => {
    const target = selected ? findFavorite(draft, selected) : null
    setDraft((d) => insertFavorite(d, n, after, target?.type === 'group' ? 'inside' : 'after'))
    setSelected(n.id)
  }
  const keyStats = useMemo(() => favoriteItems(draft).filter((f) => f.key).length, [draft])

  return (
    <Modal
      title="Organize favorites"
      wide
      testId="favorites-manager"
      footer={
        <>
          <span className="muted small">
            {favoriteItems(draft).length} favorites · {keyStats} with a shortcut key · drag to reorder or to move into a group
          </span>
          <span className="spacer" />
          <button className="btn" onClick={() => closeDialog(null)}>
            Cancel
          </button>
          <button
            className="btn primary"
            data-testid="fm-ok"
            onClick={() => {
              A.saveFavorites(draft)
              closeDialog(true)
            }}
          >
            OK
          </button>
        </>
      }
    >
      <div className="fm">
        <div className="fm-left">
          <div className="fm-toolbar">
            <button className="btn small" data-testid="fm-new" title="Add the folder shown in the active pane" onClick={() => place({ type: 'item', id: newFavoriteId(), path: activeTab(getState().activePane).path })}>
              <Star size={13} /> New favorite
            </button>
            <button className="btn small" data-testid="fm-new-group" onClick={() => place({ type: 'group', id: newFavoriteId(), label: 'New group', children: [] })}>
              <FolderPlus size={13} /> Group
            </button>
            <button className="btn small" title="Separator" onClick={() => place({ type: 'separator', id: newFavoriteId() })}>
              <Minus size={13} />
            </button>
            <span className="spacer" />
            <button className="icon-btn" title="Move up" disabled={!selected} onClick={() => selected && setDraft((d) => shiftFavorite(d, selected, -1))}>
              <ArrowUp size={14} />
            </button>
            <button className="icon-btn" title="Move down" disabled={!selected} onClick={() => selected && setDraft((d) => shiftFavorite(d, selected, 1))}>
              <ArrowDown size={14} />
            </button>
            <button className="icon-btn" title="Sort the selected group by name" onClick={() => setDraft((d) => sortFavorites(d, node?.type === 'group' ? node.id : null))}>
              <ArrowDownAZ size={14} />
            </button>
            <button
              className="icon-btn danger"
              title="Remove (Delete)"
              data-testid="fm-delete"
              disabled={!selected}
              onClick={() => {
                if (!selected) return
                const i = flat.findIndex((f) => f.node.id === selected)
                setDraft((d) => removeFavorite(d, selected))
                setSelected(flat[i + 1]?.node.id ?? flat[i - 1]?.node.id ?? null)
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
          <div
            className="fm-tree"
            ref={listRef}
            tabIndex={0}
            data-testid="fm-tree"
            onKeyDown={(e) => {
              const i = flat.findIndex((f) => f.node.id === selected)
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                if (e.altKey && selected) setDraft((d) => shiftFavorite(d, selected, e.key === 'ArrowUp' ? -1 : 1))
                else setSelected(flat[Math.max(0, Math.min(flat.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.node.id ?? null)
              } else if (e.key === 'Delete' && selected) {
                setDraft((d) => removeFavorite(d, selected))
                setSelected(flat[i + 1]?.node.id ?? flat[i - 1]?.node.id ?? null)
              } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && node?.type === 'group') {
                e.preventDefault()
                setCollapsed((c) => {
                  const n = new Set(c)
                  if (e.key === 'ArrowLeft') n.add(node.id)
                  else n.delete(node.id)
                  return n
                })
              }
            }}
          >
            {flat.length === 0 && <div className="muted pad">No favorites yet.</div>}
            {flat.map(({ node: n, depth }) => {
              const dc = drop?.id === n.id ? ` drop-${drop.pos}` : ''
              const common = {
                key: n.id,
                draggable: true,
                'data-testid': 'fm-row',
                onClick: () => setSelected(n.id),
                onDragStart: (e: React.DragEvent) => e.dataTransfer.setData(FAV_MIME, n.id),
                onDragOver: (e: React.DragEvent) => {
                  e.preventDefault()
                  const pos = dropPosition(e, n)
                  if (drop?.id !== n.id || drop.pos !== pos) setDrop({ id: n.id, pos })
                },
                onDragEnd: () => setDrop(null),
                onDrop: (e: React.DragEvent) => {
                  e.preventDefault()
                  setDrop(null)
                  const id = e.dataTransfer.getData(FAV_MIME)
                  // Read the position now: the event is gone when the state updater runs.
                  const pos = dropPosition(e, n)
                  if (id) setDraft((d) => moveFavorite(d, id, n.id, pos))
                }
              }
              if (n.type === 'separator')
                return (
                  <div {...common} className={`fm-row sep${selected === n.id ? ' selected' : ''}${dc}`} style={{ paddingLeft: 8 + depth * 16 }}>
                    <hr />
                  </div>
                )
              return (
                <div {...common} className={`fm-row${selected === n.id ? ' selected' : ''}${dc}`} style={{ paddingLeft: 8 + depth * 16 }}>
                  {n.type === 'group' ? (
                    <button
                      className="fm-twisty"
                      onClick={(e) => {
                        e.stopPropagation()
                        setCollapsed((c) => {
                          const s = new Set(c)
                          if (s.has(n.id)) s.delete(n.id)
                          else s.add(n.id)
                          return s
                        })
                      }}
                    >
                      {collapsed.has(n.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>
                  ) : (
                    <span className="fm-twisty" />
                  )}
                  <span className="fm-name" style={{ color: n.color, background: backgroundCss(n.background) }}>
                    <FavoriteIconView icon={n.icon} fallback={n.type === 'group' ? Folder : looksLikeFile(n.path) ? FileText : Star} size={14} />
                    <span>{favoriteLabel(n)}</span>
                  </span>
                  {n.type === 'item' && <span className="fm-path muted">{n.path}</span>}
                  {n.type === 'item' && n.key && <kbd className="sb-key">{keyLabel(n.key)}</kbd>}
                </div>
              )
            })}
          </div>
        </div>
        <div className="fm-right">
          {node && node.type !== 'separator' ? (
            <FavoriteEditor
              key={node.id}
              node={node}
              onChange={(next) =>
                setDraft((d) => {
                  const r = next.type === 'item' && next.key ? releaseKey(d, next.key, next.id) : d
                  return replaceFavorite(r, next.id, next)
                })
              }
            />
          ) : (
            <div className="muted pad">{node ? 'A separator line between favorites.' : 'Select a favorite or a group to edit it.'}</div>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** All favorites (with their group path) for quick "go to favorite" lists. */
export function favoriteEntries(nodes: FavoriteNode[]): { item: FavoriteItem; group: string }[] {
  const out: { item: FavoriteItem; group: string }[] = []
  for (const { node, parents } of walkFavorites(nodes)) if (node.type === 'item') out.push({ item: node, group: parents.map((p) => p.label).join(' / ') })
  return out
}
