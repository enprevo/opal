import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import { launch, write, item, focusedName, type Harness } from './helpers'

let h: Harness | null = null

test.afterEach(async () => {
  await h?.close()
  h = null
})

const saved = (p: Page) => p.evaluate(() => window.opal.getSettings())

test('favorites bar: drag folders and files in, open them, group them in a folder', async () => {
  h = await launch(async (left) => {
    await write(path.join(left, 'docs', 'a.txt'), 'a')
    await write(path.join(left, 'music', 'b.txt'), 'b')
    await write(path.join(left, 'note.txt'), 'n')
  })
  const p = h.page
  const bar = p.getByTestId('favorites-bar')
  const items = bar.getByTestId('favbar-item')
  const crumbs = p.getByTestId('breadcrumbs-0').getByTestId('crumb')
  const here = path.basename(h.left)
  const docs = path.join(h.left, 'docs')
  const music = path.join(h.left, 'music')
  const note = path.join(h.left, 'note.txt')

  await expect(bar).toBeVisible()
  await expect(p.getByTestId('favbar-hint')).toBeVisible()

  // Drag a folder and a file from the list onto the bar.
  await (await item(p, 0, 'docs')).dragTo(bar)
  await expect(items).toHaveCount(1)
  await expect(items.first()).toHaveText('docs')
  await (await item(p, 0, 'note.txt')).dragTo(bar)
  await expect(items).toHaveCount(2)
  await expect(items.nth(1)).toHaveText('note.txt')
  await expect(p.getByTestId('favbar-hint')).toHaveCount(0)
  await expect.poll(async () => (await saved(p)).favorites).toEqual([{ path: docs }, { path: note, file: true }])
  // The sidebar lists the same favorites.
  await expect(p.getByTestId('favorite-item')).toHaveCount(2)

  // Dropping the same item again does not double it.
  await (await item(p, 0, 'docs')).dragTo(bar)
  await expect(items).toHaveCount(2)

  // Clicking a folder goes into it.
  await items.first().click()
  await expect(crumbs.last()).toHaveText('docs')
  await expect(items.first()).toHaveClass(/current/)

  // A file: "Show in folder" goes to its folder with the file focused.
  await items.nth(1).click({ button: 'right' })
  await expect(p.getByTestId('favorite-file-menu')).toBeVisible()
  await p.getByTestId('favorite-show-in-folder').click()
  await expect(crumbs.last()).toHaveText(here)
  await expect.poll(() => focusedName(p, 0)).toBe('note.txt')

  // Reorder: drag the file before the folder.
  await items.nth(1).dragTo(items.first(), { targetPosition: { x: 3, y: 10 } })
  await expect(items.first()).toHaveText('note.txt')
  await expect(items.nth(1)).toHaveText('docs')

  // A group shows as a folder on the bar.
  await p.getByTestId('favbar-new-group').click()
  await p.getByTestId('prompt-input').fill('Work')
  await p.getByTestId('prompt-ok').click()
  const group = bar.getByTestId('favbar-group')
  await expect(group).toHaveText(/Work/)
  await group.click()
  await expect(p.getByTestId('favbar-dropdown-empty')).toBeVisible()
  await p.keyboard.press('Escape')
  await expect(p.getByTestId('favbar-dropdown')).toHaveCount(0)

  // Drop a favorite from the bar into the group, and a folder from the list too.
  const box = (await group.boundingBox())!
  await items.nth(1).dragTo(group, { targetPosition: { x: box.width / 2, y: box.height / 2 } })
  await expect(items).toHaveCount(1)
  await (await item(p, 0, 'music')).dragTo(group, { targetPosition: { x: box.width / 2, y: box.height / 2 } })
  await expect.poll(async () => (await saved(p)).favorites).toEqual([
    { path: note, file: true },
    { path: docs, group: 'Work' },
    { path: music, group: 'Work' }
  ])

  // Open the group and click a folder in it: the pane goes into it.
  await group.click()
  const list = p.getByTestId('favbar-dropdown').getByTestId('favbar-dropdown-item')
  await expect(list).toHaveText(['docs', 'music'])
  await list.nth(1).click()
  await expect(p.getByTestId('favbar-dropdown')).toHaveCount(0)
  await expect(crumbs.last()).toHaveText('music')

  // Removing the group keeps its favorites on the bar.
  await group.click({ button: 'right' })
  await p.getByTestId('favbar-group-remove').click()
  await expect(group).toHaveCount(0)
  await expect(items).toHaveText(['note.txt', 'docs', 'music'])

  // The bar can be hidden from its menu.
  await bar.click({ button: 'right', position: { x: (await bar.boundingBox())!.width - 60, y: 10 } })
  await p.getByTestId('favbar-hide').click()
  await expect(bar).toHaveCount(0)
  await expect.poll(async () => (await saved(p)).prefs.showFavoritesBar).toBe(false)
})
