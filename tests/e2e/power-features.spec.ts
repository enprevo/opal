import { test, expect } from '@playwright/test'
import { promises as fsp } from 'node:fs'
import * as path from 'node:path'
import { launch, write, names, selectedNames, focusedName, item, exists, type Harness } from './helpers'

let h: Harness

test.beforeEach(async () => {
  h = await launch(async (left, right) => {
    await write(path.join(left, 'docs', 'a.txt'), 'A')
    await write(path.join(left, 'docs', 'deep', 'b.txt'), 'B')
    await write(path.join(left, 'pics', 'p1.jpg'), '1')
    await write(path.join(left, 'pics', 'p2.jpg'), '2')
    await write(path.join(left, 'readme.md'), 'r')
    await write(path.join(left, 'notes.txt'), 'n')
    await write(path.join(right, 'readme.md'), 'other')
  })
})

test.afterEach(async () => {
  await h?.close()
})

async function focusList(pane: 0 | 1 = 0): Promise<void> {
  await h.page.locator(`[data-testid="list-${pane}"]`).click({ position: { x: 300, y: 400 } })
}

test('expandable folders: → expands, → enters, ← goes to parent, ← collapses', async () => {
  const { page } = h
  await (await item(page, 0, 'docs')).click()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => names(page, 0)).toEqual(['docs', 'deep', 'a.txt', 'pics', 'notes.txt', 'readme.md'])
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => focusedName(page, 0)).toBe('deep')
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => names(page, 0)).toEqual(['docs', 'deep', 'b.txt', 'a.txt', 'pics', 'notes.txt', 'readme.md'])
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => focusedName(page, 0)).toBe('b.txt')
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => focusedName(page, 0)).toBe('deep')
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => names(page, 0)).toEqual(['docs', 'deep', 'a.txt', 'pics', 'notes.txt', 'readme.md'])
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => focusedName(page, 0)).toBe('docs')
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => names(page, 0)).toEqual(['docs', 'pics', 'notes.txt', 'readme.md'])
  // Default keys Alt+Down / Alt+Up.
  await page.keyboard.press('Alt+ArrowDown')
  await expect.poll(() => names(page, 0)).toContain('a.txt')
  await page.keyboard.press('Alt+ArrowUp')
  await expect.poll(() => names(page, 0)).not.toContain('a.txt')
  await page.screenshot({ path: path.join(__dirname, '../../test-results/expandable.png') })
})

test('expander arrow click and expanded contents refresh on disk change', async () => {
  const { page } = h
  await page.locator('[data-testid="list-0"] .item', { hasText: 'pics' }).getByTestId('expander').click()
  await expect.poll(() => names(page, 0)).toEqual(['docs', 'pics', 'p1.jpg', 'p2.jpg', 'notes.txt', 'readme.md'])
  await write(path.join(h.left, 'pics', 'p3.jpg'), '3')
  await expect.poll(() => names(page, 0), { timeout: 10000 }).toContain('p3.jpg')
  await page.locator('[data-testid="list-0"] .item', { hasText: 'pics' }).getByTestId('expander').click()
  await expect.poll(() => names(page, 0)).not.toContain('p1.jpg')
})

test('expanded folders are remembered on back/forward', async () => {
  const { page } = h
  await (await item(page, 0, 'pics')).click()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => names(page, 0)).toContain('p1.jpg')
  await (await item(page, 0, 'docs')).dblclick()
  await expect.poll(() => names(page, 0)).toEqual(['deep', 'a.txt'])
  await page.keyboard.press('Alt+ArrowLeft')
  await expect.poll(() => names(page, 0)).toEqual(['docs', 'pics', 'p1.jpg', 'p2.jpg', 'notes.txt', 'readme.md'])
})

test('copying nested items asks to recreate structure', async () => {
  const { page } = h
  await (await item(page, 0, 'docs')).click()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => names(page, 0)).toContain('a.txt')
  await (await item(page, 0, 'a.txt')).click()
  await (await item(page, 0, 'notes.txt')).click({ modifiers: ['ControlOrMeta'] })
  await page.keyboard.press('Control+1')
  await expect(page.getByTestId('nested-dialog')).toBeVisible()
  await page.getByTestId('nested-structure').click()
  await expect.poll(() => exists(path.join(h.right, 'docs', 'a.txt'))).toBe(true)
  await expect.poll(() => exists(path.join(h.right, 'notes.txt'))).toBe(true)
  expect(await exists(path.join(h.right, 'a.txt'))).toBe(false)
})

test('selection commands: SIMILAR, SOURCETODEST, RESELECT', async () => {
  const { page } = h
  await (await item(page, 0, 'pics')).click()
  await page.keyboard.press('ArrowRight')
  await (await item(page, 0, 'p1.jpg')).click()
  await page.keyboard.press('>')
  await page.getByTestId('cli-input').fill('Select SIMILAR')
  await page.getByTestId('cli-input').press('Enter')
  await expect.poll(() => selectedNames(page, 0)).toEqual(['p1.jpg', 'p2.jpg'])
  await (await item(page, 0, 'readme.md')).click()
  await page.keyboard.press('>')
  await page.getByTestId('cli-input').fill('Select SOURCETODEST')
  await page.getByTestId('cli-input').press('Enter')
  await expect.poll(() => selectedNames(page, 1)).toEqual(['readme.md'])
  await (await item(page, 0, 'notes.txt')).click()
  await page.keyboard.press('Control+1')
  await expect.poll(() => names(page, 1)).toContain('notes.txt')
  await page.keyboard.press('Escape')
  await page.keyboard.press('>')
  await page.getByTestId('cli-input').fill('Select RESELECT')
  await page.getByTestId('cli-input').press('Enter')
  await expect.poll(() => selectedNames(page, 0)).toEqual(['notes.txt'])
})

test('Navigation Lock makes the destination follow', async () => {
  const { page } = h
  await fsp.mkdir(path.join(h.right, 'docs'))
  await focusList()
  await page.keyboard.press('Control+Shift+L')
  await (await item(page, 0, 'docs')).dblclick()
  await expect.poll(() => names(page, 0)).toEqual(['deep', 'a.txt'])
  await expect(page.getByTestId('breadcrumbs-1')).toContainText('docs')
  await page.keyboard.press('Backspace')
  await expect.poll(() => names(page, 1)).toEqual(['docs', 'readme.md'])
})

test('tab keys: Ctrl+PgDn/PgUp, Ctrl+Shift+W undo close', async () => {
  const { page } = h
  await focusList()
  await page.keyboard.press('Control+T')
  await (await item(page, 0, 'docs')).dblclick()
  await expect.poll(() => names(page, 0)).toEqual(['deep', 'a.txt'])
  await page.keyboard.press('Control+PageUp')
  await expect.poll(() => names(page, 0)).toContain('readme.md')
  await page.keyboard.press('Control+PageDown')
  await page.keyboard.press('Control+W')
  await expect(page.locator('[data-testid="pane-0"] .tab')).toHaveCount(1)
  await page.keyboard.press('Control+Shift+W')
  await expect(page.locator('[data-testid="pane-0"] .tab')).toHaveCount(2)
  await expect.poll(() => names(page, 0)).toEqual(['deep', 'a.txt'])
})

test('Copy AS, dated folder and Commander keymap switch', async () => {
  const { page } = h
  await (await item(page, 0, 'notes.txt')).click()
  await page.keyboard.press('Control+Shift+1')
  await page.getByTestId('prompt-input').fill('copy-of-notes.txt')
  await page.getByTestId('prompt-input').press('Enter')
  await expect.poll(() => exists(path.join(h.right, 'copy-of-notes.txt'))).toBe(true)
  await page.keyboard.press('>')
  await page.getByTestId('cli-input').fill('Copy CREATEFOLDER="{date|yyyy}-backup"')
  await page.getByTestId('cli-input').press('Enter')
  await expect.poll(() => exists(path.join(h.right, `${new Date().getFullYear()}-backup`, 'notes.txt'))).toBe(true)
  await page.keyboard.press('>')
  await page.getByTestId('cli-input').fill('Set KEYMAP=commander')
  await page.getByTestId('cli-input').press('Enter')
  await (await item(page, 0, 'readme.md')).click()
  await page.keyboard.press('F7')
  await expect(page.getByTestId('prompt-dialog')).toBeVisible()
  await page.keyboard.press('Escape')
})

test('folder tree + and - expand and collapse levels', async () => {
  const { page } = h
  const tree = page.getByTestId('folder-tree')
  const current = tree.locator('.tree-node.current')
  await expect(current).toContainText('left', { timeout: 15000 })
  await current.locator('.tree-label').click()
  await tree.focus()
  await page.keyboard.press('+')
  await expect(tree.locator('.tree-node', { hasText: /^docs$/ })).toBeVisible()
  await page.keyboard.press('+')
  await expect(tree.locator('.tree-node', { hasText: /^deep$/ })).toBeVisible()
  await page.keyboard.press('-')
  await expect(tree.locator('.tree-node', { hasText: /^deep$/ })).toHaveCount(0)
  await page.keyboard.press('-')
  await expect(tree.locator('.tree-node', { hasText: /^docs$/ })).toHaveCount(0)
})
