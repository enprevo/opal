import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fsp, realpathSync } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export interface Harness {
  app: ElectronApplication
  page: Page
  root: string
  left: string
  right: string
  userData: string
  close: () => Promise<void>
}

export async function write(file: string, content = 'x'): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, content)
}

export async function launch(setup?: (left: string, right: string) => Promise<void>, extraEnv: Record<string, string> = {}): Promise<Harness> {
  const root = realpathSync.native(await fsp.mkdtemp(path.join(os.tmpdir(), 'opal-e2e-')))
  const left = path.join(root, 'left')
  const right = path.join(root, 'right')
  const userData = path.join(root, 'userdata')
  await fsp.mkdir(left, { recursive: true })
  await fsp.mkdir(right, { recursive: true })
  await fsp.mkdir(userData, { recursive: true })
  if (setup) await setup(left, right)
  const app = await electron.launch({
    args: [path.join(__dirname, '../../out/main/index.js'), ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : [])],
    env: { ...process.env, OPAL_USER_DATA: userData, OPAL_START_PATHS: `${left}|${right}`, OPAL_EMBEDDER: 'hash', OPAL_NO_SETUP: '1', ...extraEnv } as Record<string, string>
  })
  const page = await app.firstWindow()
  await page.waitForSelector('[data-testid="list-0"]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="list-0"] .item').length > 0 || document.querySelector('[data-testid="list-0"] .list-message'))
  return {
    app,
    page,
    root,
    left,
    right,
    userData,
    close: async () => {
      await app.close().catch(() => undefined)
      await fsp.rm(root, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

export function names(page: Page, pane: 0 | 1): Promise<string[]> {
  return page.$$eval(`[data-testid="list-${pane}"] .item`, (els) =>
    els
      .map((e) => ({ top: (e as HTMLElement).offsetTop, left: (e as HTMLElement).offsetLeft, name: (e.querySelector('.name-text, .label') as HTMLElement | null)?.textContent ?? '' }))
      .sort((a, b) => a.top - b.top || a.left - b.left)
      .map((x) => x.name)
  )
}

export function selectedNames(page: Page, pane: 0 | 1): Promise<string[]> {
  return page.$$eval(`[data-testid="list-${pane}"] .item.selected`, (els) =>
    els
      .map((e) => ({ top: (e as HTMLElement).offsetTop, name: (e.querySelector('.name-text, .label') as HTMLElement | null)?.textContent ?? '' }))
      .sort((a, b) => a.top - b.top)
      .map((x) => x.name)
  )
}

export function focusedName(page: Page, pane: 0 | 1): Promise<string | null> {
  return page.$eval(`[data-testid="list-${pane}"]`, (el) => (el.querySelector('.item.focused .name-text, .item.focused .label') as HTMLElement | null)?.textContent ?? null)
}

export async function item(page: Page, pane: 0 | 1, name: string) {
  return page.locator(`[data-testid="list-${pane}"] .item`, { has: page.locator(`.name-text:text-is("${name}"), .label:text-is("${name}")`) })
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fsp.lstat(p)
    return true
  } catch {
    return false
  }
}
