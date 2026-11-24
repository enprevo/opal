import { describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SettingsStore } from '../../src/main/settings'
import { fromImport, isFavoriteShortcut, normalizeFavorites, normalizeFolderStyles, normalizeGroupColors, normalizeState, normalizeWindow, toExport } from '../../src/shared/settings'
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
  it('migrates plain favorite paths and keeps labels and groups', () => {
    expect(normalizeFavorites(['/a', { path: '/b', label: ' Bee ', group: 'Work / Clients' }, { path: '' }, 7, '/a'])).toEqual([
      { path: '/a' },
      { path: '/b', label: 'Bee', group: 'Work / Clients' }
    ])
  })
  it('clamps window layout values', () => {
    const st = normalizeState({ ui: { sidebarWidth: 9999, paneRatio: 0.01, columnWidths: { name: 300, size: -5 } } })
    expect(st.ui).toEqual({ sidebarWidth: 600, paneRatio: 0.15, columnWidths: { name: 300 } })
  })
  it('remembers the window size, place and whether it was maximized or full screen', () => {
    expect(normalizeState({ window: { width: 1200.4, height: 700, x: 10, y: 20, maximized: true } }).window).toEqual({ width: 1200, height: 700, x: 10, y: 20, maximized: true })
    expect(normalizeWindow({ width: 100, height: 100, fullScreen: true, maximized: 'yes' })).toEqual({ width: 800, height: 500, fullScreen: true })
    expect(normalizeWindow({ width: 1000, height: 600, x: 5 })).toEqual({ width: 1000, height: 600 })
    expect(normalizeWindow({ height: 600 })).toBeUndefined()
    expect(normalizeState({}).window).toBeUndefined()
  })
})

describe('export and import', () => {
  const base = normalizeState({
    prefs: { theme: 'light', accent: '#ff375f' },
    favorites: [{ path: 'C:\\Work', label: 'Work', group: 'Jobs' }],
    recent: ['C:\\Temp'],
    hotkeys: { 'Ctrl+J': 'Go C:\\Work' },
    labels: { 'C:\\Work\\a.txt': ['red'] },
    session: { panes: [], activePane: 0 },
    ui: { sidebarWidth: 300 },
    window: { width: 1000, height: 700, maximized: true },
    renamePresets: { Dates: { newPattern: '{date}-*' } }
  })
  it('exports everything except open tabs and recent folders', () => {
    const out = toExport(base, '1.2.3', 'win32')
    expect(out.format).toBe('opal-settings')
    expect(out.platform).toBe('win32')
    expect('session' in out).toBe(false)
    expect('recent' in out).toBe(false)
    expect('window' in out).toBe(false)
    expect(out.favorites[0].label).toBe('Work')
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
    expect(merged.window).toBeUndefined()
    const fullHere = normalizeState({ window: { width: 900, height: 600, fullScreen: true } })
    expect(fromImport({ ...toExport(base, '1', 'win32'), window: { width: 2000, height: 1000 } }, fullHere).window).toEqual({ width: 900, height: 600, fullScreen: true })
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
    s.update({ favorites: [{ path: '/first' }] })
    await s.flush()
    s.update({ favorites: [{ path: '/second' }] })
    await s.flush()
    // A second session backs up the last good file before writing.
    const s2 = new SettingsStore(file)
    await s2.load()
    s2.update({ favorites: [{ path: '/third' }] })
    await s2.flush()
    await fsp.writeFile(file, '{ broken json')
    const s3 = new SettingsStore(file)
    const st = await s3.load()
    expect(st.favorites).toEqual([{ path: '/second' }])
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

describe('favorite shortcuts', () => {
  it('accepts function keys and combinations with Ctrl or Alt only', () => {
    for (const ok of ['Ctrl+Alt+1', 'Alt+D', 'Ctrl+Shift+F', 'F5', 'Shift+F9', 'Ctrl++']) expect(isFavoriteShortcut(ok), ok).toBe(true)
    for (const bad of ['', 'A', 'Shift+A', 'Enter', 'Tab', 'Ctrl', 'Ctrl+', 'Alt', 'Shift+Tab', 'F25', 7, null]) expect(isFavoriteShortcut(bad), String(bad)).toBe(false)
  })
  it('keeps a valid shortcut with its favorite', () => {
    expect(normalizeFavorites([{ path: '/a', shortcut: ' Ctrl+Alt+1 ' }])).toEqual([{ path: '/a', shortcut: 'Ctrl+Alt+1' }])
  })
  it('drops shortcuts that would hijack typing', () => {
    expect(normalizeFavorites([{ path: '/a', shortcut: 'A' }, { path: '/b', shortcut: 'Shift+Z' }])).toEqual([{ path: '/a' }, { path: '/b' }])
  })
  it('gives a key combination to one folder only: the first favorite keeps it', () => {
    expect(normalizeFavorites([{ path: '/a', shortcut: 'F5' }, { path: '/b', shortcut: 'F5' }, { path: '/A', group: 'g', shortcut: 'F5' }])).toEqual([
      { path: '/a', shortcut: 'F5' },
      { path: '/b' },
      { path: '/A', group: 'g', shortcut: 'F5' }
    ])
  })
})

describe('folder colors', () => {
  it('keeps valid colors, lower-cased, and drops everything else', () => {
    expect(
      normalizeFolderStyles({
        '/a': { color: '#EF5350', bg: '#4a8cf7' },
        '/b': { color: 'red', bg: '#12345' },
        '/c': { color: '#43b86a', extra: 1 },
        '/d': 'x',
        '': { color: '#000000' }
      })
    ).toEqual({ '/a': { color: '#ef5350', bg: '#4a8cf7' }, '/c': { color: '#43b86a' } })
  })
  it('is absent when the file has none, and survives normalizeState and export → import', () => {
    expect(normalizeState({}).folderStyles).toBeUndefined()
    const st = normalizeState({ prefs: {}, folderStyles: { '/a': { bg: '#26b5a5' } }, favorites: [{ path: '/a', shortcut: 'Ctrl+Alt+9' }] })
    const exported = JSON.parse(JSON.stringify(toExport(st, '1.0.0', 'linux')))
    const back = fromImport(exported, normalizeState({}))
    expect(back.folderStyles).toEqual({ '/a': { bg: '#26b5a5' } })
    expect(back.favorites).toEqual([{ path: '/a', shortcut: 'Ctrl+Alt+9' }])
  })
})

describe('favorites group colors', () => {
  it('keeps valid colors by group name, lower-cased, and survives export → import', () => {
    expect(normalizeGroupColors({ Work: '#A66BE6', Music: 'blue', '': '#ef5350', Old: 3 })).toEqual({ Work: '#a66be6' })
    expect(normalizeState({}).favoriteGroupColors).toBeUndefined()
    const st = normalizeState({ prefs: {}, favoriteGroupColors: { Work: '#43b86a' } })
    const back = fromImport(JSON.parse(JSON.stringify(toExport(st, '1.0.0', 'linux'))), normalizeState({}))
    expect(back.favoriteGroupColors).toEqual({ Work: '#43b86a' })
  })
})
