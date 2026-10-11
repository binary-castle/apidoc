import type { HttpMethod } from '@apidoc/core'
import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Stroke icons from the design (Lucide-style paths on a 24px grid). */
const ICONS = {
  search: 'M21 21l-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  check: 'M5 12l5 5L20 7',
  play: 'M7 4l13 8-13 8z',
  sparkles: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  book: 'M4 19.5V5a2 2 0 0 1 2-2h14v18H6.5a2.5 2.5 0 0 1 0-5H20',
  zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  sun: 'M12 3v2M12 19v2M5 5l1.4 1.4M17.6 17.6L19 19M3 12h2M19 12h2M5 19l1.4-1.4M17.6 6.4L19 5M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  box: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  x: 'M18 6L6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  alert: 'M12 3l10 18H2zM12 10v4M12 17v.5',
  info: 'M12 8v.5M12 11v5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  fields: 'M4 7h16M4 12h10M4 17h7',
  menu: 'M4 7h16M4 12h16M4 17h16',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 8v4l3 2',
  key: 'M15 7a4 4 0 1 1-3.9 5H8v3H5v-3H3v-3h8.1A4 4 0 0 1 15 7z',
} as const

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 14, className = '', strokeWidth = 1.8, filled = false }: { name: IconName; size?: number; className?: string; strokeWidth?: number; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      <path d={ICONS[name]} />
    </svg>
  )
}

const METHOD_TEXT: Record<HttpMethod, string> = {
  get: 'text-get',
  post: 'text-post',
  put: 'text-put',
  patch: 'text-patch',
  delete: 'text-delete',
  head: 'text-muted',
  options: 'text-muted',
  trace: 'text-muted',
}
const METHOD_BG: Record<HttpMethod, string> = {
  get: 'bg-get-bg',
  post: 'bg-post-bg',
  put: 'bg-put-bg',
  patch: 'bg-patch-bg',
  delete: 'bg-delete-bg',
  head: 'bg-raised',
  options: 'bg-raised',
  trace: 'bg-raised',
}

export const methodLabel = (method: HttpMethod, short = false) =>
  short && method === 'delete' ? 'DEL' : short && method === 'options' ? 'OPT' : method.toUpperCase()

/** Plain coloured method text, used in dense lists (sidebar, history). */
export function MethodText({ method, className = '' }: { method: HttpMethod; className?: string }) {
  return <span className={`font-mono text-[10px] font-semibold tracking-wide ${METHOD_TEXT[method]} ${className}`}>{methodLabel(method, true)}</span>
}

/** Filled method pill, used in headers and the palette. */
export function MethodPill({ method, size = 'md' }: { method: HttpMethod; size?: 'sm' | 'md' }) {
  const sizing = size === 'sm' ? 'px-1.5 py-0.5 text-[10px] min-w-[44px]' : 'px-2 py-[3px] text-xs'
  return (
    <span className={`inline-flex items-center justify-center rounded-md font-mono font-bold ${sizing} ${METHOD_TEXT[method]} ${METHOD_BG[method]}`}>
      {methodLabel(method)}
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[5px] border border-border-strong bg-active px-1.5 py-px font-mono text-[10px] text-muted">{children}</kbd>
}

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'err'
const TONES: Record<Tone, string> = {
  neutral: 'border-border text-fg-2',
  accent: 'border-accent-line bg-accent-soft text-accent-text',
  ok: 'border-ok-line bg-ok-bg text-ok',
  warn: 'border-warn-line bg-warn-bg text-warn',
  err: 'border-err-line bg-err-bg text-err',
}

/** Rounded metadata chip (auth scope, rate limit, "Changed in …"). */
export function Chip({ tone = 'neutral', icon, children, title }: { tone?: Tone; icon?: ReactNode; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] leading-none ${TONES[tone]}`}>
      {icon}
      {children}
    </span>
  )
}

/** Small uppercase status tag (REQUIRED, DEPRECATED, NEW). */
export function Tag({ tone, children }: { tone: Tone; children: ReactNode }) {
  const colour = { neutral: 'bg-raised text-muted', accent: 'bg-accent-soft text-accent-text', ok: 'bg-get-bg text-ok', warn: 'bg-put-bg text-warn', err: 'bg-delete-bg text-err' }[tone]
  return <span className={`rounded px-1.5 py-px text-[10px] font-semibold leading-4 ${colour}`}>{children}</span>
}

export function useCopy(timeout = 1400): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return [
    copied,
    (text: string) => {
      navigator.clipboard?.writeText(text).then(() => {
        setCopied(true)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), timeout)
      }).catch(() => {})
    },
  ]
}

export function CopyButton({ text, label, className = '' }: { text: string; label?: string; className?: string }) {
  const [copied, copy] = useCopy()
  return (
    <button
      type="button"
      onClick={() => copy(text)}
      title={copied ? 'Copied' : label ?? 'Copy'}
      aria-label={label ?? 'Copy'}
      className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-fg ${className}`}
    >
      <Icon name={copied ? 'check' : 'copy'} className={copied ? 'text-ok' : ''} />
      {label && <span>{copied ? 'Copied' : label}</span>}
    </button>
  )
}

/** Segmented control (All/Required, JSON/Schema, Form/JSON). */
export function Segmented<T extends string>({ value, options, onChange, size = 'sm' }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (value: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex shrink-0 gap-0.5 rounded-lg border border-line bg-card p-0.5">
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-md ${size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs'} transition-colors ${
            option.value === value ? 'bg-active text-fg' : 'text-subtle hover:text-fg-2'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function statusTone(status: string | number): Tone {
  const code = String(status)
  if (code.startsWith('2')) return 'ok'
  if (code.startsWith('3')) return 'accent'
  if (code.startsWith('4')) return 'warn'
  if (code.startsWith('5')) return 'err'
  return 'neutral'
}

export const STATUS_DOT: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  err: 'bg-delete',
  accent: 'bg-accent',
  neutral: 'bg-subtle',
}

export const STATUS_TEXT: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  err: 'text-delete',
  accent: 'text-accent-text',
  neutral: 'text-muted',
}
