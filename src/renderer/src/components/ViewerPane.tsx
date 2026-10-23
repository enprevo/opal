import { useEffect, useMemo, useState } from 'react'
import { activeTab, findVisible, useStore } from '../state/store'
import type { Preview } from '@shared/types'
import { formatDate, formatSize } from '@shared/format'
import { fileTypeLabel } from '@shared/filetypes'
import { FileIcon, fileUrl } from './FileIcon'
import { highlightBlock, languageFor } from '../highlight'

export function ViewerPane() {
  const tab = useStore((s) => activeTab(s.activePane, s))
  const prefs = useStore((s) => s.prefs)
  const entry = findVisible(tab, prefs, tab.focusPath)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [dirSize, setDirSize] = useState<number | null>(null)

  useEffect(() => {
    setPreview(null)
    setDirSize(null)
    if (!entry) return
    let alive = true
    const t = setTimeout(() => {
      void window.opal.preview(entry.path).then((p) => alive && setPreview(p))
    }, 80)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [entry?.path, entry?.mtime])

  if (!entry) return <div className="viewer empty">No file selected</div>

  return (
    <div className="viewer" data-testid="viewer">
      <div className="viewer-head">
        <FileIcon path={entry.path} isDir={entry.isDir} size={32} />
        <div className="viewer-title">
          <div className="viewer-name" title={entry.name}>
            {entry.name}
          </div>
          <div className="muted">
            {fileTypeLabel(entry)}
            {!entry.isDir && ` · ${formatSize(entry.size, prefs.sizeUnits)}`} · {formatDate(entry.mtime, prefs.dateFormat)}
          </div>
        </div>
      </div>
      <div className="viewer-body">
        {!preview && <div className="muted pad">Loading…</div>}
        {preview?.kind === 'image' && <img className="viewer-image" src={fileUrl(entry.path)} alt="" draggable={false} />}
        {preview?.kind === 'video' && <video className="viewer-media" src={fileUrl(entry.path)} controls />}
        {preview?.kind === 'audio' && <audio className="viewer-audio" src={fileUrl(entry.path)} controls />}
        {preview?.kind === 'pdf' && <iframe className="viewer-pdf" src={fileUrl(entry.path)} title="pdf" />}
        {preview?.kind === 'text' && (
          <ViewerText text={preview.text ?? ''} name={entry.name} truncated={!!preview.truncated} />
        )}
        {preview?.kind === 'binary' && <div className="muted pad">Binary file — no preview available</div>}
        {preview?.kind === 'error' && <div className="error pad">{preview.message}</div>}
        {preview?.kind === 'dir' && (
          <div className="pad">
            <button
              className="btn"
              onClick={() => {
                setDirSize(-1)
                void window.opal.folderSize(entry.path, `vs${Date.now()}`).then((r) => setDirSize(r.bytes))
              }}
            >
              Calculate size
            </button>
            {dirSize !== null && <span className="muted"> {dirSize < 0 ? 'Calculating…' : formatSize(dirSize)}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

function ViewerText({ text, name, truncated }: { text: string; name: string; truncated: boolean }) {
  const lang = languageFor(name)
  const html = useMemo(() => (lang && text.length < 400_000 ? highlightBlock(text, lang) : null), [text, lang])
  return (
    <pre className={`viewer-text${html ? ' hljs' : ''}`} data-testid="viewer-text">
      {html ? <code dangerouslySetInnerHTML={{ __html: html }} /> : text}
      {truncated && '\n\n… (truncated)'}
    </pre>
  )
}
