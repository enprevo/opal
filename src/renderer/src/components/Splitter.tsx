import { useRef } from 'react'

interface Props {
  direction: 'horizontal' | 'vertical'
  onDrag: (delta: number) => void
  onDoubleClick?: () => void
}

/** A draggable divider. "horizontal" resizes along the X axis. */
export function Splitter({ direction, onDrag, onDoubleClick }: Props) {
  const last = useRef(0)
  const onDragRef = useRef(onDrag)
  onDragRef.current = onDrag

  const onMouseDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    last.current = direction === 'horizontal' ? e.clientX : e.clientY
    const move = (ev: MouseEvent): void => {
      const pos = direction === 'horizontal' ? ev.clientX : ev.clientY
      const d = pos - last.current
      if (d !== 0) {
        last.current = pos
        onDragRef.current(d)
      }
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing')
    }
    document.body.classList.add('resizing')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return <div className={`splitter splitter-${direction}`} onMouseDown={onMouseDown} onDoubleClick={onDoubleClick} />
}
