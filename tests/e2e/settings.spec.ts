import { test, expect, type ElectronApplication } from '@playwright/test'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { launch, write, item, type Harness } from './helpers'

let a: Harness | null = null
let b: Harness | null = null

test.afterEach(async () => {
  await a?.close()
  await b?.close()
  a = b = null
})

/** Replaces the native file dialogs so the test can choose the paths. */
async function stubDialogs(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: f })) as typeof dialog.showSaveDialog
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as typeof dialog.showOpenDialog
  }, file)
}

test('every setting survives export → new profile → import', async () => {
  a = await launch(async (left) => {
    await write(path.join(left, 'docs', 'a.txt'), 'a')
    await write(path.join(left, 'b.txt'), 'b')
  })
  const exportFile = path.join(a.root, 'exported-settings.json')
  const pa = a.page

  // Appearance + key map (UI).
  await pa.getByTestId('tb-prefs').click()
  await pa.getByTestId('accent-picker').locator('button').nth(4).click()
  await pa.getByTestId('theme-select').getByText('Light').click()
  await pa.getByTestId('prefs-close').click()

  // A grouped, renamed favorite (UI).
  await (await item(pa, 0, 'docs')).dblclick()
  await pa.keyboard.press('ControlOrMeta+D')
  await expect(pa.getByTestId('favorite-item')).toHaveCount(1)
  await pa.getByTestId('favorite-item').click({ button: 'right' })
  await pa.getByTestId('favorite-rename').click()
  await pa.getByTestId('prompt-input').fill('My documents')
  await pa.getByTestId('prompt-ok').click()
  await expect(pa.getByTestId('favorite-item')).toHaveText(/My documents/)

  // Hotkeys, window layout, column widths, rename presets and semantic folders through the settings bridge.
  await pa.evaluate(
    (dir) =>
      window.opal.setSettings({
        hotkeys: { 'Ctrl+J': 'Set THEME=toggle', 'Ctrl+K': '' },
        ui: { sidebarWidth: 333, paneRatio: 0.4, columnWidths: { name: 420 } },
        renamePresets: { 'Date prefix': { oldPattern: '*', newPattern: '{date|yyyy-MM-dd} *' } },
        labels: { [dir]: ['red'] }
      }),
    path.join(a.left, 'b.txt')
  )
  await stubDialogs(a.app, exportFile)
  await pa.getByTestId('tb-prefs').click()
  await pa.getByTestId('prefs-tab-backup').click()
  await pa.getByTestId('prefs-export').click()
  await expect.poll(() => fsp.readFile(exportFile, 'utf8').catch(() => '')).toContain('"format": "opal-settings"')
  const exported = JSON.parse(await fsp.readFile(exportFile, 'utf8'))
  expect(exported.session).toBeUndefined()
  expect(exported.recent).toBeUndefined()

  // A brand-new profile imports the file.
  b = await launch()
  const pb = b.page
  await expect(pb.locator('html')).toHaveAttribute('data-theme', 'dark')
  await stubDialogs(b.app, exportFile)
  await pb.getByTestId('tb-prefs').click()
  await pb.getByTestId('prefs-tab-backup').click()
  await pb.getByTestId('prefs-import').click()
  // The window reloads with the imported settings.
  await expect(pb.locator('html')).toHaveAttribute('data-theme', 'light', { timeout: 15000 })
  await pb.waitForSelector('[data-testid="list-0"]')
  expect(await pb.evaluate(() => document.documentElement.style.getPropertyValue('--accent'))).toBe('#ff375f')
  await expect(pb.getByTestId('favorite-item')).toHaveText(/My documents/)
  await expect(pb.locator('.sidebar-wrap')).toHaveAttribute('style', /width: 333px/)
  const st = await pb.evaluate(() => window.opal.getSettings())
  expect(st.hotkeys).toMatchObject({ 'Ctrl+J': 'Set THEME=toggle', 'Ctrl+K': '' })
  expect(st.ui?.columnWidths?.name).toBe(420)
  expect(Object.keys(st.renamePresets ?? {})).toEqual(['Date prefix'])
  expect(Object.values(st.labels ?? {})).toEqual([['red']])
  // The imported custom key works.
  await pb.locator('[data-testid="list-0"]').click({ position: { x: 300, y: 300 } })
  await pb.keyboard.press('ControlOrMeta+J')
  await expect(pb.locator('html')).toHaveAttribute('data-theme', 'dark')
  // Settings were written to disk, not only kept in memory.
  const onDisk = JSON.parse(await fsp.readFile(path.join(b.userData, 'opal-settings.json'), 'utf8'))
  expect(onDisk.favorites[0].label).toBe('My documents')
})

test('importing a file that is not Opal settings shows an error and changes nothing', async () => {
  a = await launch()
  const bad = path.join(a.root, 'bad.json')
  await fsp.writeFile(bad, JSON.stringify({ hello: 'world' }))
  await stubDialogs(a.app, bad)
  await a.page.getByTestId('tb-prefs').click()
  await a.page.getByTestId('prefs-tab-backup').click()
  await a.page.getByTestId('prefs-import').click()
  await expect(a.page.locator('.toast')).toContainText('not an Opal settings file')
  await expect(a.page.locator('html')).toHaveAttribute('data-theme', 'dark')
})
