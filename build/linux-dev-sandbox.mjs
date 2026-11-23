#!/usr/bin/env node
/**
 * Runs after `npm install` (postinstall). Linux only; does nothing on Windows and macOS.
 *
 * Ubuntu 23.10 and later block unprivileged user namespaces through AppArmor, so the Electron in node_modules cannot
 * start Chromium's sandbox, falls back to node_modules/electron/dist/chrome-sandbox, finds it is not setuid root and
 * aborts at once ("The SUID sandbox helper binary was found, but is not configured correctly"). That breaks every way
 * of starting the development build that runs that executable directly.
 *
 * When (and only when) that is the case, the executable is renamed `electron-bin` and replaced by a small script that
 * starts it with --no-sandbox. The installed app is not affected: electron-builder packages its own copy of Electron,
 * and the .deb ships an AppArmor profile and a setuid helper. `--restore` puts the original executable back.
 */
import { chmodSync, readFileSync, renameSync, statSync, writeFileSync, existsSync, openSync, readSync, closeSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const MARK = '# opal-linux-dev-sandbox'

function readFlag(file) {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return null
  }
}

function isWrapper(file) {
  try {
    const fd = openSync(file, 'r')
    const buf = Buffer.alloc(200)
    const n = readSync(fd, buf, 0, buf.length, 0)
    closeSync(fd)
    return buf.subarray(0, n).toString('utf8').includes(MARK)
  } catch {
    return false
  }
}

function sandboxUnavailable(dist) {
  try {
    const st = statSync(path.join(dist, 'chrome-sandbox'))
    if (st.uid === 0 && (st.mode & 0o4000) !== 0) return false
  } catch {
    /* no helper: the namespace sandbox decides */
  }
  return (
    readFlag('/proc/sys/kernel/apparmor_restrict_unprivileged_userns') === '1' ||
    readFlag('/proc/sys/kernel/unprivileged_userns_clone') === '0' ||
    readFlag('/proc/sys/user/max_user_namespaces') === '0'
  )
}

function main() {
  if (process.platform !== 'linux') return
  let exe
  try {
    exe = createRequire(import.meta.url)('electron') // path of the Electron executable
  } catch {
    return // electron not installed (e.g. production install)
  }
  if (typeof exe !== 'string' || !existsSync(exe)) return
  const dist = path.dirname(exe)
  const real = path.join(dist, 'electron-bin')
  const wrapped = isWrapper(exe)

  if (process.argv.includes('--restore')) {
    if (wrapped && existsSync(real)) renameSync(real, exe)
    return
  }
  if (wrapped || !sandboxUnavailable(dist)) return

  renameSync(exe, real)
  writeFileSync(
    exe,
    `#!/bin/sh\n${MARK}: this Linux system blocks the Electron sandbox for development builds (see build/linux-dev-sandbox.mjs).\n` +
      `exec "$(dirname "$(readlink -f "$0")")/electron-bin" --no-sandbox "$@"\n`
  )
  chmodSync(exe, 0o755)
  console.log('[opal] Linux: the development Electron starts without the sandbox, which this system blocks.')
}

main()
