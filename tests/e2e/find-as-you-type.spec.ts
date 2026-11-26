import { test, expect } from '@playwright/test'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { launch, write, item, names, focusedName, type Harness } from './helpers'

let h: Harness
test.afterEach(async () => h?.close())

async function fixture(left: string, right: string): Promise<void> {
  await write(path.join(left, 'alpha.txt'), 'a')
  await write(path.join(left, 'gamma.txt'), 'g')
  await write(path.join(left, 'main.c'), 'int main(void) { return 0; }\n')
  await write(path.join(left, 'sub', 'deep', 'gamma-notes.md'), '# deep')
  await write(path.join(left, 'sub', 'beta.txt'), 'b')
  await write(path.join(right, 'Projects', 'p1.txt'), '1')
  const ud = path.join(left, '..', 'userdata')
  await fsp.mkdir(ud, { recursive: true })
  await fsp.writeFile(path.join(ud, 'opal-settings.json'), JSON.stringify({ prefs: {}, favorites: [{ path: path.join(right, 'Projects'), label: 'Projects' }], recent: [] }))
}

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
