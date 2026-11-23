import { test, expect } from '@playwright/test'
import path from 'node:path'
import { launch, write, item, type Harness } from './helpers'

let h: Harness | null = null

test.afterEach(async () => {
  await h?.close()
  h = null
})

const RED = 'rgb(239, 83, 80)'

test('right-click a folder name in the path bar: Properties opens for that folder', async () => {
  h = await launch(async (left) => {
    await write(path.join(left, 'docs', 'a.txt'), 'a')
  })
  const p = h.page
  await p.getByTestId('breadcrumbs-0').getByTestId('crumb').last().click({ button: 'right' })
  await expect(p.getByTestId('folder-menu')).toBeVisible()
  await p.getByTestId('folder-properties').click()
  await expect(p.getByTestId('properties-dialog')).toContainText(path.basename(h.left))
})

test('folder color: path bar, folder tree and file list follow the colors chosen from the menus', async () => {
  h = await launch(async (left) => {
    await write(path.join(left, 'docs', 'a.txt'), 'a')
    await write(path.join(left, 'b.txt'), 'b')
  })
  const p = h.page
  const crumb = p.getByTestId('breadcrumbs-0').getByTestId('crumb').last()
  const node = p.locator(`[data-tree-path="${h.left}"]`)

  // Icon color from the path bar: shows in the path bar and in the folder tree.
  await crumb.click({ button: 'right' })
  await p.getByTestId('folder-color').hover()
  await p.getByTestId('folder-color-red').click()
  await expect(crumb).toHaveCSS('color', RED)
  await expect(node.locator('.tree-icon')).toHaveCSS('color', RED)
  expect((await p.evaluate(() => window.opal.getSettings())).folderStyles?.[h.left]).toEqual({ color: '#ef5350' })

  // Both colors from the folder's own row in the list.
  const docs = path.join(h.left, 'docs')
  await (await item(p, 0, 'docs')).click({ button: 'right' })
  await p.getByTestId('folder-color').hover()
  await p.getByTestId('folder-color-orange').click()
  await (await item(p, 0, 'docs')).click({ button: 'right' })
  await p.getByTestId('row-color').hover()
  await p.getByTestId('row-color-green').click()
  await (await item(p, 0, 'b.txt')).click() // move the selection away: a selected row keeps the selection color
  const row = await item(p, 0, 'docs')
  await expect(row).toHaveClass(/tinted/)
  await expect(row.locator('img.file-icon')).toHaveAttribute('src', /%23fb8c3c/)
  expect(await row.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
  expect((await p.evaluate(() => window.opal.getSettings())).folderStyles?.[docs]).toEqual({ color: '#fb8c3c', bg: '#43b86a' })

  // Back to the default look removes the entry.
  await (await item(p, 0, 'docs')).click({ button: 'right' })
  await p.getByTestId('folder-color').hover()
  await p.getByTestId('folder-color-default').click()
  await (await item(p, 0, 'docs')).click({ button: 'right' })
  await p.getByTestId('row-color').hover()
  await p.getByTestId('row-color-default').click()
  await expect.poll(async () => (await p.evaluate(() => window.opal.getSettings())).folderStyles?.[docs]).toBeUndefined()
})

test('favorite with a shortcut: set from the folder tree, opens the folder from anywhere', async () => {
  h = await launch(async (left) => {
    await write(path.join(left, 'docs', 'a.txt'), 'a')
  })
  const p = h.page
  const crumbs = p.getByTestId('breadcrumbs-0').getByTestId('crumb')
  const here = path.basename(h.left)

  await p.locator(`[data-tree-path="${h.left}"]`).click({ button: 'right' })
  await p.getByTestId('folder-shortcut').click()
  const dialog = p.getByTestId('folder-options-dialog')
  await expect(dialog).toBeVisible()

  // Keys that cannot work as a shortcut, or are taken, are refused with the reason.
  await p.getByTestId('shortcut-field').click()
  await p.keyboard.press('k')
  await expect(p.getByTestId('shortcut-problem')).toContainText('Ctrl or Alt')
  await expect(p.getByTestId('folder-options-ok')).toBeDisabled()
  await p.getByTestId('shortcut-field').click()
  await p.keyboard.press('Control+c')
  await expect(p.getByTestId('shortcut-problem')).toContainText('Already used')
  await expect(p.getByTestId('folder-options-ok')).toBeDisabled()

  await p.getByTestId('shortcut-field').click()
  await p.keyboard.press('Control+Alt+k')
  await expect(p.getByTestId('shortcut-field')).toHaveText('Ctrl+Alt+K')
  await expect(p.getByTestId('in-favorites')).toBeChecked() // recording a shortcut adds the favorite
  await p.getByTestId('bg-field').locator('[data-color="#4a8cf7"]').click()
  await p.getByTestId('folder-options-ok').click()
  await expect(dialog).toHaveCount(0)

  await expect(p.getByTestId('favbar-item')).toHaveCount(1)
  await expect(p.getByTestId('favbar-item')).toHaveAttribute('data-help-desc', /Ctrl\+Alt\+K/)
  const saved = await p.evaluate(() => window.opal.getSettings())
  expect(saved.favorites).toEqual([{ path: h!.left, shortcut: 'Ctrl+Alt+K' }])
  expect(saved.folderStyles?.[h.left]).toEqual({ bg: '#4a8cf7' })

  // Go somewhere else, then jump back with the shortcut.
  await (await item(p, 0, 'docs')).dblclick()
  await expect(crumbs.last()).toHaveText('docs')
  await p.keyboard.press('Control+Alt+k')
  await expect(crumbs.last()).toHaveText(here)

  // The same shortcut cannot be given to another folder.
  await (await item(p, 0, 'docs')).dblclick()
  await p.getByTestId('breadcrumbs-0').getByTestId('crumb').last().click({ button: 'right' })
  await p.getByTestId('folder-shortcut').click()
  await p.getByTestId('shortcut-field').click()
  await p.keyboard.press('Control+Alt+k')
  await expect(p.getByTestId('shortcut-problem')).toContainText(here)
  await p.getByTestId('folder-options-dialog').getByRole('button', { name: 'Cancel' }).click()

  // Removing the favorite frees the shortcut.
  await p.getByTestId('favbar-item').click({ button: 'right' })
  await expect(p.getByTestId('favorite-menu')).toBeVisible()
  await p.getByTestId('folder-unfavorite').click()
  await expect(p.getByTestId('favbar-item')).toHaveCount(0)
  await p.keyboard.press('Control+Alt+k')
  await expect(crumbs.last()).toHaveText('docs')
})
