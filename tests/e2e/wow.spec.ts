import { test, expect, type Locator } from '@playwright/test'
import { promises as fsp } from 'node:fs'
import * as path from 'node:path'
import { deflateSync } from 'node:zlib'
import { launch, write, names, focusedName, item, type Harness } from './helpers'

function png(w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h, 120)
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Buffer): number => {
    let c = 0xffffffff
    for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (t: string, d: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(d.length)
    const td = Buffer.concat([Buffer.from(t), d])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

let h: Harness

async function fixture(left: string, right: string): Promise<void> {
  await write(path.join(left, 'readme.md'), '# Project Opal\n\nA **file manager** with *Quick Look*.\n\n- one\n- two\n')
  await write(path.join(left, 'boiler.txt'), 'Invoice for the boiler maintenance, total due within thirty days.')
  await write(path.join(left, 'cake.txt'), 'Grandma apple cake recipe with cinnamon and sugar.')
  await fsp.writeFile(path.join(left, 'photo.png'), png(64, 48))
  await write(path.join(left, 'docs', 'notes.txt'), 'meeting notes')
  await write(path.join(left, 'docs', 'deep', 'x.txt'), 'x')
  await write(path.join(right, 'r.txt'), 'r')
}

test.afterEach(async () => {
  await h?.close()
})

function intersects(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

async function box(l: Locator) {
  const b = await l.boundingBox()
  if (!b) throw new Error('no bounding box')
  return b
}

test('Quick Look with Space: markdown, arrows, image, Escape', async () => {
  h = await launch(fixture)
  const { page } = h
  await (await item(page, 0, 'readme.md')).click()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('quicklook')).toBeVisible()
  await expect(page.getByTestId('ql-markdown').locator('h1')).toHaveText('Project Opal')
  await expect(page.getByTestId('ql-markdown').locator('strong')).toHaveText('file manager')
  await page.keyboard.press('ArrowUp')
  await expect(page.getByTestId('quicklook')).toContainText('photo.png')
  await expect(page.getByTestId('ql-image')).toBeVisible()
  await page.screenshot({ path: path.join(__dirname, '../../test-results/quicklook.png') })
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('quicklook')).toHaveCount(0)
  await expect.poll(() => focusedName(page, 0)).toBe('photo.png')
  await page.keyboard.press('Space')
  await expect(page.getByTestId('quicklook')).toBeVisible()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('quicklook')).toHaveCount(0)
})

test('Finder-style column view with keyboard and preview column', async () => {
  h = await launch(fixture)
  const { page } = h
  await (await item(page, 0, 'docs')).click()
  // macOS reserves Cmd+Shift+5 for screenshots, so the column view lives on Cmd+Alt+3 there.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+3' : 'Control+Shift+5')
  await expect(page.getByTestId('mcol')).toHaveCount(2)
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => focusedName(page, 0)).toBe('deep')
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => focusedName(page, 0)).toBe('notes.txt')
  await expect(page.getByTestId('column-preview')).toContainText('notes.txt')
  // A file-system change refreshes the folder; the column chain and focus must survive it.
  await write(path.join(h.left, 'added-later.txt'), 'n')
  await expect(page.locator('[data-testid="mcol"]').first()).toContainText('added-later.txt')
  await page.waitForTimeout(400)
  expect(await focusedName(page, 0)).toBe('notes.txt')
  await expect(page.getByTestId('column-preview')).toContainText('notes.txt')
  await page.screenshot({ path: path.join(__dirname, '../../test-results/columns.png') })
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => focusedName(page, 0)).toBe('docs')
})

test('group by kind from the column header menu, collapse a group', async () => {
  h = await launch(fixture)
  const { page } = h
  await page.getByTestId('hcell-name').first().click({ button: 'right' })
  await expect(page.getByTestId('column-menu')).toBeVisible()
  await page.getByTestId('column-menu').getByText('Kind', { exact: true }).click()
  const headers = page.locator('[data-testid="list-0"] [data-testid="group-header"]')
  await expect(headers).toHaveCount(3)
  await expect(headers.nth(0)).toContainText('Folders')
  await expect(headers.nth(1)).toContainText('Images')
  await expect(headers.nth(2)).toContainText('Documents')
  await headers.nth(2).click()
  await expect.poll(() => names(page, 0)).toEqual(['docs', 'photo.png'])
})

test('sort by size via header and Dimensions column via preferences', async () => {
  h = await launch(fixture)
  const { page } = h
  await page.locator('[data-testid="list-0"] [data-testid="hcell-size"]').click()
  const files = ['readme.md', 'boiler.txt', 'cake.txt', 'photo.png']
  const sizes = await Promise.all(files.map(async (f) => [f, (await fsp.stat(path.join(h.left, f))).size] as const))
  const bySize = [...sizes].sort((a, b) => b[1] - a[1]).map(([f]) => f)
  await expect.poll(async () => (await names(page, 0)).slice(1)).toEqual(bySize)
  await page.keyboard.press('Control+,')
  await page.getByTestId('prefs-tab-lists').click()
  await page.getByTestId('prefs-dialog').getByText('Dimensions', { exact: true }).click()
  await page.getByTestId('prefs-close').click()
  await expect(page.locator('[data-testid="list-0"] [data-testid="hcell-dimensions"]')).toBeVisible()
  await expect(page.locator('[data-testid="list-0"] .item', { hasText: 'photo.png' })).toContainText('64 × 48')
})

test('labels from the context menu, sidebar count and tagged list', async () => {
  h = await launch(fixture)
  const { page } = h
  await (await item(page, 0, 'cake.txt')).click({ button: 'right' })
  await page.getByTestId('context-menu').getByText('Label', { exact: true }).hover()
  await page.getByTestId('label-red').click()
  await expect(page.locator('[data-testid="list-0"] .item', { hasText: 'cake.txt' }).getByTestId('label-dots')).toBeVisible()
  const section = page.getByTestId('labels-section')
  await expect(section).toContainText('Red')
  await expect(section).toContainText('1')
  await section.getByText('Red').click()
  await expect(page.getByTestId('tagged-dialog')).toContainText('cake.txt')
})

test('helper cards appear beside the target and never cover it', async () => {
  h = await launch(fixture)
  const { page } = h
  const btn = page.getByTestId('tb-find')
  await btn.hover()
  const card = page.getByTestId('helper-card')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Find')
  expect(intersects(await box(card), await box(btn))).toBe(false)
  await page.mouse.move(5, 500)
  await expect(card).toHaveCount(0)
  const row = page.locator('[data-testid="list-0"] .item', { hasText: 'boiler.txt' })
  await row.locator('.name-text').hover()
  await expect(card).toBeVisible({ timeout: 4000 })
  await expect(card).toContainText('Text Document')
  expect(intersects(await box(card), await box(row.locator('.name-text')))).toBe(false)
  await (await item(page, 0, 'boiler.txt')).click({ button: 'right' })
  const menuItem = page.getByTestId('context-menu').getByText('Quick Look', { exact: true })
  await menuItem.hover()
  await expect(card).toContainText('Large preview')
  expect(intersects(await box(card), await box(page.getByTestId('context-menu')))).toBe(false)
  await page.screenshot({ path: path.join(__dirname, '../../test-results/helper.png') })
})

test('semantic search indexes a folder and finds documents by content', async () => {
  h = await launch(fixture)
  const { page } = h
  await page.getByTestId('tb-semantic').click()
  await expect(page.getByTestId('semantic-dialog')).toBeVisible()
  await page.getByTestId('semantic-add-folder').click()
  await expect(page.getByTestId('semantic-status')).toContainText(/\b[4-9] documents indexed/, { timeout: 15000 })
  // Results arrive while typing (no Enter needed), ranked precisely, with a preview of the selected one.
  await page.getByTestId('semantic-input').fill('boiler maintenance invoice')
  await expect(page.getByTestId('semantic-hit').first()).toContainText('boiler.txt')
  await expect(page.getByTestId('semantic-mode')).toContainText('Precise')
  await expect(page.getByTestId('semantic-preview')).toContainText('boiler.txt')
  await expect(page.getByTestId('semantic-preview').locator('mark').first()).toBeVisible()
  await page.screenshot({ path: path.join(__dirname, '../../test-results/semantic.png') })
  // Type filter: only Markdown/text documents → the recipe query still works, PDFs-only finds nothing.
  await page.getByTestId('semantic-input').fill('apple cake recipe cinnamon')
  await expect(page.getByTestId('semantic-hit').first()).toContainText('cake.txt')
  await page.getByTestId('semantic-type-pdf').click()
  await expect(page.getByTestId('semantic-results')).toContainText('Nothing relevant found')
  await page.getByTestId('semantic-type-pdf').click()
  await expect(page.getByTestId('semantic-hit').first()).toContainText('cake.txt')
  await page.getByTestId('semantic-input').fill('boiler maintenance invoice')
  await expect(page.getByTestId('semantic-hit').first()).toContainText('boiler.txt')
  await page.getByTestId('semantic-hit').first().dblclick()
  await expect.poll(() => focusedName(page, 0)).toBe('boiler.txt')
})

test('appearance and toolbar customisation apply live', async () => {
  h = await launch(fixture)
  const { page } = h
  await page.getByTestId('tb-prefs').click()
  await page.getByTestId('accent-picker').locator('button').nth(4).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--accent'))).toBe('#ff375f')
  await page.getByTestId('theme-select').getByText('Light').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByTestId('prefs-tab-toolbar').click()
  await page.getByTestId('toolbar-editor').locator('.tb-edit-row', { hasText: 'Duplicates' }).locator('input').uncheck()
  await page.getByTestId('prefs-close').click()
  await expect(page.getByTestId('tb-dupes')).toHaveCount(0)
  await expect(page.getByTestId('tb-find')).toBeVisible()
  await page.screenshot({ path: path.join(__dirname, '../../test-results/light-accent.png') })
})

test('first-run setup wizard', async () => {
  h = await launch(fixture, { OPAL_NO_SETUP: '0', OPAL_START_PATHS: '' })
  const { page } = h
  await expect(page.getByTestId('setup-dialog')).toBeVisible()
  await page.getByTestId('setup-next').click()
  await page.getByTestId('layout-picker').getByText('Commander').click()
  await page.getByTestId('setup-next').click()
  await page.getByTestId('setup-next').click()
  await page.getByTestId('setup-next').click()
  await page.getByTestId('setup-next').click()
  await expect(page.getByTestId('setup-dialog')).toHaveCount(0)
  await expect
    .poll(async () => {
      try {
        const s = JSON.parse(await fsp.readFile(path.join(h.userData, 'opal-settings.json'), 'utf8'))
        return [s.prefs.setupDone, s.prefs.showTree]
      } catch {
        return null
      }
    })
    .toEqual([true, false])
})
