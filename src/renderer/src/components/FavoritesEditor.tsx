import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, FolderPlus, Plus, Trash2, X, Folder } from 'lucide-react'
import { closeDialog, getState, useStore } from '../state/store'
import * as A from '../state/actions'
import type { Favorite } from '@shared/types'
import { groupsInOrder } from '@shared/favorites'
import { isFavoriteShortcut } from '@shared/settings'
import { basename } from '@shared/paths'
import { Modal, ShortcutField } from './Dialogs'
import { FileIcon } from './FileIcon'

interface Row {
  key: number
  fav: Favorite
  /** Group id (index into the group list), or null for straight on the bar. */
  gid: number | null
}
interface GroupDraft {
  id: number
  name: string
}

let keySeq = 0

/** "Edit favorites": names, groups, order, shortcuts; adding and removing. Nothing changes until Save. */
export function FavoritesEditor() {
  const initial = useMemo(() => {
    const s = getState()
    const groups: GroupDraft[] = groupsInOrder(s.favorites, s.prefs.favoriteGroups).map((name, id) => ({ id, name }))
    const rows: Row[] = s.favorites.map((f) => {
      const { group, ...fav } = f
      return { key: ++keySeq, fav, gid: group ? (groups.find((g) => g.name === group)?.id ?? null) : null }
    })
    return { rows, groups }
  }, [])
  const [rows, setRows] = useState<Row[]>(initial.rows)
  const [groups, setGroups] = useState<GroupDraft[]>(initial.groups)
  const hotkeys = useStore((s) => s.hotkeys)

  const update = (key: number, patch: Partial<Row> | ((r: Row) => Partial<Row>)): void =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch) } : r)))
  const setFav = (key: number, patch: Partial<Favorite>): void =>
    update(key, (r) => {
      const fav = { ...r.fav, ...patch }
      for (const k of Object.keys(fav) as (keyof Favorite)[]) if (fav[k] === undefined || fav[k] === '') delete fav[k]
      return { fav }
    })

  /** Swaps a row with the previous / next row of the same section. */
  const move = (key: number, dir: -1 | 1): void =>
    setRows((list) => {
      const i = list.findIndex((r) => r.key === key)
      let j = i + dir
      while (j >= 0 && j < list.length && list[j].gid !== list[i].gid) j += dir
      if (j < 0 || j >= list.length) return list
      const next = [...list]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const addGroup = (): void => {
    const id = Math.max(-1, ...groups.map((g) => g.id)) + 1
    let n = groups.length + 1
    while (groups.some((g) => g.name === `Group ${n}`)) n++
    setGroups([...groups, { id, name: `Group ${n}` }])
  }

  const addFolder = async (): Promise<void> => {
    const p = await window.opal.pickFolder()
    if (!p) return
    if (rows.some((r) => r.gid === null && r.fav.path.toLowerCase() === p.toLowerCase())) return
    setRows((list) => [...list, { key: ++keySeq, fav: { path: p }, gid: null }])
  }

  // Problems that block saving.
  const names = groups.map((g) => g.name.trim())
  const groupProblem = names.some((n) => !n) ? 'Every group needs a name.' : names.some((n, i) => names.indexOf(n) !== i) ? 'Two groups have the same name.' : ''
  const shortcutProblem = (r: Row): string => {
    const sc = r.fav.shortcut
    if (!sc) return ''
    if (!isFavoriteShortcut(sc)) return 'Use Ctrl or Alt with a key, or F1–F24'
    if (hotkeys[sc]) return `Used by the command "${hotkeys[sc]}"`
    const other = rows.find((o) => o.key !== r.key && o.fav.shortcut === sc)
    if (other) return `Also used by "${other.fav.label || basename(other.fav.path)}"`
    return ''
  }
  const problem = groupProblem || (rows.some((r) => shortcutProblem(r)) ? 'Fix the shortcuts marked in red.' : '')

  const save = (): void => {
    if (problem) return
    const nameOf = new Map(groups.map((g) => [g.id, g.name.trim()]))
    const favorites: Favorite[] = rows.map((r) => {
      const group = r.gid !== null ? nameOf.get(r.gid) : undefined
      return group ? { ...r.fav, group } : { ...r.fav }
    })
    A.saveFavoritesEdit(favorites, groups.map((g) => g.name.trim()))
    closeDialog(true)
  }

  const section = (gid: number | null): Row[] => rows.filter((r) => r.gid === gid)

  const renderRow = (r: Row, idx: number, count: number) => {
    const f = r.fav
    const issue = shortcutProblem(r)
    return (
      <div key={r.key} className="fe-row" data-testid="fe-row" data-path={f.path}>
        <FileIcon path={f.path} isDir={!f.file} size={16} />
        <div className="fe-name">
          <input
            data-testid="fe-name"
            value={f.label ?? ''}
            placeholder={basename(f.path) || f.path}
            spellCheck={false}
            aria-label="Name"
            onChange={(e) => setFav(r.key, { label: e.target.value || undefined })}
            onBlur={(e) => {
              const v = e.target.value.trim()
              setFav(r.key, { label: v && v !== basename(f.path) ? v : undefined })
            }}
          />
          <span className="fe-path" title={f.path}>
            {f.path}
          </span>
        </div>
        <select data-testid="fe-group" value={r.gid ?? ''} aria-label="Group" onChange={(e) => update(r.key, { gid: e.target.value === '' ? null : Number(e.target.value) })}>
          <option value="">On the bar</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name.trim() || '(no name)'}
            </option>
          ))}
        </select>
        <div className={`fe-shortcut${issue ? ' bad' : ''}`} title={issue || 'Key combination that opens this favorite'}>
          <ShortcutField value={f.shortcut ?? ''} onChange={(v) => setFav(r.key, { shortcut: v || undefined })} />
        </div>
        <div className="fe-actions">
          <button className="icon-btn" title="Move up" aria-label="Move up" disabled={idx === 0} data-testid="fe-up" onClick={() => move(r.key, -1)}>
            <ArrowUp size={15} />
          </button>
          <button className="icon-btn" title="Move down" aria-label="Move down" disabled={idx === count - 1} data-testid="fe-down" onClick={() => move(r.key, 1)}>
            <ArrowDown size={15} />
          </button>
          <button className="icon-btn danger" title="Remove from favorites" aria-label="Remove" data-testid="fe-remove" onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}>
            <X size={15} />
          </button>
        </div>
      </div>
    )
  }

  const bar = section(null)
  return (
    <Modal
      title="Edit favorites"
      wide
      testId="favorites-editor"
      footer={
        <>
          <button className="btn fe-left" data-testid="fe-add-folder" onClick={() => void addFolder()}>
            <Plus size={14} /> Add folder…
          </button>
          <button className="btn" data-testid="fe-add-group" onClick={addGroup}>
            <FolderPlus size={14} /> New group
          </button>
          {problem && (
            <span className="error small fe-problem" data-testid="fe-problem">
              {problem}
            </span>
          )}
          <button className="btn" onClick={() => closeDialog(null)}>
            Cancel
          </button>
          <button className="btn primary" data-testid="fe-save" disabled={!!problem} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="fe-hint">Names, order and groups are shown on the favorites bar. Drag files and folders onto the bar to add more.</div>
      <div className="fe-section" data-testid="fe-section-bar">
        <div className="fe-section-title">On the bar</div>
        {bar.length === 0 && <div className="fe-empty">No favorites straight on the bar</div>}
        {bar.map((r, i) => renderRow(r, i, bar.length))}
      </div>
      {groups.map((g) => {
        const list = section(g.id)
        return (
          <div key={g.id} className="fe-section" data-testid="fe-section-group">
            <div className="fe-section-title fe-group-title">
              <Folder size={14} className="fb-group-icon" />
              <input data-testid="fe-group-name" value={g.name} aria-label="Group name" spellCheck={false} onChange={(e) => setGroups((gs) => gs.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)))} />
              <button
                className="icon-btn danger"
                title="Remove the group (its favorites go straight on the bar)"
                aria-label="Remove group"
                data-testid="fe-group-remove"
                onClick={() => {
                  setRows((rs) => rs.map((r) => (r.gid === g.id ? { ...r, gid: null } : r)))
                  setGroups((gs) => gs.filter((x) => x.id !== g.id))
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
            {list.length === 0 && <div className="fe-empty">Empty: pick this group for a favorite, or drop items on it on the bar</div>}
            {list.map((r, i) => renderRow(r, i, list.length))}
          </div>
        )
      })}
    </Modal>
  )
}
