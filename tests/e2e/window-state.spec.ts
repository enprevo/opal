import { test, expect, type ElectronApplication } from '@playwright/test'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { launch, write, type Harness } from './helpers'
import type { WindowState } from '../../src/shared/types'

let a: Harness | null = null
let b: Harness | null = null

test.afterEach(async () => {
  await a?.close()
  await b?.close()
  a = b = null
})

const win = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    const n = w.getNormalBounds()
    return { width: n.width, height: n.height, maximized: w.isMaximized(), fullScreen: w.isFullScreen() }
  })

/** Quits the app (which saves the settings) and starts it again on the same settings file. */
async function restart(h: Harness): Promise<Harness> {
  await h.app.close()
  const text = await fsp.readFile(path.join(h.userData, 'opal-settings.json'), 'utf8')
  await fsp.rm(h.root, { recursive: true, force: true })
  return launch(async (left) => write(path.join(left, '..', 'userdata', 'opal-settings.json'), text))
}

test('the window opens as it was left: size, maximized, full screen', async () => {
  a = await launch(async (left) => {
    await write(path.join(left, 'a.txt'), 'a')
    const window: WindowState = { width: 1000, height: 640 }
    await write(path.join(left, '..', 'userdata', 'opal-settings.json'), JSON.stringify({ prefs: {}, favorites: [], recent: [], window }))
  })
  await expect.poll(async () => (await win(a!.app)).width).toBe(1000)
  expect((await win(a.app)).height).toBe(640)

  // Maximizing needs a window manager (a bare virtual screen on CI has none): check it only where it works.
  await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize())
  await a.page.waitForTimeout(600)
  if (!(await win(a.app)).maximized) test.skip(true, 'no window manager to maximize the window')
  await expect.poll(async () => (await a!.page.evaluate(() => window.opal.getSettings())).window?.maximized).toBe(true)

  // Started again: maximized, and un-maximizing goes back to the size it had before.
  b = await restart(a)
  a = null
  await expect.poll(async () => (await win(b!.app)).maximized).toBe(true)
  expect((await win(b.app)).width).toBe(1000)

  // Full screen is remembered too; leaving it keeps the window maximized.
  await b.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true))
  await expect.poll(async () => (await b!.page.evaluate(() => window.opal.getSettings())).window?.fullScreen).toBe(true)
  a = await restart(b)
  b = null
  // Wait until the window really covers the screen (the window manager can take a moment after the request).
  const coversScreen = () =>
    a!.app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows()[0]
      const b = w.getBounds()
      const d = screen.getDisplayMatching(b).bounds
      return w.isFullScreen() && b.width === d.width && b.height === d.height
    })
  await expect.poll(coversScreen).toBe(true)
  await a.page.waitForTimeout(300)
  await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(false))
  await expect.poll(async () => (await win(a!.app)).fullScreen).toBe(false)
  const flags = async () => {
    const w = (await a!.page.evaluate(() => window.opal.getSettings())).window
    return { maximized: w?.maximized, fullScreen: w?.fullScreen }
  }
  await expect.poll(flags).toEqual({ maximized: true, fullScreen: undefined })
  expect((await win(a.app)).maximized).toBe(true)

  // Back to a normal window: it opens normal next time.
  await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize())
  await expect.poll(async () => (await a!.page.evaluate(() => window.opal.getSettings())).window?.maximized).toBeUndefined()
  b = await restart(a)
  a = null
  await expect.poll(async () => (await win(b!.app)).width).toBe(1000)
  expect(await win(b.app)).toMatchObject({ maximized: false, fullScreen: false })
})
