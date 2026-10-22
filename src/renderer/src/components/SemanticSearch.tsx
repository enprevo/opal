import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  Sparkles, FolderPlus, RefreshCw, X, Loader2, FileText, Tag, FolderOpen, ExternalLink, Copy, Pause, Gauge, Files, Search as SearchIcon
} from 'lucide-react'
import { closeDialog, getState, setState, useStore } from '../state/store'
import * as A from '../state/actions'
import type { SemanticHit, SemanticSearchResult, SemanticStatus } from '@shared/types'
import { formatDate, formatSize } from '@shared/format'
import { basename, dirname, isAncestor, samePath } from '@shared/paths'
import { IMAGE_EXTENSIONS } from '@shared/filetypes'
import { FileIcon, thumbUrl } from './FileIcon'
import { Modal } from './Dialogs'

function reveal(path: string): void {
  closeDialog(null)
  void A.navigate(getState().activePane, dirname(path) ?? path, { focusName: basename(path) })
}

const EXAMPLES = ['fattura manutenzione caldaia', 'contratto di affitto', 'meeting notes about the budget', 'ricetta torta']

const TYPES: { id: string; label: string; exts: string[] }[] = [
  { id: 'pdf', label: 'PDF', exts: ['pdf'] },
  { id: 'docs', label: 'Documents', exts: ['docx', 'odt', 'rtf', 'txt', 'md', 'markdown', 'rst', 'tex', 'org', 'adoc'] },
  { id: 'sheets', label: 'Spreadsheets', exts: ['xlsx', 'ods'] },
  { id: 'slides', label: 'Slides', exts: ['pptx', 'odp'] },
  { id: 'web', label: 'Web & mail', exts: ['html', 'htm', 'eml', 'epub'] }
]

const DAY = 86_400_000
const DATES: { id: string; label: string; ms: number }[] = [
  { id: 'any', label: 'Any time', ms: 0 },
  { id: 'week', label: 'Past week', ms: 7 * DAY },
  { id: 'month', label: 'Past month', ms: 31 * DAY },
  { id: 'year', label: 'Past year', ms: 366 * DAY }
]

const fold = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/** Query words reduced to prefixes, so "fatture" highlights "fattura" and "vaccinations" highlights "vaccination". */
function highlightStems(q: string): string[] {
  return [...new Set(fold(q).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3))].map((w) => (w.length >= 6 ? w.slice(0, w.length - 2) : w))
}

function Highlight({ text, stems }: { text: string; stems: string[] }) {
  if (!stems.length) return <>{text}</>
  const parts = text.split(/([\p{L}\p{N}]+)/u)
  return (
    <>
      {parts.map((p, i) => {
        const f = fold(p)
        return stems.some((s) => f.startsWith(s)) && p.length >= 3 ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>
      })}
    </>
  )
}

function Relevance({ score }: { score: number }) {
  const level = score >= 0.75 ? 3 : score >= 0.4 ? 2 : 1
  const label = level === 3 ? 'Strong match' : level === 2 ? 'Good match' : 'Possible match'
  return (
    <span className={`sem-rel l${level}`} title={label} data-testid="semantic-relevance">
      <i />
      <i />
      <i />
    </span>
  )
}

const MATCH_LABEL: Record<string, { text: string; title: string }> = {
  meaning: { text: 'meaning', title: 'The content is about what you described' },
  words: { text: 'words', title: 'Contains your words' },
  name: { text: 'name', title: 'Your words are in the file name' }
}

function eta(st: SemanticStatus): string {
  if (!st.startedAt || st.done < 3 || !st.total) return ''
  const rate = st.done / ((Date.now() - st.startedAt) / 1000)
  const left = (st.total - st.done) / Math.max(rate, 0.01)
  if (left < 60) return 'less than a minute left'
  if (left < 3600) return `about ${Math.round(left / 60)} min left`
  return `about ${(left / 3600).toFixed(1)} h left`
}

function IndexProgress({ status }: { status: SemanticStatus }) {
  const pct = status.total ? Math.min(100, (status.done / status.total) * 100) : 0
  return (
    <div className="sem-progress" data-testid="semantic-progress">
      <div className="sem-progress-text">
        <Loader2 size={13} className="spin" />
        <span>
          Indexing {status.done.toLocaleString()} of {status.total.toLocaleString()} · {eta(status) || 'estimating…'}
        </span>
        {status.currentFile && <span className="muted ellipsis" title={status.currentFile}>{basename(status.currentFile)}</span>}
        <span className="spacer" />
        <button className="btn small" title="Stop indexing for now; it resumes with “Update index”" onClick={() => void window.opal.semanticCancel()}>
          <Pause size={12} /> Pause
        </button>
      </div>
      <div className="progress">
        <div className="progress-bar" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function Preview({ hit, stems }: { hit: SemanticHit; stems: string[] }) {
  const ext = hit.name.split('.').pop()?.toLowerCase() ?? ''
  const thumb = ext === 'pdf' || IMAGE_EXTENSIONS.has(ext)
  return (
    <div className="sem-preview" data-testid="semantic-preview">
      <div className="sem-preview-thumb">
        {thumb ? <img src={thumbUrl(hit.path, 256)} alt="" draggable={false} /> : <FileIcon path={hit.path} isDir={false} size={64} />}
      </div>
      <div className="sem-preview-name" title={hit.path}>
        {hit.name}
      </div>
      <div className="muted small ellipsis" title={dirname(hit.path) ?? ''}>
        {dirname(hit.path)}
      </div>
      <div className="sem-badges">
        {hit.page && <span className="sem-badge page">page {hit.page}</span>}
        {hit.matched.map((m) => (
          <span key={m} className={`sem-badge ${m}`} title={MATCH_LABEL[m].title}>
            {MATCH_LABEL[m].text}
          </span>
        ))}
      </div>
      {hit.snippet && (
        <blockquote className="sem-passage">
          <Highlight text={hit.snippet} stems={stems} />
        </blockquote>
      )}
      <div className="muted small">
        Modified {formatDate(hit.mtime)} · {formatSize(hit.size)}
      </div>
      {hit.duplicates.length > 0 && (
        <div className="small sem-dups">
          <Files size={12} /> Same content also in:
          {hit.duplicates.map((d) => (
            <button key={d} className="link" title={d} onClick={() => reveal(d)}>
              {dirname(d)}
            </button>
          ))}
        </div>
      )}
      <div className="sem-preview-actions">
        <button className="btn primary" onClick={() => void window.opal.open(hit.path)} title="Open with the default app (Enter)">
          <ExternalLink size={13} /> Open
        </button>
        <button className="btn" onClick={() => reveal(hit.path)} title="Show the file in the active pane (Ctrl+Enter)">
          <FolderOpen size={13} /> Show
        </button>
        <button className="btn" title="Copy full path" onClick={() => void navigator.clipboard.writeText(hit.path).then(() => A.toastMsg('Path copied'))}>
          <Copy size={13} />
        </button>
      </div>
    </div>
  )
}

/**
 * Search by meaning: a local multilingual embedding model finds candidate passages, keywords (BM25) add exact
 * matches, and a cross-encoder re-reads the best candidates to rank them (nothing leaves the computer).
 */
export function SemanticDialog({ root }: { root: string }) {
  const status = useStore((s) => s.semantic)
  const folders = useStore((s) => s.prefs.semanticFolders)
  const precise = useStore((s) => s.prefs.semanticPrecise)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<'all' | 'here'>('all')
  const [types, setTypes] = useState<string[]>([])
  const [date, setDate] = useState('any')
  const [result, setResult] = useState<(SemanticSearchResult & { key: string }) | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const seq = useRef(0)
  const covered = folders.some((f) => samePath(f, root) || isAncestor(f, root))

  const key = JSON.stringify([query.trim(), scope, types, date])
  const stems = useMemo(() => highlightStems(result ? JSON.parse(result.key)[0] : ''), [result])

  useEffect(() => {
    inputRef.current?.focus()
    void window.opal.semanticStatus(true).then((st) => setState({ semantic: st }))
  }, [])

  const search = async (): Promise<void> => {
    const q = query.trim()
    if (!q) return
    const my = ++seq.current
    setBusy(true)
    setError(null)
    try {
      const d = DATES.find((x) => x.id === date)!
      const res = await window.opal.semanticSearch(q, {
        folder: scope === 'here' ? root : undefined,
        limit: 60,
        exts: types.length ? TYPES.filter((t) => types.includes(t.id)).flatMap((t) => t.exts) : undefined,
        after: d.ms ? Date.now() - d.ms : undefined
      })
      if (my !== seq.current) return
      setResult({ ...res, key })
      setSel(0)
    } catch (e) {
      if (my === seq.current) setError(A.cleanError(e))
    } finally {
      if (my === seq.current) setBusy(false)
    }
  }

  // Search as you type (after a short pause); the previous results stay visible until the new ones arrive.
  useEffect(() => {
    if (query.trim().length < 3) return
    const t = setTimeout(() => void search(), 450)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.sem-hit.selected')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const hits = result?.hits ?? []
  const current = hits[sel]
  const stale = !!result && result.key !== key

  const onKey = (e: React.KeyboardEvent): void => {
    e.stopPropagation()
    if (e.key === 'Escape') closeDialog(null)
    else if (e.key === 'ArrowDown' && hits.length) {
      e.preventDefault()
      setSel((i) => Math.min(hits.length - 1, i + 1))
    } else if (e.key === 'ArrowUp' && hits.length) {
      e.preventDefault()
      setSel((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!result || stale) void search()
      else if (current && (e.ctrlKey || e.metaKey)) reveal(current.path)
      else if (current) void window.opal.open(current.path)
    }
  }

  const st = status
  const modelNote =
    st?.modelState === 'loading'
      ? 'Downloading the language model (first time only, ≈120 MB; then it works offline)…'
      : st?.modelState === 'error'
        ? `Language model unavailable: ${st.modelError}. Keyword search still works.`
        : precise && st?.rerankState === 'loading'
          ? 'Downloading the precision model (first time only, ≈115 MB). Meanwhile results use quick ranking.'
          : precise && st?.rerankState === 'error'
            ? `Precision model unavailable (${st.rerankError}); using quick ranking.`
            : null
  const modeLabel = result
    ? result.mode === 'precise'
      ? { text: 'Precise ranking', title: 'Candidates were re-read by the precision model' }
      : result.mode === 'semantic'
        ? { text: 'Quick ranking', title: 'Meaning and keywords only (precision model off or not ready)' }
        : { text: 'Keywords only', title: 'The language model is not ready yet' }
    : null

  return (
    <Modal
      title="Search by meaning"
      wide
      testId="semantic-dialog"
      footer={
        <>
          <span className="muted small" data-testid="semantic-status">
            {st
              ? st.indexing
                ? `Indexing… ${st.indexedFiles} documents so far`
                : `${st.indexedFiles} documents indexed in ${folders.length} folder(s)`
              : 'Loading…'}
          </span>
          {result && !stale && (
            <span className="muted small">
              · {hits.length} result{hits.length === 1 ? '' : 's'} in {result.ms < 1000 ? `${result.ms} ms` : `${(result.ms / 1000).toFixed(1)} s`}
            </span>
          )}
          {modeLabel && (
            <span className={`sem-mode ${result!.mode}`} title={modeLabel.title} data-testid="semantic-mode">
              <Gauge size={11} /> {modeLabel.text}
            </span>
          )}
          <span className="spacer" />
          <button className="btn" title="Look for new or changed documents" onClick={() => void window.opal.semanticRescan()}>
            <RefreshCw size={14} /> Update index
          </button>
          <button className="btn" onClick={() => closeDialog(null)}>
            Close
          </button>
          <button className="btn primary" data-testid="semantic-search" disabled={busy || !query.trim()} onClick={() => void search()}>
            {busy ? <Loader2 size={14} className="spin" /> : <SearchIcon size={14} />} Search
          </button>
        </>
      }
    >
      <div className="sem-dialog">
        <div className="sem-query">
          {busy ? <Loader2 size={18} className="sem-icon spin" /> : <Sparkles size={18} className="sem-icon" />}
          <input
            ref={inputRef}
            data-testid="semantic-input"
            placeholder="Describe what you are looking for, in any language — e.g. “invoice for the boiler repair”"
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          {query && (
            <button className="icon-btn" title="Clear" onClick={() => (setQuery(''), setResult(null), inputRef.current?.focus())}>
              <X size={14} />
            </button>
          )}
        </div>
        <div className="sem-filters">
          <div className="seg" role="radiogroup">
            <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
              All indexed folders
            </button>
            <button className={scope === 'here' ? 'on' : ''} onClick={() => setScope('here')} title={root}>
              Only in {basename(root) || root}
            </button>
          </div>
          <div className="sem-types">
            {TYPES.map((t) => (
              <button
                key={t.id}
                className={`chip${types.includes(t.id) ? ' on' : ''}`}
                data-testid={`semantic-type-${t.id}`}
                onClick={() => setTypes((cur) => (cur.includes(t.id) ? cur.filter((x) => x !== t.id) : [...cur, t.id]))}
              >
                {t.label}
              </button>
            ))}
          </div>
          <select className="select small" value={date} onChange={(e) => setDate(e.target.value)} title="Modified">
            {DATES.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          {!covered && (
            <button className="btn small" data-testid="semantic-add-folder" onClick={() => void A.addSemanticFolder(root)}>
              <FolderPlus size={13} /> Index this folder
            </button>
          )}
        </div>
        {st?.indexing && <IndexProgress status={st} />}
        {modelNote && <div className="sem-note">{modelNote}</div>}
        {st?.truncated && <div className="sem-note">Indexing stopped at 50,000 files. Index smaller folders to cover everything.</div>}
        {folders.length === 0 && (
          <div className="sem-empty">
            <FileText size={28} />
            <div>
              <b>No folders indexed yet.</b>
              <div className="muted">
                Choose the folders with your documents: PDF, Word, Excel, PowerPoint, OpenDocument, RTF, EPUB, e-mails, web pages, text and Markdown.
                Everything is processed on this computer; nothing is uploaded.
              </div>
            </div>
            <button className="btn primary" onClick={() => void A.addSemanticFolder(root)}>
              <FolderPlus size={14} /> Index {basename(root) || root}
            </button>
          </div>
        )}
        {error && <div className="error small">{error}</div>}
        {!result && folders.length > 0 && (
          <div className="sem-examples">
            <span className="muted">Try:</span>
            {EXAMPLES.map((x) => (
              <button key={x} className="chip" onClick={() => setQuery(x)}>
                {x}
              </button>
            ))}
          </div>
        )}
        {result && (
          <div className={`sem-split${stale || busy ? ' refining' : ''}`}>
            <div className="sem-results" data-testid="semantic-results" ref={listRef}>
              {hits.length === 0 && (
                <div className="muted pad">
                  Nothing relevant found. Try other words or a description of the content, remove filters, or index more folders.
                </div>
              )}
              {hits.map((h, i) => (
                <div
                  key={h.path}
                  className={`sem-hit${i === sel ? ' selected' : ''}`}
                  data-testid="semantic-hit"
                  onClick={() => setSel(i)}
                  onDoubleClick={() => reveal(h.path)}
                  title="Double-click to show the file · Enter opens it"
                >
                  <FileIcon path={h.path} isDir={false} size={28} />
                  <div className="sem-hit-body">
                    <div className="sem-hit-name">
                      <span className="ellipsis">
                        <Highlight text={h.name} stems={stems} />
                      </span>
                      <Relevance score={h.score} />
                      {h.page && <span className="sem-badge page">p. {h.page}</span>}
                      {h.duplicates.length > 0 && (
                        <span className="sem-badge" title={h.duplicates.join('\n')}>
                          +{h.duplicates.length} {h.duplicates.length === 1 ? 'copy' : 'copies'}
                        </span>
                      )}
                    </div>
                    <div className="sem-hit-snippet">
                      <Highlight text={h.snippet} stems={stems} />
                    </div>
                    <div className="muted small ellipsis">
                      {dirname(h.path)} · {formatDate(h.mtime)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {current && <Preview hit={current} stems={stems} />}
          </div>
        )}
        {folders.length > 0 && (
          <div className="sem-folders">
            <span className="muted small">Indexed:</span>
            {folders.map((f) => (
              <span key={f} className="chip" title={f}>
                {basename(f) || f}
                <button className="chip-x" title="Stop indexing this folder" onClick={() => void A.setSemanticFolders(folders.filter((x) => x !== f))}>
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Lists every item carrying a given colour label. */
export function TaggedDialog({ label }: { label: string }) {
  const labels = useStore((s) => s.labels)
  const def = useStore((s) => s.labelDefs.find((l) => l.id === label))
  const paths = Object.entries(labels)
    .filter(([, ids]) => ids.includes(label))
    .map(([p]) => p)
    .sort()
  return (
    <Modal
      title={`Label: ${def?.name ?? label}`}
      wide
      testId="tagged-dialog"
      footer={
        <button className="btn primary" onClick={() => closeDialog(null)}>
          Close
        </button>
      }
    >
      <div className="find-results">
        {paths.length === 0 && (
          <div className="muted pad">
            <Tag size={14} /> No items have this label yet. Right-click a file → Label.
          </div>
        )}
        {paths.map((p) => (
          <div key={p} className="fr-row" onDoubleClick={() => reveal(p)} title="Double-click to show">
            <FileIcon path={p} isDir={false} />
            <span className="fr-name">{basename(p)}</span>
            <span className="fr-dir muted">{dirname(p)}</span>
            <span />
          </div>
        ))}
      </div>
    </Modal>
  )
}
