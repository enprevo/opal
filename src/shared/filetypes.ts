import type { FileEntry } from './types'

const TYPES: Record<string, string> = {
  txt: 'Text Document',
  md: 'Markdown Document',
  log: 'Log File',
  json: 'JSON File',
  xml: 'XML File',
  yml: 'YAML File',
  yaml: 'YAML File',
  ini: 'Configuration Settings',
  csv: 'CSV File',
  pdf: 'PDF Document',
  doc: 'Word Document',
  docx: 'Word Document',
  xls: 'Excel Worksheet',
  xlsx: 'Excel Worksheet',
  ppt: 'PowerPoint Presentation',
  pptx: 'PowerPoint Presentation',
  jpg: 'JPEG Image',
  jpeg: 'JPEG Image',
  png: 'PNG Image',
  gif: 'GIF Image',
  bmp: 'Bitmap Image',
  webp: 'WebP Image',
  svg: 'SVG Image',
  ico: 'Icon',
  tif: 'TIFF Image',
  tiff: 'TIFF Image',
  avif: 'AVIF Image',
  mp3: 'MP3 Audio',
  wav: 'Wave Audio',
  flac: 'FLAC Audio',
  ogg: 'Ogg Audio',
  m4a: 'MPEG-4 Audio',
  mp4: 'MPEG-4 Video',
  mkv: 'Matroska Video',
  mov: 'QuickTime Video',
  avi: 'AVI Video',
  webm: 'WebM Video',
  zip: 'ZIP Archive',
  '7z': '7-Zip Archive',
  rar: 'RAR Archive',
  tar: 'TAR Archive',
  gz: 'GZip Archive',
  exe: 'Application',
  msi: 'Windows Installer',
  dll: 'Application Extension',
  app: 'Application',
  dmg: 'Disk Image',
  iso: 'Disk Image',
  sh: 'Shell Script',
  bat: 'Batch File',
  cmd: 'Command Script',
  ps1: 'PowerShell Script',
  js: 'JavaScript File',
  mjs: 'JavaScript File',
  ts: 'TypeScript File',
  tsx: 'TypeScript JSX File',
  jsx: 'JavaScript JSX File',
  py: 'Python File',
  c: 'C Source',
  h: 'C Header',
  cpp: 'C++ Source',
  hpp: 'C++ Header',
  cs: 'C# Source',
  java: 'Java Source',
  go: 'Go Source',
  rs: 'Rust Source',
  html: 'HTML Document',
  htm: 'HTML Document',
  css: 'Stylesheet',
  lnk: 'Shortcut',
  url: 'Internet Shortcut'
}

export const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'log', 'json', 'xml', 'yml', 'yaml', 'ini', 'cfg', 'conf', 'csv', 'tsv', 'sh', 'bat', 'cmd', 'ps1',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'java', 'go', 'rs', 'html', 'htm',
  'css', 'scss', 'less', 'sql', 'toml', 'env', 'gitignore', 'editorconfig', 'svg', 'rb', 'php', 'kt', 'swift', 'lua',
  'vue', 'svelte', 'properties', 'gradle', 'cmake', 'makefile', 'dockerfile', 'tex', 'rst', 'srt', 'nfo', 'diff', 'patch'
])
export const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'avif'])
export const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'mkv', 'ogv', 'm4v'])
export const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus'])

export function fileTypeLabel(e: Pick<FileEntry, 'isDir' | 'ext'>): string {
  if (e.isDir) return 'File folder'
  if (!e.ext) return 'File'
  return TYPES[e.ext.toLowerCase()] ?? `${e.ext.toUpperCase()} File`
}

export type PreviewKind = 'text' | 'image' | 'video' | 'audio' | 'pdf' | 'binary'

export function previewKindForExt(ext: string): PreviewKind {
  const e = ext.toLowerCase()
  if (IMAGE_EXTENSIONS.has(e)) return 'image'
  if (VIDEO_EXTENSIONS.has(e)) return 'video'
  if (AUDIO_EXTENSIONS.has(e)) return 'audio'
  if (e === 'pdf') return 'pdf'
  if (TEXT_EXTENSIONS.has(e)) return 'text'
  return 'binary'
}

const ARCHIVES = new Set(['zip', '7z', 'rar', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'iso', 'dmg'])
const DOCS = new Set(['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp', 'pages', 'numbers', 'key', 'epub'])
const CODE = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'c', 'h', 'cpp', 'hpp', 'cs', 'java', 'go', 'rs', 'rb', 'php', 'kt', 'swift', 'lua', 'sh', 'ps1', 'bat', 'cmd', 'html', 'htm', 'css', 'scss', 'json', 'xml', 'yml', 'yaml', 'toml', 'sql', 'vue', 'svelte'])
const APPS = new Set(['exe', 'msi', 'app', 'apk', 'deb', 'rpm', 'appimage', 'dll', 'so', 'dylib'])

/** Finder-style "Kind" bucket used for grouping and Quick Look. */
export function kindOf(e: Pick<FileEntry, 'isDir' | 'ext'>): { key: string; label: string; order: number } {
  if (e.isDir) return { key: 'folder', label: 'Folders', order: 0 }
  const x = e.ext.toLowerCase()
  if (IMAGE_EXTENSIONS.has(x)) return { key: 'image', label: 'Images', order: 1 }
  if (VIDEO_EXTENSIONS.has(x)) return { key: 'video', label: 'Movies', order: 2 }
  if (AUDIO_EXTENSIONS.has(x)) return { key: 'audio', label: 'Music', order: 3 }
  if (DOCS.has(x)) return { key: 'doc', label: 'Documents', order: 4 }
  if (CODE.has(x)) return { key: 'code', label: 'Code', order: 5 }
  if (ARCHIVES.has(x)) return { key: 'archive', label: 'Archives', order: 6 }
  if (APPS.has(x)) return { key: 'app', label: 'Applications', order: 7 }
  return { key: 'other', label: 'Other', order: 8 }
}
