import { useEffect, useRef, useState } from 'react'
import { setState, useStore, activeTab } from '../state/store'
import { COMMAND_DOCS, runCommand } from '../state/commands'

const history: string[] = []

export function CommandLine() {
  const [value, setValue] = useState('')
  const [hIdx, setHIdx] = useState(-1)
  const ref = useRef<HTMLInputElement>(null)
  const path = useStore((s) => activeTab(s.activePane, s).path)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const word = value.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  const hints = word ? COMMAND_DOCS.filter((d) => d.name.toLowerCase().startsWith(word)).slice(0, 6) : COMMAND_DOCS.slice(0, 6)

  const close = (): void => setState({ cliOpen: false })

  return (
    <div className="cli">
      {hints.length > 0 && (
        <div className="cli-hints">
          {hints.map((h) => (
            <div key={h.name} className="cli-hint" onMouseDown={(e) => { e.preventDefault(); setValue(h.name === '<other>' ? '' : h.name + ' ') }}>
              <b>{h.name}</b> <span className="muted">{h.usage}</span>
            </div>
          ))}
        </div>
      )}
      <div className="cli-row">
        <span className="cli-prompt" title={path}>
          &gt;
        </span>
        <input
          ref={ref}
          className="cli-input"
          data-testid="cli-input"
          value={value}
          spellCheck={false}
          placeholder="Command (e.g. Select PATTERN=*.txt, Go UP, Copy MOVE, notepad {filepath}) — Esc to close"
          onChange={(e) => setValue(e.target.value)}
          onBlur={close}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') close()
            else if (e.key === 'Enter') {
              const v = value.trim()
              if (!v) return close()
              history.unshift(v)
              setValue('')
              setHIdx(-1)
              void runCommand(v)
              if (!e.shiftKey) close()
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              const i = Math.min(history.length - 1, hIdx + 1)
              if (i >= 0) {
                setHIdx(i)
                setValue(history[i])
              }
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              const i = hIdx - 1
              setHIdx(Math.max(-1, i))
              setValue(i >= 0 ? history[i] : '')
            }
          }}
        />
      </div>
    </div>
  )
}
