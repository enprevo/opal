import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import { launch, write, item, focusedName, cssValue, type Harness } from './helpers'

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
  // With the bar shown, favorites are not repeated in the sidebar.
  await expect(p.getByTestId('favorites-section')).toHaveCount(0)

  // Dropping the same item again does not double it (dropped where it already is, it stays there).
  await (await item(p, 0, 'docs')).dragTo(items.first(), { targetPosition: { x: 3, y: 10 } })
  await expect(items).toHaveText(['docs', 'note.txt'])

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

  // The group's folder can be coloured from its menu; the colour follows a rename.
  await group.click({ button: 'right' })
  await p.getByTestId('favbar-group-color').hover()
  await p.getByTestId('group-color-purple').click()
  await expect(group.locator('.fb-group-icon')).toHaveCSS('color', 'rgb(166, 107, 230)')
  await expect.poll(async () => (await saved(p)).favoriteGroupColors).toEqual({ Work: '#a66be6' })
  await group.click({ button: 'right' })
  await p.getByTestId('favbar-group-rename').click()
  await p.getByTestId('prompt-input').fill('Job')
  await p.getByTestId('prompt-ok').click()
  await expect(group).toHaveText(/Job/)
  await expect.poll(async () => (await saved(p)).favoriteGroupColors).toEqual({ Job: '#a66be6' })
  await expect(group.locator('.fb-group-icon')).toHaveCSS('color', 'rgb(166, 107, 230)')

  // Removing the group keeps its favorites on the bar (and forgets its colour).
  await group.click({ button: 'right' })
  await p.getByTestId('favbar-group-remove').click()
  await expect(group).toHaveCount(0)
  await expect(items).toHaveText(['note.txt', 'docs', 'music'])
  await expect.poll(async () => (await saved(p)).favoriteGroupColors).toEqual({})

  // The bar can be hidden from its menu.
  await bar.click({ button: 'right', position: { x: (await bar.boundingBox())!.width - 60, y: 10 } })
  await p.getByTestId('favbar-hide').click()
  await expect(bar).toHaveCount(0)
  await expect.poll(async () => (await saved(p)).prefs.showFavoritesBar).toBe(false)
  // Without the bar, the sidebar lists the favorites again.
  await expect(p.getByTestId('favorite-item')).toHaveCount(3)
})

test('edit favorites like a bookmark manager: folders on the left, drag between them, rename in place', async () => {
  h = await launch(async (left) => {
    await write(path.join(left, 'docs', 'a.txt'), 'a')
    await write(path.join(left, 'music', 'b.txt'), 'b')
    await write(path.join(left, 'note.txt'), 'n')
    await write(
      path.join(left, '..', 'userdata', 'opal-settings.json'),
      JSON.stringify({
        prefs: {},
        favorites: [{ path: path.join(left, 'docs') }, { path: path.join(left, 'music') }, { path: path.join(left, 'note.txt'), file: true }],
        recent: []
      })
    )
  })
  const p = h.page
  const bar = p.getByTestId('favorites-bar')
  const docs = path.join(h.left, 'docs')
  const music = path.join(h.left, 'music')
  const note = path.join(h.left, 'note.txt')
  await expect(bar.getByTestId('favbar-item')).toHaveText(['docs', 'music', 'note.txt'])

  // Right-click on an item (or on the bar) offers "Edit favorites".
  await bar.getByTestId('favbar-item').first().click({ button: 'right' })
  await p.getByTestId('favorites-edit').click()
  const ed = p.getByTestId('favorites-editor')
  await expect(ed).toBeVisible()
  const list = ed.getByTestId('fe-list')
  const row = (sel: string) => list.locator(`[data-testid="fe-row"]${sel}`)
  const tree = ed.getByTestId('fe-tree-folder')
  await expect(list.getByTestId('fe-row')).toHaveCount(3)

  // New folder: named in place.
  await ed.getByTestId('fe-new-folder').click()
  await ed.getByTestId('fe-name-input').fill('Work')
  await ed.getByTestId('fe-name-input').press('Enter')
  await expect(tree).toHaveText([/Favorites bar/, /Work/])

  // Colour the new folder from its menu: its icon changes here at once.
  await tree.nth(1).click({ button: 'right' })
  await p.getByTestId('fe-menu-color').hover()
  await p.getByTestId('group-color-green').click()
  await expect(tree.nth(1).locator('.fb-group-icon')).toHaveCSS('color', 'rgb(67, 184, 106)')
  await expect(row('[data-group="Work"]').locator('.fb-group-icon')).toHaveCSS('color', 'rgb(67, 184, 106)')

  // Drag a favorite onto the folder on the left.
  await row(`[data-path="${cssValue(docs)}"]`).dragTo(tree.nth(1))
  await expect(row('[data-path]:not([data-child])')).toHaveCount(2)
  await expect(tree.nth(1)).toContainText('1')

  // A folder shows what is inside it, on the right under its row and on the left under its name; the arrow hides it.
  await expect(row(`[data-child][data-path="${cssValue(docs)}"]`)).toBeVisible()
  await expect(ed.getByTestId('fe-tree-item')).toHaveText(['docs'])
  await row('[data-group="Work"]').getByTestId('fe-twisty').click()
  await expect(row('[data-child]')).toHaveCount(0)
  await expect(ed.getByTestId('fe-tree-item')).toHaveCount(0)
  await ed.getByTestId('fe-tree-twisty').click()
  await expect(row(`[data-child][data-path="${cssValue(docs)}"]`)).toBeVisible()

  // Drag to reorder: note.txt before music.
  await row(`[data-path="${cssValue(note)}"]`).dragTo(row(`[data-path="${cssValue(music)}"]`), { targetPosition: { x: 40, y: 3 } })
  await expect.poll(() => row('[data-path]:not([data-child])').evaluateAll((els) => els.map((e) => e.getAttribute('data-path')))).toEqual([note, music])

  // Right-click → Move to → Work.
  await row(`[data-path="${cssValue(music)}"]`).click({ button: 'right' })
  await p.getByTestId('fe-menu-move').hover()
  await p.getByTestId('fe-move-group').click()
  await expect(row('[data-path]:not([data-child])')).toHaveCount(1)
  await expect(row('[data-child]')).toHaveCount(2)

  // Open the folder and rename an item in place (double-click).
  await tree.nth(1).click()
  await expect(row('[data-path]')).toHaveCount(2)
  await row(`[data-path="${cssValue(docs)}"]`).dblclick()
  await ed.getByTestId('fe-name-input').fill('Documents')
  await ed.getByTestId('fe-name-input').press('Enter')
  await expect(row(`[data-path="${cssValue(docs)}"]`)).toContainText('Documents')

  // Search across folders.
  await ed.getByTestId('fe-search').fill('mus')
  await expect(list.getByTestId('fe-row')).toHaveCount(1)
  await ed.getByTestId('fe-search').fill('')

  // A shortcut taken by a command is refused with the reason; a free one is kept.
  await ed.getByTestId('fe-crumb-bar').click()
  const noteRow = row(`[data-path="${cssValue(note)}"]`)
  await noteRow.hover()
  await noteRow.getByTestId('shortcut-field').click()
  await p.keyboard.press('Control+c')
  await expect(ed.getByTestId('fe-problem')).toContainText('used by the command')
  await noteRow.getByTestId('shortcut-field').click()
  await p.keyboard.press('Control+Alt+n')
  await expect(noteRow.getByTestId('shortcut-field')).toHaveText('Ctrl+Alt+N')

  await ed.getByTestId('fe-save').click()
  await expect(ed).toHaveCount(0)
  await expect.poll(async () => (await saved(p)).favorites).toEqual([
    { path: note, file: true, shortcut: 'Ctrl+Alt+N' },
    { path: docs, label: 'Documents', group: 'Work' },
    { path: music, group: 'Work' }
  ])
  await expect(bar.getByTestId('favbar-item')).toHaveText(['note.txt'])
  await expect.poll(async () => (await saved(p)).favoriteGroupColors).toEqual({ Work: '#43b86a' })
  await expect(bar.getByTestId('favbar-group').locator('.fb-group-icon')).toHaveCSS('color', 'rgb(67, 184, 106)')
  await bar.getByTestId('favbar-group').click()
  await expect(p.getByTestId('favbar-dropdown-item')).toHaveText(['Documents', 'music'])

  // Cancel leaves everything as it was.
  await p.keyboard.press('Escape')
  await bar.click({ button: 'right', position: { x: (await bar.boundingBox())!.width - 60, y: 10 } })
  await p.getByTestId('favorites-edit').click()
  await p.getByTestId('favorites-editor').getByTestId('fe-row').first().hover()
  await p.getByTestId('favorites-editor').getByTestId('fe-remove').first().click()
  await p.getByTestId('favorites-editor').getByRole('button', { name: 'Cancel' }).click()
  await expect(bar.getByTestId('favbar-item')).toHaveText(['note.txt'])
})

test('drag a folder or file onto the bar exactly where you want it, also between two favorites', async () => {
  h = await launch(async (left) => {
    await write(path.join(left, 'docs', 'a.txt'), 'a')
    await write(path.join(left, 'music', 'b.txt'), 'b')
    await write(path.join(left, 'pics', 'c.txt'), 'c')
    await write(path.join(left, 'note.txt'), 'n')
    await write(
      path.join(left, '..', 'userdata', 'opal-settings.json'),
      JSON.stringify({
        prefs: {},
        favorites: [{ path: path.join(left, 'docs') }, { path: path.join(left, 'music') }, { path: path.join(left, 'note.txt'), file: true, label: 'My note' }],
        recent: []
      })
    )
  })
  const p = h.page
  const bar = p.getByTestId('favorites-bar')
  const items = bar.getByTestId('favbar-item')
  await expect(items).toHaveText(['docs', 'music', 'My note'])

  /** The middle of the space between two favorites on the bar, in the bar's coordinates. */
  const gap = async (a: number, b: number) => {
    const barBox = (await bar.boundingBox())!
    const ra = (await items.nth(a).boundingBox())!
    const rb = (await items.nth(b).boundingBox())!
    return { x: (ra.x + ra.width + rb.x) / 2 - barBox.x, y: barBox.height / 2 }
  }

  // A new folder dropped in the space between docs and music goes there, not at the end.
  await (await item(p, 0, 'pics')).dragTo(bar, { targetPosition: await gap(0, 1) })
  await expect(items).toHaveText(['docs', 'pics', 'music', 'My note'])

  // A file already on the bar, dragged again from the list, moves to the new place and keeps its name.
  await (await item(p, 0, 'note.txt')).dragTo(bar, { targetPosition: await gap(0, 1) })
  await expect(items).toHaveText(['docs', 'My note', 'pics', 'music'])
  await expect(p.getByTestId('toasts')).toContainText('Moved in favorites')

  // Dropped on the left half of a favorite it goes before it; past the last one, at the end.
  const music = path.join(h.left, 'music')
  await (await item(p, 0, 'music')).dragTo(items.first(), { targetPosition: { x: 4, y: 10 } })
  await expect(items).toHaveText(['music', 'docs', 'My note', 'pics'])
  const last = (await items.last().boundingBox())!
  const barBox = (await bar.boundingBox())!
  await (await item(p, 0, 'music')).dragTo(bar, { targetPosition: { x: last.x + last.width + 30 - barBox.x, y: barBox.height / 2 } })
  await expect(items).toHaveText(['docs', 'My note', 'pics', 'music'])
  await expect.poll(async () => (await saved(p)).favorites.map((f) => f.path)).toEqual([path.join(h!.left, 'docs'), path.join(h!.left, 'note.txt'), path.join(h!.left, 'pics'), music])
})
