import { promises as fsp } from 'node:fs'
import * as path from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { TEXT_EXTENSIONS } from '../../shared/filetypes'

/** Extensions whose text Opal can extract for semantic indexing. */
export const OFFICE_EXTENSIONS = new Set(['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods'])
/** Documents written for people: indexed by default. */
export const DOCUMENT_EXTENSIONS = new Set([
  ...OFFICE_EXTENSIONS, 'pdf', 'txt', 'md', 'markdown', 'rst', 'tex', 'org', 'adoc', 'html', 'htm', 'rtf', 'epub', 'eml'
])
/** Machine-oriented text (code, data, logs, configuration): indexed only when the user opts in. */
const NON_CODE = new Set(['log', 'csv', 'tsv', 'json', 'xml', 'yml', 'yaml', 'ini', 'cfg', 'conf', 'toml', 'env', 'properties', 'svg', 'srt', 'diff', 'patch', 'gitignore', 'editorconfig'])
export const CODE_EXTENSIONS = new Set([...TEXT_EXTENSIONS].filter((e) => !NON_CODE.has(e) && !DOCUMENT_EXTENSIONS.has(e)))
export const MAX_INDEX_BYTES = 40 * 1024 * 1024
const MAX_TEXT_BYTES = 2 * 1024 * 1024
/** Plain-text "documents" larger than this are almost always logs or data dumps. */
const MAX_PLAIN_DOC_BYTES = 1024 * 1024
/** Boilerplate shipped with software: never what the user is looking for. */
const BOILERPLATE = /^(licen[cs]e|copying|notice|third[-_ ]party[-_ ]notices?|changelog|changes|history|authors|contributors|patents|code_of_conduct)(\.|$)/i

export interface IndexableOptions {
  includeCode?: boolean
}

export function isIndexable(name: string, size = 0, opts: IndexableOptions = {}): boolean {
  if (BOILERPLATE.test(name) || /\.min\.[a-z]+$/i.test(name)) return false
  const ext = path.extname(name).slice(1).toLowerCase()
  if (DOCUMENT_EXTENSIONS.has(ext)) return !(['txt', 'md', 'html', 'htm'].includes(ext) && size > MAX_PLAIN_DOC_BYTES) && size <= MAX_INDEX_BYTES
  return !!opts.includeCode && CODE_EXTENSIONS.has(ext) && size <= MAX_PLAIN_DOC_BYTES
}

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  size: number
  localOffset: number
}

/** Minimal ZIP central-directory reader (stored + deflate), enough for OOXML/ODF documents. */
export function readZipEntries(buf: Buffer): ZipEntry[] {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a zip file')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const entries: ZipEntry[] = []
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const compressedSize = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    entries.push({ name: buf.toString('utf8', p + 46, p + 46 + nameLen), method, compressedSize, size, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

export function readZipEntry(buf: Buffer, e: ZipEntry): Buffer {
  const p = e.localOffset
  const nameLen = buf.readUInt16LE(p + 26)
  const extraLen = buf.readUInt16LE(p + 28)
  const start = p + 30 + nameLen + extraLen
  const data = buf.subarray(start, start + e.compressedSize)
  if (e.method === 0) return data
  if (e.method === 8) return inflateRawSync(data)
  throw new Error(`Unsupported zip method ${e.method}`)
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head|nav|svg)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|li|h\d|tr|br|section|article|blockquote|pre)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
}

/** Plain text of an RTF document: drops control words, groups such as font tables, and hex escapes. */
export function rtfToText(rtf: string): string {
  return rtf
    .replace(/\{\\\*[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '')
    .replace(/\{\\(fonttbl|colortbl|stylesheet|info|pict)[\s\S]*?\}\s*(?=\\|\{|\w)/g, '')
    .replace(/\\'([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, n: string) => String.fromCharCode((Number(n) + 65536) % 65536))
    .replace(/\\(par|line|row|cell)\b ?/g, '\n')
    .replace(/\\tab\b ?/g, '\t')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
}

/** Subject, sender and plain-text body of an .eml message (no attachments). */
export function emlToText(raw: string): string {
  const split = raw.search(/\r?\n\r?\n/)
  const head = split === -1 ? raw : raw.slice(0, split)
  let body = split === -1 ? '' : raw.slice(split)
  const header = (name: string): string => head.match(new RegExp(`^${name}:\\s*(.*)$`, 'im'))?.[1] ?? ''
  if (/^content-transfer-encoding:\s*quoted-printable/im.test(raw))
    body = body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
  if (/<html/i.test(body)) body = htmlToText(body)
  return `${header('Subject')}\nFrom: ${header('From')}\nTo: ${header('To')}\nDate: ${header('Date')}\n\n${body}`
}

function xmlToText(xml: string): string {
  return xml
    .replace(/<\/(w:p|a:p|text:p|text:h|row)>/g, '\n')
    .replace(/<(w:tab|text:tab)\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export function extractOfficeText(buf: Buffer, ext: string): string {
  const entries = readZipEntries(buf)
  const pick = (re: RegExp): ZipEntry[] => entries.filter((e) => re.test(e.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  let parts: ZipEntry[]
  if (ext === 'docx') parts = pick(/^word\/(document|footnotes|endnotes)\.xml$/)
  else if (ext === 'pptx') parts = pick(/^ppt\/slides\/slide\d+\.xml$/)
  else if (ext === 'xlsx') parts = pick(/^xl\/sharedStrings\.xml$/)
  else if (ext === 'epub') return pick(/\.x?html?$/i).map((e) => htmlToText(readZipEntry(buf, e).toString('utf8'))).join('\n\n')
  else parts = pick(/^content\.xml$/)
  return parts.map((e) => xmlToText(readZipEntry(buf, e).toString('utf8'))).join('\n\n')
}

async function extractPdfText(buf: Buffer): Promise<string> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as typeof import('pdfjs-dist')
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true, verbosity: 0 })
  try {
    const doc = await task.promise
    const pages: string[] = []
    for (let i = 1; i <= Math.min(doc.numPages, 300); i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      pages.push(content.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : '')).join(''))
    }
    // Form feeds mark page breaks so results can say which page matched.
    return pages.join('\n\f')
  } finally {
    await task.destroy()
  }
}

export async function extractText(file: string): Promise<string> {
  const ext = path.extname(file).slice(1).toLowerCase()
  const st = await fsp.stat(file)
  if (st.size > MAX_INDEX_BYTES) return ''
  if (OFFICE_EXTENSIONS.has(ext) || ext === 'epub') return extractOfficeText(await fsp.readFile(file), ext)
  if (ext === 'pdf') return extractPdfText(await fsp.readFile(file))
  const fh = await fsp.open(file, 'r')
  try {
    const len = Math.min(st.size, MAX_TEXT_BYTES)
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, 0)
    if (buf.subarray(0, 8000).includes(0) && !(buf[0] === 0xff && buf[1] === 0xfe)) return ''
    const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString('utf16le') : buf.toString('utf8').replace(/^\uFEFF/, '')
    if (ext === 'html' || ext === 'htm') return htmlToText(text)
    if (ext === 'rtf') return rtfToText(text)
    if (ext === 'eml') return emlToText(text)
    return text
  } finally {
    await fh.close()
  }
}

/** Lists the members of a .zip (or OOXML/ODF) archive for Quick Look. Reads only the central directory. */
export async function listZip(file: string): Promise<{ name: string; size: number }[]> {
  const fh = await fsp.open(file, 'r')
  try {
    const st = await fh.stat()
    const tail = Math.min(st.size, 65_557 + 22)
    const tailBuf = Buffer.alloc(tail)
    await fh.read(tailBuf, 0, tail, st.size - tail)
    let eocd = -1
    for (let i = tailBuf.length - 22; i >= 0; i--) {
      if (tailBuf.readUInt32LE(i) === 0x06054b50) {
        eocd = i
        break
      }
    }
    if (eocd < 0) throw new Error('Not a zip archive')
    const cdSize = tailBuf.readUInt32LE(eocd + 12)
    const cdOffset = tailBuf.readUInt32LE(eocd + 16)
    const cd = Buffer.alloc(Math.min(cdSize, 32 * 1024 * 1024))
    await fh.read(cd, 0, cd.length, cdOffset)
    const out: { name: string; size: number }[] = []
    let p = 0
    while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50 && out.length < 5000) {
      const nameLen = cd.readUInt16LE(p + 28)
      out.push({ name: cd.toString('utf8', p + 46, p + 46 + nameLen), size: cd.readUInt32LE(p + 24) })
      p += 46 + nameLen + cd.readUInt16LE(p + 30) + cd.readUInt16LE(p + 32)
    }
    return out
  } finally {
    await fh.close()
  }
}
