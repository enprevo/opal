import { describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findPackage, formatSize, linuxTarget, nodeIsRecent, sizeOf } from '../../build/install.mjs'

describe('one-step installer', () => {
  it('picks the package Linux can install', () => {
    const with_ = (...cmds: string[]) => (c: string) => cmds.includes(c)
    expect(linuxTarget(with_('apt-get', 'dpkg'))).toBe('deb')
    expect(linuxTarget(with_('dnf', 'rpmbuild'))).toBe('rpm')
    expect(linuxTarget(with_('zypper', 'rpmbuild'))).toBe('rpm')
    expect(linuxTarget(with_('dnf'))).toBe('AppImage')
    expect(linuxTarget(with_())).toBe('AppImage')
    expect(linuxTarget(with_('apt-get', 'dpkg'), true)).toBe('AppImage')
  })
  it('finds the installer among the packaged files', () => {
    const files = ['/d/Opal-1.0.0-win-x64.exe.blockmap', '/d/Opal-1.0.0-win-x64-portable.exe', '/d/Opal-1.0.0-win-x64.exe', '/d/latest.yml']
    expect(findPackage(files, 'exe')).toBe('/d/Opal-1.0.0-win-x64.exe')
    expect(findPackage(['/d/Opal-1.0.0-linux-x86_64.AppImage'], 'AppImage')).toBe('/d/Opal-1.0.0-linux-x86_64.AppImage')
    expect(findPackage(['/d/builder-debug.yml'], 'deb')).toBeUndefined()
  })
  it('measures and shows the space it frees', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'opal-install-'))
    await fsp.mkdir(path.join(dir, 'sub'))
    await fsp.writeFile(path.join(dir, 'a.bin'), Buffer.alloc(1500))
    await fsp.writeFile(path.join(dir, 'sub', 'b.bin'), Buffer.alloc(500))
    expect(sizeOf(dir)).toBe(2000)
    expect(sizeOf(path.join(dir, 'missing'))).toBe(0)
    await fsp.rm(dir, { recursive: true, force: true })
    expect(formatSize(1_234_000_000)).toBe('1.2 GB')
    expect(formatSize(312_457_172)).toBe('312 MB')
    expect(formatSize(2000)).toBe('2 kB')
  })
  it('asks for Node.js 22.12 or newer', () => {
    expect(nodeIsRecent('22.12.0')).toBe(true)
    expect(nodeIsRecent('24.1.0')).toBe(true)
    expect(nodeIsRecent('22.11.9')).toBe(false)
    expect(nodeIsRecent('20.19.0')).toBe(false)
  })
})
