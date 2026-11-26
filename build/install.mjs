#!/usr/bin/env node
/**
 * Installs Opal on this computer from a clone of the repository, in one step. Started by `./install.sh` (macOS,
 * Linux) or `install.cmd` (Windows), which first make sure Node.js is there.
 *
 * It installs the dependencies, builds Opal, packages it for this computer (its OS and CPU) and installs it:
 *  - Windows: runs the installer silently for the current user (Start menu and desktop shortcut, no administrator).
 *  - macOS:   copies Opal.app to /Applications (or ~/Applications when that is not writable), signed for this Mac.
 *  - Linux:   the .deb with apt (Debian, Ubuntu, Mint...), the .rpm with dnf or zypper (Fedora, openSUSE) when
 *             rpmbuild is there, otherwise the AppImage in ~/.local/bin with an entry in the applications menu.
 * Then it starts Opal and deletes what is no longer needed (the packaged app). Running it again updates the
 * installed copy.
 *
 * Options: --no-open (do not start Opal at the end), --appimage (Linux: the AppImage even where apt or dnf exist),
 * --keep (keep the packaged app in dist/install), --clean-all (also delete the dependencies and the build).
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** Packages made by the installer go here, apart from the ones made with `npm run dist`. */
const OUT = 'dist/install'

/**
 * Which Linux package to make and install.
 * @param {(cmd: string) => boolean} has whether a command is available
 * @param {boolean} [appImage] the AppImage was asked for
 * @returns {'deb' | 'rpm' | 'AppImage'}
 */
export function linuxTarget(has, appImage = false) {
  if (appImage) return 'AppImage'
  if (has('apt-get') && has('dpkg')) return 'deb'
  if ((has('dnf') || has('zypper')) && has('rpmbuild')) return 'rpm'
  return 'AppImage'
}

/**
 * The package with that extension among the files electron-builder wrote (not the Windows portable exe).
 * @param {string[]} files
 * @param {string} ext
 * @returns {string | undefined}
 */
export function findPackage(files, ext) {
  const suffix = `.${ext.toLowerCase()}`
  return files.find((f) => f.toLowerCase().endsWith(suffix) && !/portable|uninstall/i.test(f))
}

/**
 * Whether this Node.js can build Opal (package.json asks for 22.12 or newer).
 * @param {string} version e.g. "22.12.0"
 */
export function nodeIsRecent(version) {
  const [major, minor] = version.split('.').map(Number)
  return major > 22 || (major === 22 && minor >= 12)
}

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'

function step(text) {
  console.log(`\n\x1b[1m▸ ${text}\x1b[0m`)
}

/** Temporary files to delete when the installer ends, however it ends. */
const temporary = new Set()
let keepPackages = false

function fail(text) {
  console.error(`\n\x1b[31m✖ ${text}\x1b[0m`)
  cleanUp(false)
  process.exit(1)
}

/**
 * Size in bytes of a file or folder (links are not followed).
 * @param {string} p
 * @returns {number}
 */
export function sizeOf(p) {
  let st
  try {
    st = fs.lstatSync(p)
  } catch {
    return 0
  }
  if (!st.isDirectory()) return st.size
  let total = 0
  for (const name of fs.readdirSync(p)) total += sizeOf(path.join(p, name))
  return total
}

/**
 * "1.2 GB", "350 MB".
 * @param {number} bytes
 */
export function formatSize(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  return `${Math.max(1, Math.round(bytes / 1e3))} kB`
}

/**
 * Deletes what is no longer needed once Opal is installed: the packaged app and its temporary copy (unless --keep),
 * and with --clean-all also the dependencies and the build (the next install downloads and builds them again).
 * Returns the bytes freed.
 * @param {boolean} all
 */
function cleanUp(all) {
  const paths = [...temporary]
  if (!keepPackages) paths.push(path.join(root, OUT))
  if (all) paths.push(path.join(root, 'node_modules'), path.join(root, 'out'))
  let freed = 0
  for (const p of paths) {
    const size = sizeOf(p)
    try {
      fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 })
      freed += size
    } catch {
      // A file still in use (Windows): it is left for the next run.
    }
  }
  temporary.clear()
  return freed
}

/** Runs a command in the project folder, showing its output; stops the install when it fails. */
function run(cmd, args, what, options = {}) {
  // npm and npx are .cmd scripts on Windows, which Node only starts through the shell.
  const shell = isWin && /^(npm|npx)$/.test(cmd)
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell, ...options })
  if (r.error) fail(`${what} could not start: ${r.error.message}`)
  if (r.status !== 0) fail(`${what} did not succeed (see the messages above).`)
}

function has(cmd) {
  const r = isWin ? spawnSync('where', [cmd], { stdio: 'ignore' }) : spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' })
  return r.status === 0
}

function start(file, args = []) {
  try {
    const child = spawn(file, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => undefined)
    child.unref()
    return true
  } catch {
    return false
  }
}

function packageFiles() {
  const dir = path.join(root, OUT)
  return fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => path.join(dir, f)) : []
}

function buildPackage(platformFlag, target, env = {}) {
  step(`Packaging Opal for this computer (${target})`)
  fs.rmSync(path.join(root, OUT), { recursive: true, force: true })
  run('npx', ['electron-builder', platformFlag, target, '--publish', 'never', `-c.directories.output=${OUT}`], 'Packaging', {
    env: { ...process.env, ...env }
  })
}

function sudo(args, what) {
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
  if (!asRoot) console.log('Your password may be asked to install it for the whole system.')
  run(asRoot ? args[0] : 'sudo', asRoot ? args.slice(1) : args, what)
}

function installWindows(open) {
  buildPackage('--win', 'nsis')
  const exe = findPackage(packageFiles(), 'exe')
  if (!exe) fail('The installer was not found after packaging.')
  step('Installing Opal for your user')
  run(exe, ['/S', '/currentuser'], 'The installer')
  const base = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Programs')
  const app = ['Opal', 'opal-file-manager'].map((d) => path.join(base, d, 'Opal.exe')).find((f) => fs.existsSync(f))
  console.log('Opal is in the Start menu and on the desktop.')
  if (open && app) start(app)
}

function installMac(open) {
  // Not signed with a developer certificate here: the app is signed for this Mac only, below.
  buildPackage('--mac', 'dir', { CSC_IDENTITY_AUTO_DISCOVERY: 'false' })
  const dirs = packageFiles().filter((d) => path.basename(d).startsWith('mac'))
  const built = dirs.map((d) => path.join(d, 'Opal.app')).find((f) => fs.existsSync(f))
  if (!built) fail('Opal.app was not found after packaging.')
  let target = '/Applications'
  try {
    fs.accessSync(target, fs.constants.W_OK)
  } catch {
    target = path.join(os.homedir(), 'Applications')
    fs.mkdirSync(target, { recursive: true })
  }
  const dest = path.join(target, 'Opal.app')
  step(`Installing Opal in ${target}`)
  fs.rmSync(dest, { recursive: true, force: true })
  run('ditto', [built, dest], 'Copying Opal.app')
  run('codesign', ['--force', '--deep', '--sign', '-', dest], 'Signing Opal.app for this Mac')
  console.log('Opal is in Applications and in Launchpad.')
  if (open) start('open', [dest])
}

function installLinuxAppImage(open) {
  buildPackage('--linux', 'AppImage')
  const image = findPackage(packageFiles(), 'AppImage')
  if (!image) fail('The AppImage was not found after packaging.')
  step('Installing Opal for your user')
  const home = os.homedir()
  const bin = path.join(home, '.local', 'bin')
  const apps = path.join(home, '.local', 'share', 'applications')
  const icons = path.join(home, '.local', 'share', 'icons')
  for (const d of [bin, apps, icons]) fs.mkdirSync(d, { recursive: true })
  const dest = path.join(bin, 'Opal.AppImage')
  fs.copyFileSync(image, dest)
  fs.chmodSync(dest, 0o755)
  const icon = path.join(icons, 'opal-file-manager.png')
  fs.copyFileSync(path.join(root, 'build', 'icon.png'), icon)
  // Named like the app's window class, so the dock shows the right icon and "Pin to Dash" works.
  fs.writeFileSync(
    path.join(apps, 'opal-file-manager.desktop'),
    [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Opal',
      'Comment=Fast, keyboard-friendly dual-pane file manager',
      `Exec="${dest}" %U`,
      `Icon=${icon}`,
      'Terminal=false',
      'Categories=Utility;FileManager;',
      'StartupWMClass=opal-file-manager',
      ''
    ].join('\n')
  )
  if (has('update-desktop-database')) spawnSync('update-desktop-database', [apps], { stdio: 'ignore' })
  const fuse = spawnSync('sh', ['-c', 'ldconfig -p 2>/dev/null | grep -q "libfuse.so.2"'], { stdio: 'ignore' })
  if (fuse.status !== 0)
    console.log('Note: AppImages need FUSE 2. If Opal does not start, install it (on Ubuntu 24.04: sudo apt install libfuse2t64).')
  console.log(`Opal is in the applications menu (${dest}).`)
  if (open) start(dest)
}

function installLinux(open, appImage) {
  const target = linuxTarget(has, appImage)
  if (target === 'AppImage') return installLinuxAppImage(open)
  buildPackage('--linux', target)
  const pkg = findPackage(packageFiles(), target)
  if (!pkg) fail(`The .${target} package was not found after packaging.`)
  // apt reads the package as its own "_apt" user, which cannot always enter the project folder.
  const copy = path.join(os.tmpdir(), path.basename(pkg))
  temporary.add(copy)
  fs.copyFileSync(pkg, copy)
  fs.chmodSync(copy, 0o644)
  step('Installing Opal')
  if (target === 'deb') sudo(['apt-get', 'install', '-y', copy], 'Installing the .deb')
  else if (has('dnf')) sudo(['dnf', 'install', '-y', copy], 'Installing the .rpm')
  else sudo(['zypper', '--non-interactive', 'install', '--allow-unsigned-rpm', copy], 'Installing the .rpm')
  console.log('Opal is in the applications menu; from a terminal: opal-file-manager')
  if (open) start('opal-file-manager')
}

function main() {
  const args = process.argv.slice(2)
  const open = !args.includes('--no-open')
  keepPackages = args.includes('--keep')
  if (!nodeIsRecent(process.versions.node)) fail(`Opal needs Node.js 22.12 or newer (this is ${process.versions.node}).`)
  if (!['win32', 'darwin', 'linux'].includes(process.platform)) fail(`This installer works on Windows, macOS and Linux, not on ${process.platform}.`)

  step('Installing the parts Opal is made of (the first time this takes a few minutes)')
  run('npm', ['install', '--no-audit', '--no-fund'], 'Installing the dependencies')
  step('Building Opal')
  run('npm', ['run', 'build'], 'Building')

  if (isWin) installWindows(open)
  else if (isMac) installMac(open)
  else installLinux(open, args.includes('--appimage'))

  step('Deleting what is no longer needed')
  const all = args.includes('--clean-all')
  const freed = cleanUp(all)
  console.log(
    `${freed ? `Freed ${formatSize(freed)}` : 'Nothing to delete'}${keepPackages ? ` (the package is kept in ${OUT})` : ''}.` +
      (all ? '' : ' The dependencies stay, so updating is quicker; --clean-all deletes them too.')
  )

  console.log('\n\x1b[32m✔ Opal is installed.\x1b[0m To update it later: get the latest code and run the installer again.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main()
