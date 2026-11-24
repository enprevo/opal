import { describe, expect, it } from 'vitest'
import { findPackage, linuxTarget, nodeIsRecent } from '../../build/install.mjs'

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
  it('asks for Node.js 22.12 or newer', () => {
    expect(nodeIsRecent('22.12.0')).toBe(true)
    expect(nodeIsRecent('24.1.0')).toBe(true)
    expect(nodeIsRecent('22.11.9')).toBe(false)
    expect(nodeIsRecent('20.19.0')).toBe(false)
  })
})
