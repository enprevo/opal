import { test, expect } from '@playwright/test'
import path from 'node:path'
import { launch, write, item, type Harness } from './helpers'

let h: Harness | null = null

test.afterEach(async () => {
  await h?.close()
  h = null
})

const PY = 'import os\n\ndef greet(name):\n    """Say hi\n    twice"""\n    return "hi " + name  # done\n'

test('Quick Look colors source code by language and leaves plain text alone', async () => {
  h = await launch(async (left) => {
    await write(path.join(left, 'main.py'), PY)
    await write(path.join(left, 'config.json'), '{\n  "name": "opal",\n  "count": 3,\n  "ok": true\n}\n')
    await write(path.join(left, 'notes.txt'), 'def not_code():\n    return 1\n')
    await write(path.join(left, 'guide.md'), '# Guide\n\n```py\ndef f():\n    return 1\n```\n')
    await write(path.join(left, 'deploy'), '#!/bin/bash\necho "deploying"\nif [ -f x ]; then exit 1; fi\n')
  })
  const p = h.page
  const code = p.getByTestId('ql-text')

  await (await item(p, 0, 'main.py')).click()
  await p.keyboard.press('Space')
  await expect(p.getByTestId('quicklook')).toBeVisible()
  await expect(code.locator('.hljs-keyword').first()).toBeVisible()
  await expect(code.locator('.hljs-keyword', { hasText: 'def' })).toHaveCount(1)
  await expect(code.locator('.hljs-string').first()).toBeVisible()
  await expect(code.locator('.hljs-comment', { hasText: '# done' })).toHaveCount(1)
  // A docstring over two lines is coloured on both lines, and the text is unchanged.
  await expect(code.locator('.hljs-string', { hasText: 'Say hi' })).toHaveCount(1)
  await expect(code.locator('.hljs-string', { hasText: 'twice' })).toHaveCount(1)
  await expect(code.locator('.ql-line')).toHaveCount(7)
  expect(await code.locator('.ql-line').nth(2).innerText()).toContain('def greet(name):')
  const keywordColor = await code.locator('.hljs-keyword').first().evaluate((el) => getComputedStyle(el).color)
  const plainColor = await code.locator('.ql-line').nth(2).evaluate((el) => getComputedStyle(el).color)
  expect(keywordColor).not.toBe(plainColor)

  // Plain text is not coloured (next in the list: config.json, deploy, guide.md, main.py, notes.txt).
  await p.keyboard.press('ArrowDown')
  await expect(p.getByTestId('quicklook')).toContainText('notes.txt')
  await expect(code.locator('.ql-line')).toHaveCount(3)
  await expect(code.locator('[class^="hljs-"]')).toHaveCount(0)

  // A fenced block inside Markdown is coloured too.
  await p.keyboard.press('ArrowUp')
  await p.keyboard.press('ArrowUp')
  await expect(p.getByTestId('ql-markdown')).toBeVisible()
  await expect(p.getByTestId('ql-markdown').locator('pre code .hljs-keyword', { hasText: 'def' })).toHaveCount(1)

  // A script without extension is recognised from its #! line.
  await p.keyboard.press('ArrowUp')
  await expect(p.getByTestId('quicklook')).toContainText('deploy')
  await expect(code.locator('.hljs-keyword', { hasText: 'if' })).toHaveCount(1)

  // JSON: keys, numbers and literals.
  await p.keyboard.press('ArrowUp')
  await expect(p.getByTestId('quicklook')).toContainText('config.json')
  await expect(code.locator('.hljs-attr', { hasText: '"name"' })).toHaveCount(1)
  await expect(code.locator('.hljs-number', { hasText: '3' })).toHaveCount(1)
  await expect(code.locator('.hljs-literal', { hasText: 'true' })).toHaveCount(1)
})

test('viewer pane colors source code too', async () => {
  h = await launch(async (left) => {
    await write(path.join(left, 'main.py'), PY)
  })
  const p = h.page
  await (await item(p, 0, 'main.py')).click()
  await p.keyboard.press('F7')
  const viewer = p.getByTestId('viewer-text')
  await expect(viewer).toContainText('def greet(name):')
  await expect(viewer.locator('.hljs-keyword', { hasText: 'def' })).toHaveCount(1)
})
