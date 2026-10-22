import { promises as fsp, constants as fsConstants, createReadStream, createWriteStream } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import type {
  ConflictPolicy,
  DirListing,
  FileEntry,
  FindOptions,
  JobProgress,
  Preview,
  RootInfo,
  SyncItem,
  TransferRequest,
  UndoEntry
} from '../shared/types'
import { compilePattern } from '../shared/wildcard'
import { previewKindForExt } from '../shared/filetypes'

const IS_WIN = process.platform === 'win32'

export interface CancelToken {
  cancelled: boolean
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

function winHiddenNames(dir: string): Promise<Set<string>> {
  if (!IS_WIN) return Promise.resolve(new Set())
  return new Promise((resolve) => {
    execFile(
      'cmd.exe',
      ['/d', '/u', '/c', 'dir', '/a:h', '/b', dir],
      { encoding: 'buffer', timeout: 4000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (_err, stdout) => {
        const names = new Set<string>()
        if (stdout && stdout.length) {
          for (const line of stdout.toString('utf16le').split(/\r?\n/)) if (line) names.add(line.toLowerCase())
        }
        resolve(names)
      }
    )
  })
}

export function extOf(name: string, isDir: boolean): string {
  if (isDir) return ''
  const idx = name.lastIndexOf('.')
  return idx > 0 ? name.slice(idx + 1) : ''
}

export async function statEntry(full: string, hiddenSet?: Set<string>): Promise<FileEntry> {
  const name = path.basename(full) || full
  let lst = await fsp.lstat(full)
  const isSymlink = lst.isSymbolicLink()
  if (isSymlink) {
    try {
      lst = await fsp.stat(full)
    } catch {
      // Broken link: keep lstat info.
    }
  }
  const isDir = lst.isDirectory()
  const hidden = name.startsWith('.') || (hiddenSet ? hiddenSet.has(name.toLowerCase()) : false)
  return {
    name,
    path: full,
    isDir,
    isSymlink,
    size: isDir ? 0 : lst.size,
    mtime: lst.mtimeMs,
    ctime: lst.birthtimeMs || lst.ctimeMs,
    atime: lst.atimeMs,
    ext: extOf(name, isDir),
    hidden,
    readonly: (lst.mode & 0o200) === 0,
    mode: lst.mode
  }
}

export async function listDir(dir: string): Promise<DirListing> {
  const resolved = path.resolve(dir)
  const [dirents, hiddenSet] = await Promise.all([fsp.readdir(resolved, { withFileTypes: true }), winHiddenNames(resolved)])
  const entries: FileEntry[] = []
  const BATCH = 256
  for (let i = 0; i < dirents.length; i += BATCH) {
    const slice = dirents.slice(i, i + BATCH)
    const stats = await Promise.all(
      slice.map(async (d) => {
        try {
          return await statEntry(path.join(resolved, d.name), hiddenSet)
        } catch {
          // Locked system files (pagefile.sys...) can't be stat'ed: show them with minimal info.
          const isDir = d.isDirectory()
          return {
            name: d.name,
            path: path.join(resolved, d.name),
            isDir,
            isSymlink: d.isSymbolicLink(),
            size: 0,
            mtime: 0,
            ctime: 0,
            atime: 0,
            ext: extOf(d.name, isDir),
            hidden: d.name.startsWith('.') || hiddenSet.has(d.name.toLowerCase()),
            readonly: false,
            mode: 0
          } satisfies FileEntry
        }
      })
    )
    entries.push(...stats)
  }
  const parent = path.dirname(resolved)
  const listing: DirListing = { path: resolved, parent: parent === resolved ? null : parent, entries }
  try {
    const sf = await fsp.statfs(resolved)
    listing.freeBytes = sf.bavail * sf.bsize
    listing.totalBytes = sf.blocks * sf.bsize
  } catch {
    // statfs not supported for this location
  }
  return listing
}

export async function listSubdirs(dir: string, showHidden: boolean): Promise<FileEntry[]> {
  const resolved = path.resolve(dir)
  const [dirents, hiddenSet] = await Promise.all([fsp.readdir(resolved, { withFileTypes: true }), winHiddenNames(resolved)])
  const out: FileEntry[] = []
  await Promise.all(
    dirents.map(async (d) => {
      let isDir = d.isDirectory()
      const full = path.join(resolved, d.name)
      if (!isDir && d.isSymbolicLink()) isDir = await fsp.stat(full).then((s) => s.isDirectory(), () => false)
      if (!isDir) return
      const hidden = d.name.startsWith('.') || hiddenSet.has(d.name.toLowerCase())
      if (hidden && !showHidden) return
      out.push({ name: d.name, path: full, isDir: true, isSymlink: d.isSymbolicLink(), size: 0, mtime: 0, ctime: 0, atime: 0, ext: '', hidden, readonly: false, mode: 0 })
    })
  )
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
}

async function existsWithTimeout(p: string, ms: number): Promise<boolean> {
  return Promise.race([
    fsp.access(p).then(
      () => true,
      () => false
    ),
    new Promise<boolean>((r) => setTimeout(() => r(false), ms))
  ])
}

export async function getRoots(): Promise<RootInfo[]> {
  const home = os.homedir()
  const roots: RootInfo[] = [{ path: home, label: 'Home', kind: 'home' }]
  for (const [sub, label] of [
    ['Desktop', 'Desktop'],
    ['Documents', 'Documents'],
    ['Downloads', 'Downloads'],
    ['Pictures', 'Pictures']
  ]) {
    const p = path.join(home, sub)
    if (await existsWithTimeout(p, 300)) roots.push({ path: p, label, kind: 'special' })
  }
  if (IS_WIN) {
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZAB'.split('')
    const checks = await Promise.all(letters.map((l) => existsWithTimeout(`${l}:\\`, 700)))
    letters.forEach((l, i) => {
      if (checks[i]) roots.push({ path: `${l}:\\`, label: `${l}:`, kind: 'drive' })
    })
    roots.sort((a, b) => (a.kind === 'drive' && b.kind === 'drive' ? a.path.localeCompare(b.path) : 0))
  } else {
    roots.push({ path: '/', label: process.platform === 'darwin' ? 'Macintosh HD' : 'File System', kind: 'root' })
    const user = os.userInfo().username
    const mountDirs = process.platform === 'darwin' ? ['/Volumes'] : [`/media/${user}`, `/run/media/${user}`, '/mnt', '/media']
    for (const md of mountDirs) {
      try {
        for (const d of await fsp.readdir(md, { withFileTypes: true })) {
          if (!d.isDirectory() && !d.isSymbolicLink()) continue
          const p = path.join(md, d.name)
          if (process.platform === 'darwin' && (await fsp.realpath(p).catch(() => p)) === '/') continue
          if (md === '/media' && d.name === user) continue
          roots.push({ path: p, label: d.name, kind: 'volume' })
        }
      } catch {
        // mount dir absent
      }
    }
  }
  return roots
}

// ---------------------------------------------------------------------------
// Simple operations
// ---------------------------------------------------------------------------

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.lstat(p)
    return true
  } catch {
    return false
  }
}

export async function uniqueName(dir: string, name: string): Promise<string> {
  let candidate = path.join(dir, name)
  if (!(await pathExists(candidate))) return candidate
  const ext = path.extname(name)
  const base = ext && ext !== name ? name.slice(0, -ext.length) : name
  for (let i = 2; i < 10000; i++) {
    candidate = path.join(dir, `${base} (${i})${ext}`)
    if (!(await pathExists(candidate))) return candidate
  }
  throw new Error('Unable to find a unique name')
}

/** True when both paths live on the same file system (moves there are cheap renames). */
export async function sameVolume(a: string, b: string): Promise<boolean> {
  try {
    const [x, y] = await Promise.all([fsp.stat(a), fsp.stat(b)])
    return x.dev === y.dev
  } catch {
    return false
  }
}

export async function makeDir(parent: string, name: string): Promise<string> {
  const target = path.join(parent, name)
  await fsp.mkdir(target, { recursive: false })
  return target
}

export async function createFile(parent: string, name: string): Promise<string> {
  const target = path.join(parent, name)
  const fh = await fsp.open(target, 'wx')
  await fh.close()
  return target
}

export async function renameItem(from: string, newName: string): Promise<string> {
  const to = path.join(path.dirname(from), newName)
  if (to === from) return to
  const targetExists = await pathExists(to)
  // On case-insensitive file systems "a" and "A" are the same entry; on case-sensitive ones they are distinct files.
  const caseOnly = to.toLowerCase() === from.toLowerCase() && targetExists && (await sameEntry(from, to))
  if (targetExists && !caseOnly) throw new Error(`"${newName}" already exists`)
  if (caseOnly) {
    // Two-step rename so case-only changes stick on case-insensitive file systems.
    const tmp = `${from}.~opal${Date.now()}`
    await fsp.rename(from, tmp)
    await fsp.rename(tmp, to)
  } else {
    await fsp.rename(from, to)
  }
  return to
}

export async function renameMany(pairs: { from: string; to: string }[]): Promise<{ done: { from: string; to: string }[]; errors: string[] }> {
  const errors: string[] = []
  const work = pairs.filter((p) => p.from !== p.to)
  const fold = (x: string): string => (FOLD_CASE ? x.toLowerCase() : x)
  // Validate up front: unique targets, and targets must be free unless they are being renamed away in this batch.
  const sources = new Set(work.map((p) => fold(p.from)))
  const seen = new Set<string>()
  for (const p of work) {
    const t = fold(p.to)
    if (seen.has(t)) errors.push(`${path.basename(p.to)}: duplicate target name`)
    seen.add(t)
    if (!sources.has(t) && (await pathExists(p.to)) && !(await sameEntry(p.from, p.to))) errors.push(`"${path.basename(p.to)}" already exists`)
  }
  if (errors.length) return { done: [], errors }

  // Stage through temporary names to allow swaps (a->b, b->a); roll everything back on failure.
  const staged: { tmp: string; from: string; to: string; final: boolean }[] = []
  const rollback = async (): Promise<void> => {
    for (const st of [...staged].reverse()) {
      try {
        if (st.final) await fsp.rename(st.to, st.tmp)
        await fsp.rename(st.tmp, st.from)
      } catch (e) {
        errors.push(`Rollback failed for ${path.basename(st.from)} (left as ${st.final ? st.to : st.tmp}): ${(e as Error).message}`)
      }
    }
  }
  try {
    for (const p of work) {
      const tmp = path.join(path.dirname(p.from), `.${path.basename(p.from)}.opal-${Math.random().toString(36).slice(2, 8)}.ren`)
      await fsp.rename(p.from, tmp)
      staged.push({ tmp, ...p, final: false })
    }
    for (const st of staged) {
      if (await pathExists(st.to)) throw new Error(`"${path.basename(st.to)}" already exists`)
      await fsp.rename(st.tmp, st.to)
      st.final = true
    }
  } catch (e) {
    errors.push((e as Error).message)
    await rollback()
    return { done: [], errors }
  }
  return { done: staged.map((st) => ({ from: st.from, to: st.to })), errors }
}

export async function deletePermanent(paths: string[]): Promise<string[]> {
  const errors: string[] = []
  for (const p of paths) {
    try {
      await fsp.rm(p, { recursive: true, force: false, maxRetries: 2 })
    } catch (e) {
      errors.push(`${path.basename(p)}: ${(e as Error).message}`)
    }
  }
  return errors
}

// ---------------------------------------------------------------------------
// Copy / Move with progress
// ---------------------------------------------------------------------------

interface PlanItem {
  src: string
  dest: string
  kind: 'dir' | 'file' | 'link'
  size: number
  mtime: number
}

interface TopItem {
  src: string
  dest: string
  viaRename?: boolean
  destExisted: boolean
  items: PlanItem[]
  planned: boolean
}

async function walk(src: string, dest: string, out: PlanItem[], token: CancelToken): Promise<void> {
  if (token.cancelled) throw new Error('Cancelled')
  const st = await fsp.lstat(src)
  if (st.isSymbolicLink()) {
    out.push({ src, dest, kind: 'link', size: 0, mtime: st.mtimeMs })
  } else if (st.isDirectory()) {
    out.push({ src, dest, kind: 'dir', size: 0, mtime: st.mtimeMs })
    const children = await fsp.readdir(src)
    for (const c of children) await walk(path.join(src, c), path.join(dest, c), out, token)
  } else {
    out.push({ src, dest, kind: 'file', size: st.size, mtime: st.mtimeMs })
  }
}

const FOLD_CASE = IS_WIN || process.platform === 'darwin'

function isInside(child: string, parent: string): boolean {
  const c = FOLD_CASE ? child.toLowerCase() : child
  const p = FOLD_CASE ? parent.toLowerCase() : parent
  const rel = path.relative(p, c)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Physical location of `p` (symlinks resolved), also for paths that don't exist yet. */
async function physicalPath(p: string): Promise<string> {
  const rest: string[] = []
  let cur = path.resolve(p)
  for (;;) {
    try {
      return path.join(await fsp.realpath(cur), ...rest.reverse())
    } catch {
      const up = path.dirname(cur)
      if (up === cur) return path.resolve(p)
      rest.push(path.basename(cur))
      cur = up
    }
  }
}

export async function fileId(p: string): Promise<string | undefined> {
  try {
    const st = await fsp.lstat(p, { bigint: true })
    return `${st.dev}:${st.ino}`
  } catch {
    return undefined
  }
}

async function sameEntry(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([fileId(a), fileId(b)])
  return x !== undefined && x === y && !x.endsWith(':0')
}

const STREAM_THRESHOLD = 32 * 1024 * 1024

function tempSibling(dest: string): string {
  return path.join(path.dirname(dest), `.${path.basename(dest)}.opal-${Math.random().toString(36).slice(2, 8)}.part`)
}

/** Copies to a temporary sibling first, so an existing destination is only replaced after a complete copy. */
async function copyOneFile(item: PlanItem, onBytes: (n: number) => void, token: CancelToken): Promise<void> {
  const tmp = tempSibling(item.dest)
  try {
    if (item.size < STREAM_THRESHOLD) {
      await fsp.copyFile(item.src, tmp, fsConstants.COPYFILE_EXCL)
      onBytes(item.size)
    } else {
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          if (token.cancelled) return cb(new Error('Cancelled'))
          onBytes(chunk.length)
          cb(null, chunk)
        }
      })
      await pipeline(createReadStream(item.src), counter, createWriteStream(tmp, { flags: 'wx' }))
    }
    const t = new Date(item.mtime)
    await fsp.utimes(tmp, t, t).catch(() => undefined)
    await fsp.rename(tmp, item.dest)
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined)
    throw e
  }
}

async function copyLink(item: PlanItem): Promise<void> {
  const target = await fsp.readlink(item.src)
  let type: 'file' | 'dir' | 'junction' | undefined
  if (IS_WIN) type = await fsp.stat(item.src).then((s) => (s.isDirectory() ? 'junction' : 'file'), () => 'file' as const)
  await fsp.symlink(target, item.dest, type)
}

export interface TransferResult {
  progress: JobProgress
  undo?: UndoEntry
}

export async function transfer(
  req: TransferRequest,
  jobId: string,
  onProgress: (p: JobProgress) => void,
  token: CancelToken = { cancelled: false }
): Promise<TransferResult> {
  const progress: JobProgress = {
    jobId,
    op: req.op,
    currentFile: '',
    doneBytes: 0,
    totalBytes: 0,
    doneFiles: 0,
    totalFiles: 0,
    finished: false,
    errors: []
  }
  let lastEmit = 0
  const emit = (force = false): void => {
    const now = Date.now()
    if (force || now - lastEmit > 100) {
      lastEmit = now
      onProgress({ ...progress, errors: [...progress.errors] })
    }
  }

  const destDir = path.resolve(req.destDir)
  if (req.ensureDestDir) await fsp.mkdir(destDir, { recursive: true })
  const physDest = await physicalPath(destDir)
  const tops: TopItem[] = []
  for (const s of req.sources) {
    const src = path.resolve(s)
    let srcStat
    try {
      srcStat = await fsp.lstat(src)
    } catch (e) {
      progress.errors.push(`${path.basename(src)}: ${(e as Error).message}`)
      continue
    }
    if (srcStat.isDirectory() && isInside(physDest, await physicalPath(src))) {
      progress.errors.push(`Cannot ${req.op} "${path.basename(src)}" into itself`)
      continue
    }
    const targetName = req.renames?.[s] ?? req.renames?.[src] ?? path.basename(src)
    let dest = path.join(destDir, targetName)
    if (dest === src || (await sameEntry(src, dest))) {
      if (req.op === 'move') continue
      dest = await uniqueName(destDir, targetName)
    } else if (req.conflict === 'rename' && (await pathExists(dest))) {
      dest = await uniqueName(destDir, targetName)
    }
    tops.push({ src, dest, destExisted: await pathExists(dest), items: [], planned: false })
  }

  const undoCreated: string[] = []
  const undoPairs: { from: string; to: string }[] = []

  // Fast path for moves on the same volume: a single rename when the target doesn't exist.
  if (req.op === 'move') {
    for (const t of tops) {
      if (token.cancelled) break
      if (t.destExisted || req.onlyExisting) continue
      try {
        await fsp.rename(t.src, t.dest)
        t.viaRename = true
        undoPairs.push({ from: t.src, to: t.dest })
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EACCES') {
          progress.errors.push(`${path.basename(t.src)}: ${(e as Error).message}`)
          t.viaRename = true
        }
      }
    }
  }

  const pending = tops.filter((t) => !t.viaRename)
  for (const t of pending) {
    try {
      await walk(t.src, t.dest, t.items, token)
      t.planned = true
    } catch (e) {
      // Never transfer (or delete) a partially planned source.
      t.items = []
      if (!token.cancelled) progress.errors.push(`${path.basename(t.src)}: ${(e as Error).message}`)
    }
  }
  const plan = pending.flatMap((t) => t.items)
  progress.totalFiles = plan.filter((p) => p.kind !== 'dir').length + undoPairs.length
  progress.doneFiles = undoPairs.length
  progress.totalBytes = plan.reduce((a, p) => a + p.size, 0)
  emit(true)

  const skippedSources = new Set<string>()
  for (const t of pending) {
    for (const item of t.items) {
      if (token.cancelled) break
      progress.currentFile = item.src
      emit()
      try {
        if (item.kind === 'dir') {
          if (req.onlyExisting && !(await pathExists(item.dest))) {
            skippedSources.add(item.src)
            continue
          }
          await fsp.mkdir(item.dest, { recursive: true })
          continue
        }
        const exists = await pathExists(item.dest)
        if (!exists && req.onlyExisting) {
          skippedSources.add(item.src)
          progress.doneFiles++
          progress.doneBytes += item.size
          continue
        }
        if (exists) {
          const policy: ConflictPolicy = req.conflict
          let replace = false
          if (policy === 'overwrite') replace = true
          else if (policy === 'newer') {
            const dst = await fsp.stat(item.dest).catch(() => null)
            replace = !!dst && item.mtime > dst.mtimeMs + 1000
          }
          if (!replace) {
            skippedSources.add(item.src)
            progress.doneFiles++
            progress.doneBytes += item.size
            continue
          }
          await fsp.chmod(item.dest, 0o666).catch(() => undefined)
          if (item.kind === 'link') await fsp.unlink(item.dest)
        } else if (t.destExisted) {
          // Merging into an existing folder: journal each newly created item for undo.
          if (req.op === 'copy') undoCreated.push(item.dest)
          else undoPairs.push({ from: item.src, to: item.dest })
        }
        if (item.kind === 'link') await copyLink(item)
        else
          await copyOneFile(
            item,
            (n) => {
              progress.doneBytes += n
              emit()
            },
            token
          )
        progress.doneFiles++
      } catch (e) {
        skippedSources.add(item.src)
        if (!token.cancelled) progress.errors.push(`${path.basename(item.src)}: ${(e as Error).message}`)
      }
    }
    if (!t.destExisted && t.planned && req.op === 'copy' && (await pathExists(t.dest))) undoCreated.push(t.dest)
  }

  if (req.op === 'move' && !token.cancelled) {
    // Remove only sources that were fully planned and fully transferred.
    for (const t of pending) {
      if (!t.planned) continue
      const hasSkip = [...skippedSources].some((s) => isInside(s, t.src))
      if (hasSkip) continue
      try {
        await fsp.rm(t.src, { recursive: true, force: true })
        if (!t.destExisted) undoPairs.push({ from: t.src, to: t.dest })
      } catch (e) {
        progress.errors.push(`${path.basename(t.src)}: ${(e as Error).message}`)
      }
    }
  }

  progress.finished = true
  progress.cancelled = token.cancelled
  progress.currentFile = ''
  emit(true)

  let undo: UndoEntry | undefined
  if (req.op === 'copy' && undoCreated.length) undo = { type: 'copy', created: undoCreated }
  if (req.op === 'move' && undoPairs.length) undo = { type: 'move', pairs: undoPairs }
  return { progress, undo }
}

// ---------------------------------------------------------------------------
// Sizes, find, preview, attributes, sync
// ---------------------------------------------------------------------------

export interface SizeResult {
  bytes: number
  files: number
  dirs: number
}

export async function folderSize(dir: string, token: CancelToken = { cancelled: false }): Promise<SizeResult> {
  const result: SizeResult = { bytes: 0, files: 0, dirs: 0 }
  const stack = [dir]
  while (stack.length && !token.cancelled) {
    const cur = stack.pop()!
    let dirents
    try {
      dirents = await fsp.readdir(cur, { withFileTypes: true })
    } catch {
      continue
    }
    await Promise.all(
      dirents.map(async (d) => {
        const full = path.join(cur, d.name)
        if (d.isDirectory()) {
          result.dirs++
          stack.push(full)
        } else if (!d.isSymbolicLink()) {
          try {
            result.bytes += (await fsp.stat(full)).size
            result.files++
          } catch {
            // unreadable
          }
        }
      })
    )
  }
  return result
}

async function fileContains(file: string, needle: string, token: CancelToken): Promise<boolean> {
  const lower = needle.toLowerCase()
  let carry = ''
  for await (const chunk of createReadStream(file, { encoding: 'utf8', highWaterMark: 256 * 1024 })) {
    if (token.cancelled) return false
    const text = carry + (chunk as string).toLowerCase()
    if (text.includes(lower)) return true
    carry = text.slice(-lower.length)
  }
  return false
}

export async function find(
  opts: FindOptions,
  onResult: (entries: FileEntry[]) => void,
  token: CancelToken = { cancelled: false }
): Promise<number> {
  const match = compilePattern(opts.pattern || '*')
  const limit = opts.limit ?? 5000
  let count = 0
  const queue = [path.resolve(opts.root)]
  while (queue.length && !token.cancelled && count < limit) {
    const dir = queue.shift()!
    let dirents
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    const batch: FileEntry[] = []
    for (const d of dirents) {
      if (token.cancelled || count + batch.length >= limit) break
      const full = path.join(dir, d.name)
      const isDir = d.isDirectory()
      if (isDir && opts.recursive) queue.push(full)
      if (isDir && !opts.includeDirs) continue
      if (!match(d.name)) continue
      try {
        const e = await statEntry(full)
        if (opts.minSize !== undefined && (e.isDir || e.size < opts.minSize)) continue
        if (opts.maxSize !== undefined && (e.isDir || e.size > opts.maxSize)) continue
        if (opts.modifiedAfter !== undefined && e.mtime < opts.modifiedAfter) continue
        if (opts.modifiedBefore !== undefined && e.mtime > opts.modifiedBefore) continue
        if (opts.contains) {
          if (e.isDir || e.size > 64 * 1024 * 1024) continue
          if (!(await fileContains(full, opts.contains, token))) continue
        }
        batch.push(e)
      } catch {
        // skip unreadable
      }
    }
    if (batch.length) {
      count += batch.length
      onResult(batch)
    }
  }
  return count
}

const TEXT_PREVIEW_BYTES = 256 * 1024

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

export async function readPreview(p: string): Promise<Preview> {
  try {
    const st = await fsp.stat(p)
    if (st.isDirectory()) return { kind: 'dir', path: p, size: 0 }
    const kind = previewKindForExt(path.extname(p).slice(1))
    if (kind !== 'text' && kind !== 'binary') return { kind, path: p, size: st.size }
    const fh = await fsp.open(p, 'r')
    try {
      const len = Math.min(st.size, TEXT_PREVIEW_BYTES)
      const buf = Buffer.alloc(len)
      await fh.read(buf, 0, len, 0)
      if (kind === 'binary' && looksBinary(buf)) return { kind: 'binary', path: p, size: st.size }
      let text: string
      if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.subarray(2).toString('utf16le')
      else text = buf.toString('utf8').replace(/^\uFEFF/, '')
      return { kind: 'text', path: p, text, truncated: st.size > len, size: st.size }
    } finally {
      await fh.close()
    }
  } catch (e) {
    return { kind: 'error', path: p, message: (e as Error).message }
  }
}

export async function setAttributes(p: string, attrs: { readonly?: boolean; mtime?: number }): Promise<void> {
  if (attrs.readonly !== undefined) {
    const st = await fsp.stat(p)
    const mode = attrs.readonly ? st.mode & ~0o222 : st.mode | 0o200
    await fsp.chmod(p, mode)
  }
  if (attrs.mtime !== undefined) {
    const st = await fsp.stat(p)
    await fsp.utimes(p, st.atime, new Date(attrs.mtime))
  }
}

async function snapshot(root: string, recursive: boolean): Promise<Map<string, { rel: string; isDir: boolean; size: number; mtime: number }>> {
  const map = new Map<string, { rel: string; isDir: boolean; size: number; mtime: number }>()
  const stack = ['']
  while (stack.length) {
    const rel = stack.pop()!
    let dirents
    try {
      dirents = await fsp.readdir(path.join(root, rel), { withFileTypes: true })
    } catch {
      continue
    }
    for (const d of dirents) {
      const r = rel ? path.join(rel, d.name) : d.name
      try {
        const st = await fsp.lstat(path.join(root, r))
        map.set(IS_WIN ? r.toLowerCase() : r, { rel: r, isDir: st.isDirectory(), size: st.size, mtime: st.mtimeMs })
        if (st.isDirectory() && recursive) stack.push(r)
      } catch {
        // skip
      }
    }
  }
  return map
}

export async function compareFolders(left: string, right: string, recursive: boolean): Promise<SyncItem[]> {
  const [l, r] = await Promise.all([snapshot(left, recursive), snapshot(right, recursive)])
  const keys = new Set([...l.keys(), ...r.keys()])
  const items: SyncItem[] = []
  for (const k of [...keys].sort()) {
    const a = l.get(k)
    const b = r.get(k)
    let status: SyncItem['status']
    if (a && !b) status = 'leftOnly'
    else if (!a && b) status = 'rightOnly'
    else if (a!.isDir || b!.isDir) status = 'same'
    else if (Math.abs(a!.mtime - b!.mtime) > 2000) status = a!.mtime > b!.mtime ? 'leftNewer' : 'rightNewer'
    else if (a!.size !== b!.size) status = 'sizeDiffers'
    else status = 'same'
    items.push({
      rel: (a ?? b)!.rel,
      isDir: (a ?? b)!.isDir,
      status,
      leftSize: a?.size,
      rightSize: b?.size,
      leftMtime: a?.mtime,
      rightMtime: b?.mtime
    })
  }
  return items
}

export async function splitFile(file: string, destDir: string, chunkBytes: number): Promise<string[]> {
  if (chunkBytes <= 0) throw new Error('Invalid chunk size')
  const st = await fsp.stat(file)
  const parts: string[] = []
  const fh = await fsp.open(file, 'r')
  try {
    let offset = 0
    let n = 1
    while (offset < st.size) {
      const len = Math.min(chunkBytes, st.size - offset)
      const buf = Buffer.alloc(len)
      await fh.read(buf, 0, len, offset)
      const out = path.join(destDir, `${path.basename(file)}.${String(n).padStart(3, '0')}`)
      await fsp.writeFile(out, buf, { flag: 'wx' })
      parts.push(out)
      offset += len
      n++
    }
  } finally {
    await fh.close()
  }
  return parts
}

export async function joinFiles(parts: string[], target: string): Promise<void> {
  const out = await fsp.open(target, 'wx')
  try {
    for (const p of parts) await out.write(await fsp.readFile(p))
  } finally {
    await out.close()
  }
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

export class UndoManager {
  private stack: { entry: UndoEntry; ids: (string | undefined)[] }[] = []
  constructor(private readonly trash: (p: string) => Promise<void> = (p) => fsp.rm(p, { recursive: true, force: true })) {}

  private static targets(entry: UndoEntry): string[] {
    return entry.type === 'rename' || entry.type === 'move' ? entry.pairs.map((p) => p.to) : entry.created
  }

  /** Records an operation together with the identity of what it produced, so undo never touches a different file. */
  async push(entry: UndoEntry): Promise<void> {
    const ids = await Promise.all(UndoManager.targets(entry).map(fileId))
    this.stack.push({ entry, ids })
    if (this.stack.length > 50) this.stack.shift()
  }

  peekLabel(): string {
    const top = this.stack[this.stack.length - 1]?.entry
    if (!top) return ''
    const n = top.type === 'rename' || top.type === 'move' ? top.pairs.length : top.created.length
    const verb = { rename: 'Rename', move: 'Move', copy: 'Copy', create: 'New' }[top.type]
    return `${verb} (${n} item${n === 1 ? '' : 's'})`
  }

  get size(): number {
    return this.stack.length
  }

  async undo(): Promise<string[]> {
    const rec = this.stack.pop()
    if (!rec) return []
    const { entry: top, ids } = rec
    const errors: string[] = []
    const unchanged = async (p: string, i: number): Promise<boolean> => {
      const now = await fileId(p)
      if (ids[i] !== undefined && now !== ids[i]) {
        errors.push(`${path.basename(p)}: changed since the operation, not undone`)
        return false
      }
      return true
    }
    switch (top.type) {
      case 'rename':
      case 'move': {
        const indexed = top.pairs.map((p, i) => ({ ...p, i })).reverse()
        for (const { from, to, i } of indexed) {
          try {
            if (!(await unchanged(to, i))) continue
            if (await pathExists(from)) throw new Error(`"${path.basename(from)}" already exists`)
            await fsp.mkdir(path.dirname(from), { recursive: true })
            try {
              await fsp.rename(to, from)
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
              await fsp.cp(to, from, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true })
              await fsp.rm(to, { recursive: true, force: true })
            }
          } catch (e) {
            errors.push(`${path.basename(to)}: ${(e as Error).message}`)
          }
        }
        break
      }
      case 'copy':
      case 'create':
        for (let i = 0; i < top.created.length; i++) {
          const p = top.created[i]
          try {
            if (!(await pathExists(p)) || !(await unchanged(p, i))) continue
            await this.trash(p)
          } catch (e) {
            errors.push(`${path.basename(p)}: ${(e as Error).message}`)
          }
        }
        break
    }
    return errors
  }
}

// ---------------------------------------------------------------------------
// Flat view, duplicates, checksums
// ---------------------------------------------------------------------------

/** Recursively list all files below `dir`; names are relative paths (Flat View without folders). */
export async function listFlat(dir: string, limit = 20000, token: CancelToken = { cancelled: false }): Promise<DirListing> {
  const resolved = path.resolve(dir)
  const entries: FileEntry[] = []
  const queue = [resolved]
  while (queue.length && entries.length < limit && !token.cancelled) {
    const cur = queue.shift()!
    let dirents
    try {
      dirents = await fsp.readdir(cur, { withFileTypes: true })
    } catch {
      continue
    }
    const hiddenSet = await winHiddenNames(cur)
    const files: string[] = []
    for (const d of dirents) {
      const full = path.join(cur, d.name)
      if (d.isDirectory()) queue.push(full)
      else files.push(full)
    }
    const stats = await Promise.all(files.map((f) => statEntry(f, hiddenSet).catch(() => null)))
    for (const e of stats) {
      if (!e || entries.length >= limit) continue
      e.name = path.relative(resolved, e.path)
      entries.push(e)
    }
  }
  const parent = path.dirname(resolved)
  return { path: resolved, parent: parent === resolved ? null : parent, entries }
}

export async function hashFile(file: string, algo: 'md5' | 'sha1' | 'sha256' = 'sha256', maxBytes?: number): Promise<string> {
  const h = createHash(algo)
  const stream = createReadStream(file, maxBytes !== undefined ? { start: 0, end: Math.max(0, maxBytes - 1) } : {})
  for await (const chunk of stream) h.update(chunk as Buffer)
  return h.digest('hex')
}

export interface DuplicateGroup {
  size: number
  hash: string
  paths: string[]
}

export async function findDuplicates(
  root: string,
  opts: { minSize?: number; recursive?: boolean } = {},
  token: CancelToken = { cancelled: false }
): Promise<DuplicateGroup[]> {
  const minSize = opts.minSize ?? 1
  const bySize = new Map<number, string[]>()
  const queue = [path.resolve(root)]
  while (queue.length && !token.cancelled) {
    const cur = queue.shift()!
    let dirents
    try {
      dirents = await fsp.readdir(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const d of dirents) {
      const full = path.join(cur, d.name)
      if (d.isDirectory()) {
        if (opts.recursive !== false) queue.push(full)
      } else if (d.isFile()) {
        try {
          const st = await fsp.stat(full)
          if (st.size < minSize) continue
          const arr = bySize.get(st.size) ?? []
          arr.push(full)
          bySize.set(st.size, arr)
        } catch {
          // skip
        }
      }
    }
  }
  const groups: DuplicateGroup[] = []
  for (const [size, paths] of bySize) {
    if (token.cancelled) break
    if (paths.length < 2) continue
    // Cheap pre-filter on the first 64 KB, then a full hash for candidates.
    const byQuick = new Map<string, string[]>()
    for (const p of paths) {
      try {
        const q = await hashFile(p, 'sha1', 64 * 1024)
        byQuick.set(q, [...(byQuick.get(q) ?? []), p])
      } catch {
        // unreadable
      }
    }
    for (const cands of byQuick.values()) {
      if (cands.length < 2) continue
      const byFull = new Map<string, string[]>()
      for (const p of cands) {
        try {
          const f = await hashFile(p, 'sha256')
          byFull.set(f, [...(byFull.get(f) ?? []), p])
        } catch {
          // unreadable
        }
      }
      for (const [hash, ps] of byFull) if (ps.length > 1) groups.push({ size, hash, paths: ps.sort() })
    }
  }
  return groups.sort((a, b) => b.size * (b.paths.length - 1) - a.size * (a.paths.length - 1))
}

// ---------------------------------------------------------------------------
// Lazy column metadata: image dimensions and folder item counts
// ---------------------------------------------------------------------------

/** Reads pixel dimensions from PNG, JPEG, GIF, BMP and WebP headers without decoding the image. */
export function imageSizeFromHeader(buf: Buffer): { width: number; height: number } | null {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
  if (buf.length >= 26 && buf.toString('ascii', 0, 2) === 'BM') return { width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) }
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fmt = buf.toString('ascii', 12, 16)
    if (fmt === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
    if (fmt === 'VP8L') {
      const b = buf.readUInt32LE(21)
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
    }
    if (fmt === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++
        continue
      }
      const marker = buf[i + 1]
      const len = buf.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) }
      i += 2 + len
    }
  }
  return null
}

const IMAGE_META_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'])

export async function itemMeta(paths: string[]): Promise<Record<string, { width?: number; height?: number; items?: number }>> {
  const out: Record<string, { width?: number; height?: number; items?: number }> = {}
  await Promise.all(
    paths.slice(0, 500).map(async (p) => {
      try {
        const st = await fsp.stat(p)
        if (st.isDirectory()) {
          out[p] = { items: (await fsp.readdir(p)).length }
          return
        }
        if (!IMAGE_META_EXT.has(path.extname(p).toLowerCase())) {
          out[p] = {}
          return
        }
        const fh = await fsp.open(p, 'r')
        try {
          const buf = Buffer.alloc(Math.min(st.size, 256 * 1024))
          await fh.read(buf, 0, buf.length, 0)
          out[p] = imageSizeFromHeader(buf) ?? {}
        } finally {
          await fh.close()
        }
      } catch {
        out[p] = {}
      }
    })
  )
  return out
}
