import { test, expect } from '@playwright/test'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { launch, write, item, names, focusedName, type Harness } from './helpers'

let h: Harness
test.afterEach(async () => h?.close())

async function seed(left: string, favorites: unknown[]): Promise<void> {
  const ud = path.join(left, '..', 'userdata')
  await fsp.mkdir(ud, { recursive: true })
  await fsp.writeFile(path.join(ud, 'opal-settings.json'), JSON.stringify({ prefs: {}, favorites, recent: [] }))
}

async function fixture(left: string, right: string): Promise<void> {
  await write(path.join(left, 'alpha.txt'), 'a')
  await write(path.join(left, 'gamma.txt'), 'g')
  await write(path.join(left, 'main.c'), '#include <stdio.h>\n/* entry point */\nint main(void) {\n  return printf("hi");\n}\n')
  await write(path.join(left, 'sub', 'deep', 'gamma-notes.md'), '# deep')
  await write(path.join(left, 'sub', 'beta.txt'), 'b')
  await write(path.join(right, 'Projects', 'p1.txt'), '1')
  await seed(left, [
    { type: 'item', id: 'proj', path: path.join(right, 'Projects'), label: 'Projects' },
    { type: 'group', id: 'g', label: 'Work', children: [{ type: 'item', id: 'sub', path: path.join(left, 'sub') }] }
  ])
}

const fav = (name: string) => h.page.locator('[data-testid="favorite-item"]', { hasText: name })

test('right-click a favorite to colour it, change its icon and set a shortcut key', async () => {
  h = await launch(fixture)
  const { page } = h
  await fav('Projects').click({ button: 'right' })
  await page.getByTestId('fav-text-colour').hover()
  await page.getByTestId('fav-color-red').click()
  await expect(fav('Projects')).toHaveAttribute('style', /color: rgb\(255, 95, 87\)/)
  await fav('Projects').click({ button: 'right' })
  await page.getByTestId('fav-background').hover()
  await page.getByTestId('fav-background-blue').click()
  await expect(fav('Projects')).toHaveAttribute('style', /background: color-mix/)
  await fav('Projects').click({ button: 'right' })
  await page.getByTestId('fav-icon').hover()
  await page.getByTestId('fav-icon-rocket').click()
  // Shortcut key through the editor: record "P".
  await fav('Projects').click({ button: 'right' })
  await page.getByTestId('fav-key').click()
  await expect(page.getByTestId('fav-key-capture')).toHaveText('Press a key…')
  await page.keyboard.press('p')
  await expect(page.getByTestId('fav-key-capture')).toHaveText('P')
  await page.getByTestId('fav-save').click()
  await expect(fav('Projects').locator('.sb-key')).toHaveText('P')

  const st = await page.evaluate(() => window.opal.getSettings())
  expect(st.favorites[0]).toMatchObject({ color: '#ff5f57', background: '#0a84ff', icon: 'lucide:Rocket', key: 'P' })

  // The key opens the favorite from the file list.
  await (await item(page, 0, 'alpha.txt')).click()
  await page.keyboard.press('p')
  await expect.poll(() => names(page, 0)).toEqual(['p1.txt'])
})

test('organize favorites: new group, drag into it, edit, keep on OK', async () => {
  h = await launch(fixture)
  const { page } = h
  await page.getByTestId('fav-organize-btn').click()
  const fm = page.getByTestId('favorites-manager')
  await expect(fm.getByTestId('fm-row')).toHaveCount(3)
  await fm.getByTestId('fm-row').filter({ hasText: 'Projects' }).click()
  await fm.getByTestId('fm-new-group').click()
  await fm.getByTestId('fav-name').fill('Clients')
  await expect(fm.getByTestId('fm-row').filter({ hasText: 'Clients' })).toHaveCount(1)
  // Drag "Projects" into the new group.
  const projects = fm.getByTestId('fm-row').filter({ hasText: 'Projects' })
  await projects.dragTo(fm.getByTestId('fm-row').filter({ hasText: 'Clients' }), { targetPosition: { x: 60, y: 13 } })
  await expect(fm.getByTestId('fm-row').filter({ hasText: 'Projects' })).toHaveAttribute('style', /padding-left: 24px/)
  // Edit the selected favorite's text colour and name.
  await fm.getByTestId('fm-row').filter({ hasText: 'Projects' }).click()
  await fm.getByTestId('fav-color-picker').locator('.swatch').nth(4).click()
  await fm.getByTestId('fav-name').fill('All projects')
  await fm.getByTestId('fm-ok').click()

  await expect(page.locator('[data-testid="favorite-group"]', { hasText: 'Clients' })).toContainText('All projects')
  const st = await page.evaluate(() => window.opal.getSettings())
  const clients = st.favorites.find((f) => f.type === 'group' && f.label === 'Clients') as { children: { label?: string; color?: string }[] }
  expect(clients.children[0]).toMatchObject({ label: 'All projects', color: '#32d74b' })
})

test('cancel in the manager discards the changes', async () => {
  h = await launch(fixture)
  const { page } = h
  await page.getByTestId('fav-organize-btn').click()
  const fm = page.getByTestId('favorites-manager')
  await fm.getByTestId('fm-row').filter({ hasText: 'Projects' }).click()
  await fm.getByTestId('fm-delete').click()
  await fm.getByRole('button', { name: 'Cancel' }).click()
  await expect(fav('Projects')).toHaveCount(1)
})

test('find as you type: jump, filter, search subfolders, highlight, Esc restores', async () => {
  h = await launch(fixture)
  const { page } = h
  await (await item(page, 0, 'alpha.txt')).click()
  await page.keyboard.type('gam')
  await expect(page.getByTestId('fayt-0')).toBeVisible()
  await expect(page.getByTestId('fayt-count')).toHaveText('1 of 1')
  await expect.poll(() => focusedName(page, 0)).toBe('gamma.txt')
  await expect(page.locator('[data-testid="list-0"] mark.fayt-hit')).toHaveText(['gam'])
  // Filter: only matching items stay.
  await page.keyboard.press('Tab')
  await expect.poll(() => names(page, 0)).toEqual(['gamma.txt'])
  // Subfolders: the whole branch is searched.
  await page.keyboard.press('Tab')
  await expect.poll(() => names(page, 0)).toEqual(['gamma.txt', path.join('sub', 'deep', 'gamma-notes.md')])
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('fayt-0')).toHaveCount(0)
  await expect.poll(() => names(page, 0)).toEqual(['sub', 'alpha.txt', 'gamma.txt', 'main.c'])
  // A name that doesn't exist turns the bar red.
  await page.keyboard.type('zzz')
  await expect(page.getByTestId('fayt-count')).toHaveText('No match')
  await page.keyboard.press('Escape')
})

test('"/" jumps to a favorite by name', async () => {
  h = await launch(fixture)
  const { page } = h
  await (await item(page, 0, 'alpha.txt')).click()
  await page.keyboard.type('/proj')
  await expect(page.getByTestId('fayt-suggest')).toContainText('Projects')
  await page.keyboard.press('Enter')
  await expect.poll(() => names(page, 0)).toEqual(['p1.txt'])
})

test('Quick Look colours source code', async () => {
  h = await launch(fixture)
  const { page } = h
  await (await item(page, 0, 'main.c')).click()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('ql-lang')).toHaveText('C')
  await expect(page.locator('[data-testid="ql-text"] .hljs-comment')).toContainText('entry point')
  await expect(page.locator('[data-testid="ql-text"] .hljs-keyword').first()).toBeVisible()
  await expect(page.locator('[data-testid="ql-text"] .ql-line')).toHaveCount(6)
})
