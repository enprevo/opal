#!/usr/bin/env node
/**
 * Runs `electron-vite dev` or `electron-vite preview` (npm run dev / npm start) on every platform.
 *
 * On Linux, Electron from node_modules cannot start its sandbox when the system blocks unprivileged user namespaces
 * (Ubuntu 23.10 and later, through AppArmor) and node_modules/electron/dist/chrome-sandbox is not a setuid-root
 * helper: Chromium then aborts at once ("The SUID sandbox helper binary was found, but is not configured correctly").
 * Only in that case the development build runs without the sandbox. The installed app is not affected: its package
 * ships an AppArmor profile and a setuid helper. Windows and macOS are left exactly as before.
 */
import { spawn } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

function readFlag(file) {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return null
  }
}

/** True when the Chromium sandbox of the Electron in node_modules cannot start on this Linux system. */
export function linuxSandboxUnavailable() {
  if (process.platform !== 'linux') return false
  let helperReady = false
  try {
    const electronBin = require('electron') // path of the Electron executable
    const st = statSync(path.join(path.dirname(electronBin), 'chrome-sandbox'))
    helperReady = st.uid === 0 && (st.mode & 0o4000) !== 0
  } catch {
    helperReady = false
  }
  if (helperReady) return false
  const restricted = readFlag('/proc/sys/kernel/apparmor_restrict_unprivileged_userns') === '1'
  const cloneOff = readFlag('/proc/sys/kernel/unprivileged_userns_clone') === '0'
  const maxNs = readFlag('/proc/sys/user/max_user_namespaces')
  return restricted || cloneOff || maxNs === '0'
}

const [mode = 'preview', ...rest] = process.argv.slice(2)
const args = [mode, ...rest]
if (linuxSandboxUnavailable() && !args.includes('--noSandbox')) {
  args.push('--noSandbox')
  console.log('[opal] This Linux system blocks the Electron sandbox for development builds: starting without it.')
}

const cli = path.join(path.dirname(require.resolve('electron-vite/package.json')), 'bin', 'electron-vite.js')
const child = spawn(process.execPath, [cli, ...args], { stdio: 'inherit' })
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
