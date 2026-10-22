import { test, expect } from '@playwright/test'
import { promises as fsp } from 'node:fs'
import * as path from 'node:path'
import { launch, write, names, selectedNames, focusedName, item, exists, type Harness } from './helpers'

let h: Harness

async function standardFixture(left: string, right: string): Promise<void> {
  await write(path.join(left, 'alpha.txt'), 'hello alpha')
  await write(path.join(left, 'beta.log'), 'bbb')
  await write(path.join(left, 'gamma.txt'), 'g')
  await write(path.join(left, 'sub', 'inner.txt'), 'inner')
  await write(path.join(right, 'existing.md'), '# r')
}

test.beforeEach(async () => {
  h = await launch(standardFixture)
})

test.afterEach(async () => {
  await h?.close()
})

async function clickItem(pane: 0 | 1, name: string, mods: ('ControlOrMeta' | 'Shift')[] = []): Promise<void> {
  await (await item(h.page, pane, name)).click({ modifiers: mods })
}

test('navigate into folder with double click and back up with Backspace', async () => {
  const { page } = h
  await (await item(page, 0, 'sub')).dblclick()
  await expect.poll(() => names(page, 0)).toEqual(['inner.txt'])
  await expect(page.getByTestId('breadcrumbs-0')).toContainText('sub')
  await page.keyboard.press('Backspace')
  await expect.poll(() => names(page, 0)).toEqual(['sub', 'alpha.txt', 'beta.log', 'gamma.txt'])
  await expect.poll(() => focusedName(page, 0)).toBe('sub')
  await page.keyboard.press('Alt+ArrowLeft')
  await expect.poll(() => names(page, 0)).toEqual(['inner.txt'])
  await page.keyboard.press('Alt+ArrowRight')
  await expect.poll(() => names(page, 0)).toContain('alpha.txt')
})

test('edit the location bar to navigate', async () => {
  const { page } = h
  await page.locator('[data-testid="list-0"]').click({ position: { x: 300, y: 300 } })
  await page.keyboard.press('Control+L')
  const input = page.getByTestId('path-input-0')
  await expect(input).toBeFocused()
  await input.fill(path.join(h.left, 'sub'))
  await input.press('Enter')
  await expect.poll(() => names(page, 0)).toEqual(['inner.txt'])
})

test('keyboard selection, range, select all, invert, find-as-you-type', async () => {
  const { page } = h
  await clickItem(0, 'alpha.txt')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  expect(await selectedNames(page, 0)).toEqual(['alpha.txt', 'beta.log', 'gamma.txt'])
  await page.keyboard.press('Control+A')
  expect(await selectedNames(page, 0)).toHaveLength(4)
  await clickItem(0, 'beta.log')
  await page.keyboard.press('Control+I')
  expect(await selectedNames(page, 0)).toEqual(['sub', 'alpha.txt', 'gamma.txt'])
  await page.keyboard.press('Escape')
  expect(await selectedNames(page, 0)).toEqual([])
  await page.keyboard.type('ga')
  await expect.poll(() => focusedName(page, 0)).toBe('gamma.txt')
  await page.keyboard.press('Home')
  await expect.poll(() => focusedName(page, 0)).toBe('sub')
  await page.keyboard.press('End')
  await expect.poll(() => focusedName(page, 0)).toBe('gamma.txt')
})

test('copy to destination (Ctrl+1) with conflict handling', async () => {
  const { page } = h
  await clickItem(0, 'alpha.txt')
  await page.keyboard.press('Control+1')
  await expect.poll(() => names(page, 1)).toEqual(['alpha.txt', 'existing.md'])
  expect(await fsp.readFile(path.join(h.right, 'alpha.txt'), 'utf8')).toBe('hello alpha')
  await page.keyboard.press('Control+1')
  await expect(page.getByTestId('conflict-dialog')).toBeVisible()
  await page.getByTestId('conflict-rename').click()
  await expect.poll(() => names(page, 1)).toEqual(['alpha (2).txt', 'alpha.txt', 'existing.md'])
})

test('copy a folder recursively and move files (Ctrl+2)', async () => {
  const { page } = h
  await clickItem(0, 'sub')
  await page.keyboard.press('Control+1')
  await expect.poll(() => exists(path.join(h.right, 'sub', 'inner.txt'))).toBe(true)
  await clickItem(0, 'beta.log')
  await page.keyboard.press('Control+2')
  await expect.poll(() => names(page, 1)).toContain('beta.log')
  await expect.poll(() => names(page, 0)).not.toContain('beta.log')
  expect(await exists(path.join(h.left, 'beta.log'))).toBe(false)
})

test('permanent delete with confirmation', async () => {
  const { page } = h
  await clickItem(0, 'gamma.txt')
  await page.keyboard.press('Shift+Delete')
  await expect(page.getByTestId('confirm-dialog')).toBeVisible()
  await page.getByTestId('confirm-ok').click()
  await expect.poll(() => names(page, 0)).not.toContain('gamma.txt')
  expect(await exists(path.join(h.left, 'gamma.txt'))).toBe(false)
})

test('inline rename (F2) and undo (Ctrl+Z)', async () => {
  const { page } = h
  await clickItem(0, 'alpha.txt')
  await page.keyboard.press('F2')
  const input = page.getByTestId('rename-input')
  await expect(input).toBeFocused()
  await input.fill('omega.txt')
  await input.press('Enter')
  await expect.poll(() => names(page, 0)).toContain('omega.txt')
  expect(await exists(path.join(h.left, 'omega.txt'))).toBe(true)
  await expect.poll(() => selectedNames(page, 0)).toEqual(['omega.txt'])
  await page.keyboard.press('Control+Z')
  await expect.poll(() => names(page, 0)).toContain('alpha.txt')
  expect(await exists(path.join(h.left, 'alpha.txt'))).toBe(true)
})

test('create folder (Ctrl+N) and file (Ctrl+O)', async () => {
  const { page } = h
  await page.locator('[data-testid="list-0"]').click({ position: { x: 300, y: 300 } })
  await page.keyboard.press('Control+N')
  await page.getByTestId('prompt-input').fill('Projects')
  await page.getByTestId('prompt-input').press('Enter')
  await expect.poll(() => names(page, 0)).toContain('Projects')
  expect((await fsp.stat(path.join(h.left, 'Projects'))).isDirectory()).toBe(true)
  await page.keyboard.press('Control+O')
  await page.getByTestId('prompt-input').fill('notes.md')
  await page.getByTestId('prompt-ok').click()
  await expect.poll(() => names(page, 0)).toContain('notes.md')
  await expect.poll(() => focusedName(page, 0)).toBe('notes.md')
})

test('advanced rename with wildcard pattern and numbering preview', async () => {
  const { page } = h
  await clickItem(0, 'alpha.txt')
  await clickItem(0, 'gamma.txt', ['ControlOrMeta'])
  await page.keyboard.press('Control+3')
  await expect(page.getByTestId('rename-dialog')).toBeVisible()
  await page.getByTestId('rename-old').fill('*.txt')
  await page.getByTestId('rename-new').fill('doc_[##]_*.txt')
  await expect(page.getByTestId('rename-preview')).toContainText('doc_01_alpha.txt')
  await expect(page.getByTestId('rename-preview')).toContainText('doc_02_gamma.txt')
  await page.getByTestId('rename-ok').click()
  await expect.poll(() => names(page, 0)).toEqual(['sub', 'beta.log', 'doc_01_alpha.txt', 'doc_02_gamma.txt'])
})

test('filter box and select by pattern via CLI', async () => {
  const { page } = h
  await page.getByTestId('filter-0').fill('*.txt')
  await expect.poll(() => names(page, 0)).toEqual(['alpha.txt', 'gamma.txt'])
  await page.getByTestId('filter-0').fill('')
  await expect.poll(() => names(page, 0)).toHaveLength(4)
  await page.locator('[data-testid="list-0"]').click({ position: { x: 300, y: 300 } })
  await page.keyboard.press('>')
  await page.getByTestId('cli-input').fill('Select PATTERN=*.(log|txt) FILES')
  await page.getByTestId('cli-input').press('Enter')
  await expect.poll(() => selectedNames(page, 0)).toEqual(['alpha.txt', 'beta.log', 'gamma.txt'])
})

test('tabs: open, navigate, switch and close', async () => {
  const { page } = h
  await page.locator('[data-testid="list-0"]').click({ position: { x: 300, y: 300 } })
  await page.keyboard.press('Control+T')
  await expect(page.locator('[data-testid="pane-0"] .tab')).toHaveCount(2)
  await (await item(page, 0, 'sub')).dblclick()
  await expect.poll(() => names(page, 0)).toEqual(['inner.txt'])
  await page.keyboard.press('Control+Tab')
  await expect.poll(() => names(page, 0)).toContain('alpha.txt')
  await page.keyboard.press('Control+Tab')
  await page.keyboard.press('Control+W')
  await expect(page.locator('[data-testid="pane-0"] .tab')).toHaveCount(1)
  await expect.poll(() => names(page, 0)).toContain('alpha.txt')
})

test('Tab key switches source and destination', async () => {
  const { page } = h
  await clickItem(0, 'alpha.txt')
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('pane-1')).toHaveClass(/is-source/)
  await expect(page.getByTestId('pane-0')).toHaveClass(/is-dest/)
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('pane-0')).toHaveClass(/is-source/)
})

test('clipboard copy & paste between panes', async () => {
  const { page } = h
  await clickItem(0, 'beta.log')
  await page.keyboard.press('Control+C')
  await page.locator('[data-testid="list-1"]').click({ position: { x: 300, y: 300 } })
  await page.keyboard.press('Control+V')
  await expect.poll(() => names(page, 1)).toContain('beta.log')
  expect(await exists(path.join(h.left, 'beta.log'))).toBe(true)
})

test('folder tree keyboard navigation expands and navigates', async () => {
  const { page } = h
  const tree = page.getByTestId('folder-tree')
  const current = tree.locator('.tree-node.current')
  await expect(current).toContainText('left', { timeout: 15000 })
  await current.locator('.tree-label').click()
  await tree.focus()
  await page.keyboard.press('ArrowRight')
  await expect(tree.locator('.tree-node', { hasText: /^sub$/ })).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => names(page, 0)).toEqual(['inner.txt'])
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => names(page, 0)).toContain('alpha.txt')
  await page.keyboard.press('ArrowLeft')
  await expect(tree.locator('.tree-node', { hasText: /^sub$/ })).toHaveCount(0)
})

test('find files dialog searches recursively', async () => {
  const { page } = h
  await page.locator('[data-testid="list-0"]').click({ position: { x: 300, y: 300 } })
  await page.keyboard.press('Control+F')
  await expect(page.getByTestId('find-dialog')).toBeVisible()
  await page.getByTestId('find-pattern').fill('*.txt')
  await page.getByTestId('find-start').click()
  await expect(page.locator('[data-testid="find-results"] .fr-row')).toHaveCount(3)
  await page.locator('[data-testid="find-results"] .fr-row', { hasText: 'inner.txt' }).dblclick()
  await expect.poll(() => names(page, 0)).toEqual(['inner.txt'])
  await expect.poll(() => focusedName(page, 0)).toBe('inner.txt')
})

test('viewer pane previews text files', async () => {
  const { page } = h
  await clickItem(0, 'alpha.txt')
  await page.keyboard.press('F7')
  await expect(page.getByTestId('viewer-text')).toContainText('hello alpha')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('viewer')).toContainText('beta.log')
})

test('synchronize copies missing files to destination', async () => {
  const { page } = h
  await page.locator('[data-testid="list-0"]').click({ position: { x: 300, y: 300 } })
  await page.keyboard.press('Control+Y')
  await expect(page.getByTestId('sync-dialog')).toBeVisible()
  await expect(page.getByTestId('sync-list')).toContainText('Only in source')
  await page.getByTestId('sync-ltr').click()
  await expect.poll(() => exists(path.join(h.right, 'sub', 'inner.txt'))).toBe(true)
  await expect(page.getByTestId('sync-list')).not.toContainText('Only in source')
  await page.keyboard.press('Escape')
  await expect.poll(() => names(page, 1)).toEqual(['sub', 'alpha.txt', 'beta.log', 'existing.md', 'gamma.txt'])
})

test('favorites, theme and settings persist to disk', async () => {
  const { page } = h
  await page.locator('[data-testid="list-0"]').click({ position: { x: 300, y: 300 } })
  await page.keyboard.press('Control+D')
  await expect(page.getByTestId('favorite-item')).toHaveCount(1)
  await page.getByTestId('tb-theme').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect
    .poll(async () => {
      try {
        const s = JSON.parse(await fsp.readFile(path.join(h.userData, 'opal-settings.json'), 'utf8'))
        return [s.prefs.theme, s.favorites.length]
      } catch {
        return null
      }
    })
    .toEqual(['light', 1])
})

test('external changes are picked up automatically', async () => {
  const { page } = h
  await write(path.join(h.left, 'from-outside.txt'), 'x')
  await expect.poll(() => names(page, 0), { timeout: 10000 }).toContain('from-outside.txt')
  await fsp.rm(path.join(h.left, 'from-outside.txt'))
  await expect.poll(() => names(page, 0), { timeout: 10000 }).not.toContain('from-outside.txt')
})

test('context menu offers actions and view modes switch', async () => {
  const { page } = h
  await (await item(page, 0, 'alpha.txt')).click({ button: 'right' })
  await expect(page.getByTestId('context-menu')).toContainText('Copy full path')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('context-menu')).toHaveCount(0)
  await page.getByTestId('tb-view-icons').click()
  await expect(page.locator('[data-testid="list-0"] .grid-view')).toBeVisible()
  await expect.poll(() => names(page, 0)).toEqual(['sub', 'alpha.txt', 'beta.log', 'gamma.txt'])
  await page.keyboard.press('ArrowRight')
  await page.getByTestId('tb-view-details').click()
  await expect(page.locator('[data-testid="list-0"] .details-header')).toBeVisible()
  await page.keyboard.press('F6')
  await expect(page.getByTestId('pane-1')).toHaveCount(0)
  await page.screenshot({ path: path.join(__dirname, '../../test-results/single.png') })
})

test('flat view lists files from subfolders', async () => {
  const { page } = h
  await page.locator('[data-testid="list-0"]').click({ position: { x: 300, y: 300 } })
  await page.keyboard.press('Control+Shift+F')
  await expect.poll(() => names(page, 0)).toEqual(['alpha.txt', 'beta.log', 'gamma.txt', path.join('sub', 'inner.txt')])
  await page.keyboard.press('Control+Shift+F')
  await expect.poll(() => names(page, 0)).toEqual(['sub', 'alpha.txt', 'beta.log', 'gamma.txt'])
})

test('duplicate finder groups identical files', async () => {
  const { page } = h
  await write(path.join(h.left, 'copy-of-alpha.txt'), 'hello alpha')
  await page.locator('[data-testid="list-0"]').click({ position: { x: 300, y: 300 } })
  await page.keyboard.press('Control+U')
  await expect(page.getByTestId('duplicates-dialog')).toBeVisible()
  await expect(page.locator('[data-testid="dupes-list"] .dupe-group')).toHaveCount(1)
  await expect(page.getByTestId('dupes-list')).toContainText('copy-of-alpha.txt')
})

test('properties shows checksum', async () => {
  const { page } = h
  await clickItem(0, 'alpha.txt')
  await page.keyboard.press('Alt+Enter')
  await expect(page.getByTestId('properties-dialog')).toBeVisible()
  await page.getByRole('button', { name: 'MD5' }).click()
  await expect(page.getByTestId('hash-value')).toContainText('MD5: ')
  await expect(page.getByTestId('hash-value')).not.toContainText('Calculating')
})

test('Ctrl+E opens a second window on the source folder', async () => {
  const { page, app } = h
  await (await item(page, 0, 'sub')).dblclick()
  await expect.poll(() => names(page, 0)).toEqual(['inner.txt'])
  const [win2] = await Promise.all([app.waitForEvent('window'), page.keyboard.press('Control+E')])
  await win2.waitForSelector('[data-testid="list-0"] .item')
  await expect.poll(() => names(win2, 0)).toEqual(['inner.txt'])
  await win2.close()
})

test('no refresh storm while idle (watcher stays quiet)', async () => {
  const { page } = h
  await page.waitForTimeout(1500)
  const count = await page.evaluate(async () => {
    let n = 0
    const off = window.opal.onWatchChanged(() => n++)
    await new Promise((r) => setTimeout(r, 3000))
    off()
    return n
  })
  expect(count).toBe(0)
})
