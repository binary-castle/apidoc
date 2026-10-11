import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Minimal popover: toggles on click, closes on outside click or Escape. */
export function Popover({ trigger, children, align = 'left', width = 320 }: { trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; width?: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen(o => !o)}>{trigger(open)}</div>
      {open && (
        <div
          className={`absolute top-[calc(100%+6px)] z-40 rounded-xl border border-border bg-card p-3 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.45)] ${align === 'right' ? 'right-0' : 'left-0'}`}
          style={{ width }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
