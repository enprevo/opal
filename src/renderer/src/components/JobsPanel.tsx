import { X } from 'lucide-react'
import { useStore } from '../state/store'
import { formatSize } from '@shared/format'

export function JobsPanel() {
  const jobs = useStore((s) => s.jobs)
  const list = Object.values(jobs)
  if (!list.length) return null
  return (
    <div className="jobs-panel" data-testid="jobs-panel">
      {list.map((j) => {
        const pct = j.totalBytes > 0 ? Math.round((j.doneBytes / j.totalBytes) * 100) : j.finished ? 100 : 0
        return (
          <div key={j.jobId} className="job">
            <div className="job-head">
              <b>{j.op === 'move' ? 'Moving' : 'Copying'}</b>
              <span className="muted">
                {j.doneFiles}/{j.totalFiles} files · {formatSize(j.doneBytes)} / {formatSize(j.totalBytes)}
              </span>
              {!j.finished && (
                <button className="icon-btn" title="Cancel" onClick={() => void window.opal.cancelJob(j.jobId)}>
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="progress">
              <div className="progress-bar" style={{ width: `${pct}%` }} />
            </div>
            <div className="job-file muted">{j.currentFile}</div>
          </div>
        )
      })}
    </div>
  )
}
