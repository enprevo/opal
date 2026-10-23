import { useEffect, useMemo, useState } from 'react'
import { Marked } from 'marked'
import { highlightBlock, highlightLines, languageFor, languageName } from '../highlight'
import { X, Maximize2, Minimize2, ExternalLink, FolderSearch, ChevronLeft, ChevronRight, FileArchive } from 'lucide-react'
import { activeTab, findVisible, getState, setState, useStore, visibleEntries } from '../state/store'
import * as A from '../state/actions'
import type { FileEntry, Preview } from '@shared/types'
import { formatDate, formatSize } from '@shared/format'
import { fileTypeLabel, previewKindForExt } from '@shared/filetypes'
import { FileIcon, fileUrl } from './FileIcon'

const MARKDOWN = new Set(['md', 'markdown', 'mdx'])

/** Markdown renderer with syntax-coloured code blocks. */
const markdownRenderer = new Marked({
  gfm: true,
  async: false,
  renderer: {
    code({ text, lang }) {
      const l = (lang ?? '').trim().split(/\s+/)[0].toLowerCase()
      return `<pre class="ql-md-code"><code class="hljs">${highlightBlock(text, l || undefined)}</code></pre>\n`
    }
  }
})
const ZIPLIKE = new Set(['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'jar', 'apk', 'epub'])

/** Removes scripts, event handlers and javascript: URLs from rendered Markdown. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,iframe,object,embed,style,link,meta,form').forEach((n) => n.remove())
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || ((name === 'href' || name === 'src') && /^\s*(javascript|data|vbscript):/i.test(attr.value))) el.removeAttribute(attr.name)
    }
  })
  return doc.body.innerHTML
}

/**
 * Quick Look: Space opens a large preview of the focused item, like macOS Finder.
 * ↑/↓/←/→ move through the file list while it stays open; Space or Esc closes it.
 */
export function QuickLook() {
  const open = useStore((s) => s.quickLook)
  const pane = useStore((s) => s.activePane)
  const tab = useStore((s) => activeTab(s.activePane, s))
  const prefs = useStore((s) => s.prefs)
  const entry = open ? findVisible(tab, prefs, tab.focusPath) : null
  const [full, setFull] = useState(false)

  useEffect(() => {
    if (open && !entry) setState({ quickLook: false })
  }, [open, entry])

  if (!open || !entry) return null
  const entries = visibleEntries(tab, prefs)
  const idx = entries.findIndex((e) => e.path === entry.path)
  const step = (d: number): void => A.moveFocus(pane, d, { shift: false, ctrl: false })

  return (
    <div className={`ql-backdrop${full ? ' full' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && A.toggleQuickLook(false)}>
      <div className="ql-window" data-testid="quicklook" role="dialog" aria-label={`Quick Look: ${entry.name}`}>
        <div className="ql-titlebar">
          <button className="ql-btn" title="Close (Space / Esc)" onClick={() => A.toggleQuickLook(false)}>
            <X size={15} />
          </button>
          <button className="ql-btn" title={full ? 'Exit full screen' : 'Full screen'} onClick={() => setFull((f) => !f)}>
            {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <div className="ql-title" title={entry.path}>
            <FileIcon path={entry.path} isDir={entry.isDir} size={16} />
            <span>{entry.name}</span>
            <span className="muted">
              {idx + 1} / {entries.length}
            </span>
          </div>
          <button className="ql-btn" title="Previous (↑)" disabled={idx <= 0} onClick={() => step(-1)}>
            <ChevronLeft size={15} />
          </button>
          <button className="ql-btn" title="Next (↓)" disabled={idx >= entries.length - 1} onClick={() => step(1)}>
            <ChevronRight size={15} />
          </button>
          <button className="ql-btn" title="Show in file manager" onClick={() => void window.opal.reveal(entry.path)}>
            <FolderSearch size={14} />
          </button>
          <button className="ql-btn primary" title="Open with the default application (Enter)" onClick={() => void A.openEntry(pane, entry)}>
            <ExternalLink size={14} /> Open
          </button>
        </div>
        <QuickLookBody entry={entry} />
      </div>
    </div>
  )
}

function QuickLookBody({ entry }: { entry: FileEntry }) {
  const prefs = getState().prefs
  const [preview, setPreview] = useState<Preview | null>(null)
  const [zip, setZip] = useState<{ name: string; size: number }[] | null>(null)
  const [dirInfo, setDirInfo] = useState<{ bytes: number; files: number; dirs: number } | null>(null)
  const ext = entry.ext.toLowerCase()
  const kind = entry.isDir ? 'dir' : previewKindForExt(ext)

  useEffect(() => {
    let alive = true
    setPreview(null)
    setZip(null)
    setDirInfo(null)
    if (entry.isDir) {
      void window.opal.folderSize(entry.path, A.newJobId()).then((r) => alive && setDirInfo(r))
    } else if (ZIPLIKE.has(ext)) {
      void window.opal.zipList(entry.path).then(
        (z) => alive && setZip(z),
        () => alive && setZip([])
      )
    } else if (kind === 'text' || kind === 'binary') {
      void window.opal.preview(entry.path).then((p) => alive && setPreview(p))
    }
    return () => {
      alive = false
    }
  }, [entry.path, entry.mtime, ext, kind, entry.isDir])

  const markdown = useMemo(() => {
    if (!preview?.text || !MARKDOWN.has(ext)) return null
    return sanitizeHtml(markdownRenderer.parse(preview.text) as string)
  }, [preview, ext])

  const info = (
    <div className="ql-info">
      <b>{fileTypeLabel(entry)}</b>
      {!entry.isDir && <span>{formatSize(entry.size, prefs.sizeUnits)}</span>}
      <span>Modified {formatDate(entry.mtime, prefs.dateFormat, prefs.customDateFormat)}</span>
    </div>
  )

  if (entry.isDir) {
    return (
      <div className="ql-body ql-center">
        <FileIcon path={entry.path} isDir size={128} />
        <div className="ql-big-name">{entry.name}</div>
        {dirInfo ? (
          <div className="muted">
            {dirInfo.files} files, {dirInfo.dirs} folders · {formatSize(dirInfo.bytes)}
          </div>
        ) : (
          <div className="muted">Calculating size…</div>
        )}
        {info}
      </div>
    )
  }
  if (kind === 'image') return <div className="ql-body ql-media"><img src={fileUrl(entry.path)} alt="" draggable={false} data-testid="ql-image" /></div>
  if (kind === 'video') return <div className="ql-body ql-media"><video src={fileUrl(entry.path)} controls autoPlay /></div>
  if (kind === 'audio')
    return (
      <div className="ql-body ql-center">
        <FileIcon path={entry.path} isDir={false} size={128} />
        <audio src={fileUrl(entry.path)} controls autoPlay />
        {info}
      </div>
    )
  if (kind === 'pdf') return <div className="ql-body ql-media"><iframe src={fileUrl(entry.path)} title={entry.name} /></div>
  if (ZIPLIKE.has(ext)) {
    return (
      <div className="ql-body ql-scroll">
        <div className="ql-zip-head">
          <FileArchive size={18} /> {zip ? `${zip.length} items` : 'Reading archive…'}
          {zip && <span className="muted"> · {formatSize(zip.reduce((a, z) => a + z.size, 0))} uncompressed</span>}
        </div>
        <div className="ql-zip" data-testid="ql-zip">
          {(zip ?? []).slice(0, 2000).map((z) => (
            <div key={z.name} className="ql-zip-row">
              <span>{z.name}</span>
              <span className="muted">{z.name.endsWith('/') ? '' : formatSize(z.size)}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (!preview) return <div className="ql-body ql-center muted">Loading…</div>
  if (markdown !== null) return <div className="ql-body ql-scroll ql-markdown" data-testid="ql-markdown" dangerouslySetInnerHTML={{ __html: markdown }} />
  if (preview.kind === 'text') {
    return <CodeView text={preview.text ?? ''} name={entry.name} truncated={!!preview.truncated} />
  }
  return (
    <div className="ql-body ql-center">
      <FileIcon path={entry.path} isDir={false} size={128} />
      <div className="ql-big-name">{entry.name}</div>
      {info}
      <div className="muted">{preview.kind === 'error' ? preview.message : 'No preview available for this file type'}</div>
    </div>
  )
}

/** Text with line numbers, syntax-coloured when the file type is known (C, Python, TypeScript, JSON, …). */
function CodeView({ text, name, truncated }: { text: string; name: string; truncated: boolean }) {
  const lang = languageFor(name)
  const html = useMemo(() => highlightLines(text, name, lang), [text, name, lang])
  const lines = html ?? text.split('\n')
  return (
    <div className="ql-body ql-scroll ql-code-wrap">
      {lang && html && (
        <span className="ql-lang" data-testid="ql-lang">
          {languageName(lang)}
        </span>
      )}
      <pre className={`ql-code${html ? ' hljs' : ''}`} data-testid="ql-text">
        {lines.slice(0, 5000).map((l, i) => (
          <div key={i} className="ql-line">
            <span className="ql-ln">{i + 1}</span>
            {html ? <span dangerouslySetInnerHTML={{ __html: l || ' ' }} /> : <span>{l || ' '}</span>}
          </div>
        ))}
        {truncated && <div className="muted">… truncated</div>}
      </pre>
    </div>
  )
}
