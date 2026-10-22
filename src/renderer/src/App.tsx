import { useRef } from 'react'
import { useStore } from './state/store'
import { setUi } from './state/actions'
import { Toolbar } from './components/Toolbar'
import { FileDisplay } from './components/FileDisplay'
import { Sidebar } from './components/Sidebar'
import { ViewerPane } from './components/ViewerPane'
import { CommandLine } from './components/CommandLine'
import { JobsPanel } from './components/JobsPanel'
import { Toasts } from './components/Toasts'
import { ContextMenu } from './components/ContextMenu'
import { DialogHost } from './components/Dialogs'
import { Splitter } from './components/Splitter'
import { HelperLayer } from './components/Helper'
import { QuickLook } from './components/QuickLook'

export function App() {
  const ready = useStore((s) => s.ready)
  const prefs = useStore((s) => s.prefs)
  const cliOpen = useStore((s) => s.cliOpen)
  const ui = useStore((s) => s.ui)
  const sidebarW = ui.sidebarWidth ?? 240
  const viewerW = ui.viewerWidth ?? 360
  const ratio = ui.paneRatio ?? 0.5
  const setSidebarW = (n: number): void => setUi({ sidebarWidth: n })
  const setViewerW = (n: number): void => setUi({ viewerWidth: n })
  const setRatio = (n: number): void => setUi({ paneRatio: n })
  const displaysRef = useRef<HTMLDivElement>(null)

  if (!ready) return <div className="loading">Loading…</div>

  const vertical = prefs.dualVertical
  const r = Math.min(0.85, Math.max(0.15, ratio))

  return (
    <div className="app">
      <Toolbar />
      <div className="main">
        {prefs.showTree && (
          <>
            <div className="sidebar-wrap" style={{ width: sidebarW }}>
              <Sidebar />
            </div>
            <Splitter direction="horizontal" onDrag={(dx) => setSidebarW(Math.max(140, Math.min(600, sidebarW + dx)))} />
          </>
        )}
        <div ref={displaysRef} className={`displays ${vertical ? 'side-by-side' : 'stacked'}`}>
          <div className="display-slot" style={prefs.dualDisplay ? { flexBasis: `${r * 100}%` } : { flexBasis: '100%' }}>
            <FileDisplay pane={0} />
          </div>
          {prefs.dualDisplay && (
            <>
              <Splitter
                direction={vertical ? 'horizontal' : 'vertical'}
                onDrag={(d) => {
                  const el = displaysRef.current
                  if (!el) return
                  const size = vertical ? el.clientWidth : el.clientHeight
                  setRatio(Math.min(0.85, Math.max(0.15, r + d / size)))
                }}
                onDoubleClick={() => setRatio(0.5)}
              />
              <div className="display-slot" style={{ flexBasis: `${(1 - r) * 100}%` }}>
                <FileDisplay pane={1} />
              </div>
            </>
          )}
        </div>
        {prefs.showViewer && (
          <>
            <Splitter direction="horizontal" onDrag={(dx) => setViewerW(Math.max(200, Math.min(1000, viewerW - dx)))} />
            <div className="viewer-wrap" style={{ width: viewerW }}>
              <ViewerPane />
            </div>
          </>
        )}
      </div>
      {cliOpen && <CommandLine />}
      <JobsPanel />
      <Toasts />
      <ContextMenu />
      <QuickLook />
      <DialogHost />
      <HelperLayer />
    </div>
  )
}
