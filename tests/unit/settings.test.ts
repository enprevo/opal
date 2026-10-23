import { describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SettingsStore } from '../../src/main/settings'
import { fromImport, normalizeFavorites, normalizeState, toExport } from '../../src/shared/settings'
import { DEFAULT_PREFS } from '../../src/shared/types'
import { effectiveHotkeys, hotkeyOverrides } from '../../src/renderer/src/state/commands'

describe('settings normalisation', () => {
  it('fills defaults, drops unknown keys and values of the wrong type', () => {
    const st = normalizeState({ prefs: { theme: 'light', density: 'huge', fontScale: '120', bogus: 1, columns: ['name', 3] }, extra: true })
    expect(st.prefs.theme).toBe('light')
    expect(st.prefs.density).toBe(DEFAULT_PREFS.density)
    expect(st.prefs.fontScale).toBe(100)
    expect(st.prefs.columns).toEqual(['name'])
    expect('bogus' in st.prefs).toBe(false)
    expect('extra' in st).toBe(false)
    expect(normalizeState(null).prefs).toEqual(DEFAULT_PREFS)
  })
  it('replaces an unknown key map by the standard one', () => {
    expect(normalizeState({ prefs: { keymap: 'something-old' } }).prefs.keymap).toBe('standard')
    expect(normalizeState({ prefs: { keymap: 'commander' } }).prefs.keymap).toBe('commander')
  })
  it('migrates plain paths and the flat "Parent / Child" groups into a tree', () => {
    const tree = normalizeFavorites(['/a', { path: '/b', label: ' Bee ', group: 'Work / Clients' }, { path: '' }, 7, '/a', { path: '/c', group: 'Work' }], ['Work / Clients'])
    const strip = (n: unknown): unknown => JSON.parse(JSON.stringify(n, (k, v) => (k === 'id' ? undefined : v)))
    expect(strip(tree)).toEqual([
      { type: 'item', path: '/a' },
      {
        type: 'group',
        label: 'Work',
        children: [{ type: 'group', label: 'Clients', collapsed: true, children: [{ type: 'item', path: '/b', label: 'Bee' }] }, { type: 'item', path: '/c' }]
      }
    ])
    expect(new Set([...JSON.stringify(tree).matchAll(/"id":"([^"]+)"/g)].map((m) => m[1])).size).toBe(5)
  })
  it('takes collapsed groups from older preferences', () => {
    const st = normalizeState({ prefs: { favoritesCollapsed: ['Jobs'] }, favorites: [{ path: '/x', group: 'Jobs' }] })
    expect(st.favorites[0]).toMatchObject({ type: 'group', label: 'Jobs', collapsed: true })
    expect('favoritesCollapsed' in st.prefs).toBe(false)
  })
  it('clamps window layout values', () => {
    const st = normalizeState({ ui: { sidebarWidth: 9999, paneRatio: 0.01, columnWidths: { name: 300, size: -5 } } })
    expect(st.ui).toEqual({ sidebarWidth: 600, paneRatio: 0.15, columnWidths: { name: 300 } })
  })
})

describe('export and import', () => {
  const base = normalizeState({
    prefs: { theme: 'light', accent: '#ff375f' },
    favorites: [{ type: 'group', id: 'g', label: 'Jobs', children: [{ type: 'item', id: 'w', path: 'C:\\Work', label: 'Work', key: 'W', color: '#ff5f57', icon: 'lucide:Briefcase' }] }],
    recent: ['C:\\Temp'],
    hotkeys: { 'Ctrl+J': 'Go C:\\Work' },
    labels: { 'C:\\Work\\a.txt': ['red'] },
    session: { panes: [], activePane: 0 },
    ui: { sidebarWidth: 300 },
    renamePresets: { Dates: { newPattern: '{date}-*' } }
  })
  it('exports everything except open tabs and recent folders', () => {
    const out = toExport(base, '1.2.3', 'win32')
    expect(out.format).toBe('opal-settings')
    expect(out.platform).toBe('win32')
    expect('session' in out).toBe(false)
    expect('recent' in out).toBe(false)
    expect(out.favorites[0]).toMatchObject({ type: 'group', children: [{ label: 'Work', key: 'W', color: '#ff5f57', icon: 'lucide:Briefcase' }] })
    expect(out.renamePresets?.Dates).toBeTruthy()
  })
  it('imports over the current state, keeping this computer’s tabs and recent folders', () => {
    const here = normalizeState({ recent: ['/home/me/x'], session: { panes: [{ tabs: [], activeTab: 0 }], activePane: 0 } })
    const merged = fromImport(JSON.parse(JSON.stringify(toExport(base, '1', 'win32'))), here)
    expect(merged.prefs.accent).toBe('#ff375f')
    expect(merged.hotkeys).toEqual({ 'Ctrl+J': 'Go C:\\Work' })
    expect(merged.ui?.sidebarWidth).toBe(300)
    expect(merged.recent).toEqual(['/home/me/x'])
    expect(merged.session?.panes.length).toBe(1)
  })
  it('rejects files that are not Opal settings', () => {
    expect(() => fromImport({ hello: 1 }, base)).toThrow(/not an Opal settings file/)
    expect(() => fromImport([1, 2], base)).toThrow()
  })
})

describe('key map storage', () => {
  it('saves only changes and removals, so files move between Windows, macOS and Linux', () => {
    const win = effectiveHotkeys('standard', 'win32')
    const edited: Record<string, string> = { ...win, 'Ctrl+J': 'Go /tmp', 'Ctrl+1': 'Copy' }
    delete edited['Ctrl+K']
    const saved = hotkeyOverrides(edited, 'standard', 'win32')
    expect(saved).toEqual({ 'Ctrl+J': 'Go /tmp', 'Ctrl+1': 'Copy', 'Ctrl+K': '' })
    // On a Mac the same changes apply on top of the Mac defaults (Cmd+H stays free for "Hide").
    const mac = effectiveHotkeys('standard', 'darwin', saved)
    expect(mac['Ctrl+J']).toBe('Go /tmp')
    expect(mac['Ctrl+K']).toBeUndefined()
    expect(mac['Ctrl+H']).toBeUndefined()
    expect(mac['Ctrl+Backspace']).toBe('Delete')
    expect(hotkeyOverrides(effectiveHotkeys('standard', 'linux'), 'standard', 'linux')).toEqual({})
  })
})

describe('settings file safety', () => {
  it('keeps a corrupt file aside and recovers from the backup', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'opal-settings-'))
    const file = path.join(dir, 'opal-settings.json')
    const s = new SettingsStore(file)
    await s.load()
    s.update({ favorites: [{ type: 'item', id: '1', path: '/first' }] })
    await s.flush()
    s.update({ favorites: [{ type: 'item', id: '2', path: '/second' }] })
    await s.flush()
    // A second session backs up the last good file before writing.
    const s2 = new SettingsStore(file)
    await s2.load()
    s2.update({ favorites: [{ type: 'item', id: '3', path: '/third' }] })
    await s2.flush()
    await fsp.writeFile(file, '{ broken json')
    const s3 = new SettingsStore(file)
    const st = await s3.load()
    expect(st.favorites).toEqual([{ type: 'item', id: '2', path: '/second' }])
    const files = await fsp.readdir(dir)
    expect(files.some((f) => f.includes('.corrupt-'))).toBe(true)
    await fsp.rm(dir, { recursive: true, force: true })
  })
  it('serialises concurrent writes', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'opal-settings-'))
    const file = path.join(dir, 's.json')
    const s = new SettingsStore(file)
    await s.load()
    await Promise.all(Array.from({ length: 20 }, (_, i) => (s.update({ recent: [`/r${i}`] }), s.flush())))
    expect(JSON.parse(await fsp.readFile(file, 'utf8')).recent).toEqual(['/r19'])
    await fsp.rm(dir, { recursive: true, force: true })
  })
})
