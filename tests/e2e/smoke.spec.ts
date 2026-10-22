import { test, expect } from '@playwright/test'
import * as path from 'node:path'
import { launch, write, names, type Harness } from './helpers'

let h: Harness

test.afterEach(async () => {
  await h?.close()
})

test('app starts with dual display listing both folders', async () => {
  h = await launch(async (left, right) => {
    await write(path.join(left, 'alpha.txt'), 'hello alpha')
    await write(path.join(left, 'beta.log'), 'b')
    await write(path.join(left, 'sub', 'inner.txt'))
    await write(path.join(right, 'right-file.md'), '# hi')
  })
  const { page } = h
  await expect.poll(() => names(page, 0)).toEqual(['sub', 'alpha.txt', 'beta.log'])
  await expect.poll(() => names(page, 1)).toEqual(['right-file.md'])
  await expect(page.getByTestId('pane-0')).toHaveClass(/is-source/)
  await expect(page.getByTestId('status-0')).toContainText('1 folder, 2 files')
  await page.screenshot({ path: path.join(__dirname, '../../test-results/smoke.png') })
})
