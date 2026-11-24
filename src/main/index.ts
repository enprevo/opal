import { app, BrowserWindow, ipcMain, shell, protocol, net, nativeImage, nativeTheme, Menu, clipboard, dialog, screen } from 'electron'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawn } from 'node:child_process'
import { readFileSync, watch, promises as fsp, type FSWatcher } from 'node:fs'
import { pathToFileURL } from 'node:url'
import * as fsx from './fsService'
import { SettingsStore } from './settings'
import { fromImport, toExport } from '../shared/settings'
import { SemanticClient } from './semantic/client'
import type { SemanticOptions } from './semantic'
import { listZip } from './semantic/extract'
import type { FindOptions, PersistedState, SemanticSearchOptions, TransferRequest, WindowState } from '../shared/types'

if (process.env.OPAL_USER_DATA) app.setPath('userData', process.env.OPAL_USER_DATA)

// Ubuntu 23.10+ restricts unprivileged user namespaces with AppArmor, so the Chromium sandbox cannot start
// from an AppImage (the .deb package installs a proper sandbox helper and is unaffected).
if (process.platform === 'linux' && process.env.APPIMAGE) {
  try {
    if (readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim() === '1') app.commandLine.appendSwitch('no-sandbox')
  } catch {
    // not an AppArmor system
  }
}

/** Opens a terminal in `cwd`, trying the usual emulators of each platform in turn. */
function openTerminal(cwd: string): void {
  const candidates: [string, string[]][] =
    process.platform === 'win32'
      ? [
          ['wt.exe', ['-d', cwd]],
          ['cmd.exe', ['/c', 'start', 'cmd.exe']]
        ]
      : process.platform === 'darwin'
        ? [['open', ['-a', 'Terminal', cwd]]]
        : [
            ['x-terminal-emulator', []],
            ['gnome-terminal', [`--working-directory=${cwd}`]],
            ['konsole', ['--workdir', cwd]],
            ['xfce4-terminal', [`--working-directory=${cwd}`]],
            ['kitty', []],
            ['alacritty', []],
            ['xterm', []]
          ]
  const attempt = (i: number): void => {
    if (i >= candidates.length) return
    const [cmd, args] = candidates[i]
    const child = spawn(cmd, args, { cwd, detached: true, stdio: 'ignore' })
    child.on('error', () => attempt(i + 1))
    child.unref()
  }
  attempt(0)
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'opal', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])

const settings = new SettingsStore(path.join(app.getPath('userData'), 'opal-settings.json'))
const undoByWindow = new Map<number, fsx.UndoManager>()
function undoFor(sender: Electron.WebContents): fsx.UndoManager {
  let u = undoByWindow.get(sender.id)
  if (!u) {
    const created = new fsx.UndoManager((p) => shell.trashItem(p))
    u = created
    const id = sender.id
    undoByWindow.set(id, created)
    sender.once('destroyed', () => undoByWindow.delete(id))
  }
  return u
}
const jobs = new Map<string, fsx.CancelToken>()
const iconCache = new Map<string, string>()
const watchersByWindow = new Map<number, Map<string, FSWatcher>>()
const windowStarts = new Map<number, { paths: string[]; primary: boolean }>()
let mainWindow: BrowserWindow | null = null

let semantic: SemanticClient | null = null
function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send(channel, payload)
}
/** The semantic index lives in a utility process; this is its proxy. */
function semanticIndex(): SemanticClient {
  if (!semantic) {
    semantic = new SemanticClient(
      {
        dir: path.join(app.getPath('userData'), 'semantic'),
        modelDir: process.env.OPAL_MODEL_DIR || path.join(app.getPath('userData'), 'models'),
        embedder: process.env.OPAL_EMBEDDER === 'hash' ? 'hash' : 'model'
      },
      (st) => broadcast('semantic:status', st)
    )
  }
  return semantic
}
function semanticOptions(): SemanticOptions {
  const p = settings.get().prefs
  return { includeCode: !!p.semanticIncludeCode, rerank: p.semanticPrecise !== false }
}

function tokenFor(jobId: string): fsx.CancelToken {
  const t = { cancelled: false }
  jobs.set(jobId, t)
  return t
}

function iconKey(p: string, isDir: boolean): string {
  if (isDir) return process.platform === 'win32' && /^[a-z]:\\?$/i.test(p) ? p.toLowerCase() : '<dir>'
  const ext = path.extname(p).toLowerCase()
  return ['.exe', '.lnk', '.ico', '.url', '.app', ''].includes(ext) ? p : ext
}

function registerIpc(): void {
  ipcMain.handle('app:info', (e) => {
    const w = windowStarts.get(e.sender.id)
    const envStarts = process.env.OPAL_START_PATHS ? process.env.OPAL_START_PATHS.split('|') : []
    return {
      platform: process.platform,
      home: os.homedir(),
      sep: path.sep,
      argv: w?.primary ? process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-')) : [],
      startPaths: w && !w.primary ? w.paths : envStarts,
      primary: w?.primary ?? true,
      noSetup: process.env.OPAL_NO_SETUP === '1',
      version: app.getVersion()
    }
  })

  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:set', (_e, patch: Partial<PersistedState>) => settings.update(patch))

  ipcMain.handle('fs:list', (_e, p: string, flat?: boolean) => (flat ? fsx.listFlat(p) : fsx.listDir(p)))
  ipcMain.handle('fs:hash', (_e, p: string, algo: 'md5' | 'sha1' | 'sha256') => fsx.hashFile(p, algo))
  ipcMain.handle('fs:duplicates', async (_e, root: string, opts: { minSize?: number; recursive?: boolean }, jobId: string) => {
    const token = tokenFor(jobId)
    try {
      return await fsx.findDuplicates(root, opts, token)
    } finally {
      jobs.delete(jobId)
    }
  })
  ipcMain.handle('window:new', (_e, startPath?: string) => {
    createWindow(startPath ? [startPath] : [])
  })
  ipcMain.handle('fs:subdirs', (_e, p: string, showHidden: boolean) => fsx.listSubdirs(p, showHidden))
  ipcMain.handle('fs:roots', () => fsx.getRoots())
  ipcMain.handle('fs:exists', async (_e, paths: string[]) => Promise.all(paths.map(fsx.pathExists)))
  ipcMain.handle('fs:sameVolume', async (_e, a: string, b: string) => fsx.sameVolume(a, b))
  ipcMain.handle('fs:stat', (_e, p: string) => fsx.statEntry(p))

  ipcMain.handle('fs:mkdir', async (e, parent: string, name: string) => {
    const p = await fsx.makeDir(parent, name)
    await undoFor(e.sender).push({ type: 'create', created: [p] })
    return p
  })
  ipcMain.handle('fs:createFile', async (e, parent: string, name: string) => {
    const p = await fsx.createFile(parent, name)
    await undoFor(e.sender).push({ type: 'create', created: [p] })
    return p
  })
  ipcMain.handle('fs:rename', async (e, from: string, newName: string) => {
    const to = await fsx.renameItem(from, newName)
    if (to !== from) await undoFor(e.sender).push({ type: 'rename', pairs: [{ from, to }] })
    return to
  })
  ipcMain.handle('fs:renameMany', async (e, pairs: { from: string; to: string }[]) => {
    const r = await fsx.renameMany(pairs)
    if (r.done.length) await undoFor(e.sender).push({ type: 'rename', pairs: r.done })
    return r
  })
  ipcMain.handle('fs:delete', async (_e, paths: string[], useTrash: boolean) => {
    if (!useTrash) return fsx.deletePermanent(paths)
    const errors: string[] = []
    for (const p of paths) {
      try {
        await shell.trashItem(p)
      } catch (e) {
        errors.push(`${path.basename(p)}: ${(e as Error).message}`)
      }
    }
    return errors
  })

  ipcMain.handle('fs:transfer', async (e, req: TransferRequest, jobId: string) => {
    const token = tokenFor(jobId)
    try {
      const res = await fsx.transfer(req, jobId, (p) => e.sender.send('job:progress', p), token)
      if (res.undo) await undoFor(e.sender).push(res.undo)
      return res.progress
    } finally {
      jobs.delete(jobId)
    }
  })
  ipcMain.handle('job:cancel', (_e, jobId: string) => {
    const t = jobs.get(jobId)
    if (t) t.cancelled = true
  })

  ipcMain.handle('fs:size', async (_e, p: string, jobId: string) => {
    const token = tokenFor(jobId)
    try {
      return await fsx.folderSize(p, token)
    } finally {
      jobs.delete(jobId)
    }
  })

  ipcMain.handle('fs:find', async (e, opts: FindOptions, jobId: string) => {
    const token = tokenFor(jobId)
    try {
      return await fsx.find(opts, (entries) => e.sender.send('find:results', { jobId, entries }), token)
    } finally {
      jobs.delete(jobId)
    }
  })

  ipcMain.handle('fs:preview', (_e, p: string) => fsx.readPreview(p))
  ipcMain.handle('fs:meta', (_e, paths: string[]) => fsx.itemMeta(paths))
  ipcMain.handle('fs:zipList', (_e, p: string) => listZip(p))

  ipcMain.handle('semantic:status', async (_e, start = true) => {
    const idx = semanticIndex()
    // Don't spawn the indexer just to report "nothing indexed" when the user never set it up.
    if (!idx.running && !start && !settings.get().prefs.semanticFolders?.length) return idx.lastStatus()
    if (!idx.running) await idx.setOptions(semanticOptions())
    if (start) void idx.warm()
    return idx.status()
  })
  ipcMain.handle('semantic:setFolders', async (_e, folders: string[]) => {
    const idx = semanticIndex()
    await idx.setOptions(semanticOptions())
    await idx.setFolders(folders)
    void idx.rescan()
    return idx.status()
  })
  ipcMain.handle('semantic:setOptions', async (_e, opts: Partial<SemanticOptions>) => {
    const idx = semanticIndex()
    if (await idx.setOptions(opts)) void idx.rescan()
    return idx.status()
  })
  ipcMain.handle('semantic:rescan', async () => {
    const idx = semanticIndex()
    await idx.rescan()
    return idx.status()
  })
  ipcMain.handle('semantic:search', (_e, q: string, opts: SemanticSearchOptions) => semanticIndex().search(q, { ...opts, explain: false }))
  ipcMain.handle('semantic:cancel', () => semanticIndex().cancel())
  ipcMain.handle('semantic:clear', () => semanticIndex().clear())

  ipcMain.handle('theme:system', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'))
  nativeTheme.on('updated', () => broadcast('theme:changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light'))

  ipcMain.handle('settings:export', async (e) => {
    const parent = BrowserWindow.fromWebContents(e.sender) ?? mainWindow!
    const r = await dialog.showSaveDialog(parent, { defaultPath: 'opal-settings.json', filters: [{ name: 'Opal settings', extensions: ['json'] }] })
    if (r.canceled || !r.filePath) return null
    await settings.flush()
    await fsp.writeFile(r.filePath, JSON.stringify(toExport(settings.get(), app.getVersion(), process.platform), null, 2), 'utf8')
    return r.filePath
  })
  ipcMain.handle('settings:import', async (e) => {
    const parent = BrowserWindow.fromWebContents(e.sender) ?? mainWindow!
    const r = await dialog.showOpenDialog(parent, { properties: ['openFile'], filters: [{ name: 'Opal settings', extensions: ['json'] }] })
    if (r.canceled || !r.filePaths[0]) return false
    let raw: unknown
    try {
      raw = JSON.parse(await fsp.readFile(r.filePaths[0], 'utf8'))
    } catch {
      throw new Error('This file is not valid JSON')
    }
    const next = settings.replace(fromImport(raw, settings.get()))
    await settings.flush()
    // The semantic index follows the imported folders and options.
    if (semantic || next.prefs.semanticFolders.length) {
      const idx = semanticIndex()
      void idx
        .setOptions(semanticOptions())
        .then(() => idx.setFolders(next.prefs.semanticFolders))
        .then(() => (next.prefs.semanticFolders.length ? idx.rescan() : undefined))
        .catch(() => undefined)
    }
    for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.reload()
    return true
  })
  ipcMain.handle('fs:setAttr', (_e, p: string, attrs: { readonly?: boolean; mtime?: number }) => fsx.setAttributes(p, attrs))
  ipcMain.handle('fs:compare', (_e, l: string, r: string, rec: boolean) => fsx.compareFolders(l, r, rec))
  ipcMain.handle('fs:split', (_e, file: string, dest: string, bytes: number) => fsx.splitFile(file, dest, bytes))
  ipcMain.handle('fs:join', (_e, parts: string[], target: string) => fsx.joinFiles(parts, target))

  ipcMain.handle('undo:do', (e) => undoFor(e.sender).undo())
  ipcMain.handle('undo:info', (e) => {
    const u = undoFor(e.sender)
    return { available: u.size > 0, label: u.peekLabel() }
  })

  ipcMain.handle('shell:open', (_e, p: string) => shell.openPath(p))
  ipcMain.handle('shell:reveal', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('shell:run', (_e, cmdline: string, cwd: string) => {
    const child = spawn(cmdline, { cwd, shell: true, detached: true, stdio: 'ignore', windowsHide: false })
    child.on('error', () => undefined)
    child.unref()
  })
  ipcMain.handle('shell:terminal', (_e, cwd: string) => openTerminal(cwd))

  ipcMain.handle('clipboard:writeText', (_e, text: string) => clipboard.writeText(text))

  ipcMain.handle('dialog:pickFolder', async (e) => {
    const parent = BrowserWindow.fromWebContents(e.sender) ?? mainWindow!
    const r = await dialog.showOpenDialog(parent, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('icon:get', async (_e, p: string, isDir: boolean, size: 'small' | 'normal' | 'large' = 'small') => {
    const key = iconKey(p, isDir) + '|' + size
    const cached = iconCache.get(key)
    if (cached !== undefined) return cached
    try {
      const img = await app.getFileIcon(p, { size })
      const url = img.isEmpty() ? '' : img.toDataURL()
      iconCache.set(key, url)
      return url
    } catch {
      iconCache.set(key, '')
      return ''
    }
  })

  ipcMain.on('watch:set', (e, dirs: string[]) => {
    const wanted = new Set(dirs)
    const senderId = e.sender.id
    let watchers = watchersByWindow.get(senderId)
    if (!watchers) {
      const created = new Map<string, FSWatcher>()
      watchers = created
      watchersByWindow.set(senderId, created)
      e.sender.once('destroyed', () => {
        for (const w of created.values()) w.close()
        watchersByWindow.delete(senderId)
      })
    }
    const ws = watchers
    for (const [dir, w] of ws) {
      if (!wanted.has(dir)) {
        w.close()
        ws.delete(dir)
      }
    }
    for (const dir of wanted) {
      if (ws.has(dir)) continue
      try {
        let timer: NodeJS.Timeout | null = null
        const w = watch(dir, { persistent: false }, () => {
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            if (!e.sender.isDestroyed()) e.sender.send('watch:changed', dir)
          }, 250)
        })
        w.on('error', () => {
          w.close()
          ws.delete(dir)
        })
        ws.set(dir, w)
      } catch {
        // not watchable
      }
    }
  })

  ipcMain.on('drag:start', async (e, paths: string[]) => {
    try {
      const icon = await app.getFileIcon(paths[0], { size: 'normal' })
      e.sender.startDrag({ file: paths[0], files: paths, icon })
    } catch {
      // ignore
    }
  })
}

function registerProtocol(): void {
  protocol.handle('opal', async (request) => {
    const url = new URL(request.url)
    const p = url.searchParams.get('p')
    if (!p) return new Response('missing path', { status: 400 })
    if (url.hostname === 'thumb') {
      const size = Number(url.searchParams.get('s') ?? 128)
      try {
        let img: Electron.NativeImage
        if (process.platform === 'linux') {
          img = nativeImage.createFromPath(p)
          if (!img.isEmpty()) img = img.resize({ width: size })
        } else {
          img = await nativeImage.createThumbnailFromPath(p, { width: size, height: size })
        }
        if (img.isEmpty()) return new Response('no thumbnail', { status: 404 })
        return new Response(new Uint8Array(img.toPNG()), { headers: { 'content-type': 'image/png' } })
      } catch {
        return new Response('no thumbnail', { status: 404 })
      }
    }
    return net.fetch(pathToFileURL(p).toString(), { headers: request.headers })
  })
}

/** The remembered window, with its place dropped when no connected screen shows enough of it (a monitor was unplugged). */
function savedWindow(): WindowState | undefined {
  const w = settings.get().window
  if (!w || w.x === undefined || w.y === undefined) return w
  const { x, y, width } = w
  const visible = screen.getAllDisplays().some(({ workArea: a }) => {
    const overlapX = Math.min(x + width, a.x + a.width) - Math.max(x, a.x)
    return overlapX >= 100 && y >= a.y - 20 && y < a.y + a.height - 50
  })
  if (visible) return w
  const { x: _x, y: _y, ...rest } = w // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest
}

/** Save the state of each open window now (used when quitting). */
const windowSavers = new Set<() => void>()

/**
 * Keeps the window's size, place and maximized / full-screen state in the settings as they change, and returns
 * what opens it as it was left. The size and place of the normal (not maximized) window are kept here rather than
 * asked of the system, and so is whether it was maximized before full screen: some Linux window managers forget
 * both for a window that opened maximized or full screen, and drop a maximize asked while the window appears.
 */
function rememberWindow(win: BrowserWindow, start?: WindowState): () => void {
  const sameBox = (r: Electron.Rectangle, n: Electron.Rectangle): boolean =>
    Math.abs(r.width - n.width) < 2 && Math.abs(r.height - n.height) < 2 && Math.abs(r.x - n.x) < 2 && Math.abs(r.y - n.y) < 2
  const alive = (): boolean => !win.isDestroyed()
  const plain = (): boolean => alive() && !win.isMaximized() && !win.isFullScreen() && !win.isMinimized()
  const first = win.getBounds()
  let normal: Electron.Rectangle = start ? { width: start.width, height: start.height, x: start.x ?? first.x, y: start.y ?? first.y } : first
  /** Maximized when not in full screen. */
  let maxed = !!start?.maximized
  /** Until then the window is still appearing: a maximize the system drops is asked again. */
  let settleUntil = 0
  let timer: NodeJS.Timeout | null = null
  const save = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    if (!alive() || win.isMinimized()) return
    if (plain()) normal = win.getBounds()
    const full = win.isFullScreen()
    if (!full && Date.now() > settleUntil) maxed = win.isMaximized()
    const state: WindowState = { width: normal.width, height: normal.height, x: normal.x, y: normal.y }
    if (maxed) state.maximized = true
    if (full) state.fullScreen = true
    settings.update({ window: state })
  }
  const later = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 400)
  }
  // Back from maximized or full screen: maximized again if it was before full screen, otherwise at its normal
  // size and place, when the system did not do it.
  const back = (): void => {
    later()
    setTimeout(() => {
      if (!alive() || win.isFullScreen()) return
      if (maxed && !win.isMaximized()) win.maximize()
      else if (plain() && !sameBox(win.getBounds(), normal)) win.setBounds(normal)
    }, 150)
  }
  win.on('resize', later)
  win.on('move', later)
  win.on('maximize', later)
  win.on('enter-full-screen', later)
  win.on('unmaximize', () => {
    if (Date.now() > settleUntil && !win.isFullScreen()) maxed = false
    back()
  })
  win.on('leave-full-screen', back)
  win.on('close', save)
  windowSavers.add(save)
  win.on('closed', () => windowSavers.delete(save))

  // Asked until it holds (maximized: for a moment; at most three seconds). Full screen is asked once the window has settled on
  // screen, and checked by the window really covering the screen: asked too early, the request can be lost while
  // the window still reports full screen.
  const coversScreen = (): boolean => {
    const b = win.getBounds()
    const d = screen.getDisplayMatching(b).bounds
    return b.width >= d.width && b.height >= d.height
  }
  return () => {
    if (!start?.maximized && !start?.fullScreen) return
    const shown = Date.now()
    settleUntil = shown + 3000
    let heldSince = 0
    let askedFull = 0
    const tick = (): void => {
      if (!alive() || !settleUntil) return
      const now = Date.now()
      const ok = start.fullScreen ? win.isFullScreen() && coversScreen() : win.isMaximized()
      if (ok) {
        heldSince ||= now
        if (start.fullScreen || now - heldSince >= 600) return void (settleUntil = 0)
      } else {
        heldSince = 0
        if (now > settleUntil) return void (settleUntil = 0)
        if (start.maximized && !win.isMaximized() && !win.isFullScreen()) win.maximize()
        if (start.fullScreen && now - shown >= 300 && now - askedFull >= 700) {
          askedFull = now
          if (win.isFullScreen()) win.setFullScreen(false)
          win.setFullScreen(true)
        }
      }
      setTimeout(tick, 150)
    }
    tick()
  }
}

function createWindow(startPaths?: string[]): void {
  // The first window opens as it was last left; more windows open at the saved size, placed by the system.
  const primary = startPaths === undefined && BrowserWindow.getAllWindows().length === 0
  const saved = savedWindow()
  const place = primary && saved?.x !== undefined ? { x: saved.x, y: saved.y } : {}
  const win = new BrowserWindow({
    width: saved?.width ?? 1440,
    height: saved?.height ?? 900,
    ...place,
    minWidth: 800,
    minHeight: 500,
    show: false,
    title: 'Opal',
    // Windows and macOS take the icon from the executable/bundle; Linux needs it on the window.
    ...(process.platform === 'linux' ? { icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(app.getAppPath(), 'build', 'icon.png') } : {}),
    backgroundColor: settings.get().prefs.theme === 'light' ? '#f3f3f3' : '#1e1f22',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      plugins: true
    }
  })
  if (!mainWindow) mainWindow = win
  const openAsLeft = rememberWindow(win, primary ? saved : undefined)
  const wcId = win.webContents.id
  windowStarts.set(wcId, { paths: startPaths ?? [], primary: startPaths === undefined })
  win.on('closed', () => {
    windowStarts.delete(wcId)
    if (mainWindow === win) mainWindow = BrowserWindow.getAllWindows()[0] ?? null
  })
  win.once('ready-to-show', () => {
    win.show()
    openAsLeft()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && input.control && input.shift) win.webContents.toggleDevTools()
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function buildMenu(): void {
  if (process.platform === 'darwin') {
    // Edit actions are routed to the renderer: native editing inside text fields, Opal commands in the file displays.
    const edit = (label: string, accelerator: string, action: string): Electron.MenuItemConstructorOptions => ({
      label,
      accelerator,
      click: (_item, win) => (win as BrowserWindow | undefined)?.webContents.send('menu:edit', action)
    })
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        {
          label: 'Edit',
          submenu: [
            edit('Undo', 'CmdOrCtrl+Z', 'undo'),
            edit('Redo', 'Shift+CmdOrCtrl+Z', 'redo'),
            { type: 'separator' },
            edit('Cut', 'CmdOrCtrl+X', 'cut'),
            edit('Copy', 'CmdOrCtrl+C', 'copy'),
            edit('Paste', 'CmdOrCtrl+V', 'paste'),
            edit('Select All', 'CmdOrCtrl+A', 'selectAll')
          ]
        },
        { label: 'View', submenu: [{ role: 'togglefullscreen' }] },
        { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] }
      ])
    )
  } else {
    Menu.setApplicationMenu(null)
  }
}

const NATIVE_EDIT = new Set(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])
ipcMain.on('edit:native', (e, action: string) => {
  if (!NATIVE_EDIT.has(action)) return
  const wc = e.sender as unknown as Record<string, () => void>
  wc[action]()
})

app.whenReady().then(async () => {
  await settings.load()
  registerIpc()
  registerProtocol()
  buildMenu()
  createWindow()
  // Keep the semantic index fresh in the background (after startup work has settled).
  const prefs = settings.get().prefs
  if (prefs.semanticAutoIndex && prefs.semanticFolders?.length) {
    setTimeout(() => {
      const idx = semanticIndex()
      void idx
        .setOptions(semanticOptions())
        .then(() => idx.setFolders(prefs.semanticFolders))
        .then(() => idx.rescan())
        .catch(() => undefined)
    }, 8000)
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let settingsSaved = false
app.on('before-quit', (e) => {
  if (settingsSaved) return
  // Quitting (menu, Ctrl+Q, the system) does not wait for promises: hold it until the settings, with the window as
  // it is now, are on disk.
  e.preventDefault()
  settingsSaved = true
  for (const save of windowSavers) save()
  void semantic?.stop()
  void settings
    .flush()
    .catch(() => undefined)
    .finally(() => app.quit())
})
app.on('window-all-closed', () => {
  void settings.flush().finally(() => {
    if (process.platform !== 'darwin') app.quit()
  })
})
