import { joinUrl, objectProperties, typeLabel, type OperationModel, type SearchHit, type SearchKind } from '@apidoc/core'
import { Command } from 'cmdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDocs } from '../state'
import { Icon, Kbd, MethodPill, useCopy } from './ui'

type Scope = 'all' | SearchKind

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'operation', label: 'Endpoints' },
  { value: 'schema', label: 'Schemas' },
  { value: 'field', label: 'Fields' },
]

const GROUP_TITLES: Record<SearchKind, string> = { operation: 'Endpoints', schema: 'Schemas', field: 'Fields' }

/** Bold the parts of `text` that start a word matching a query term. */
function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1)
  if (!terms.length) return <>{text}</>
  const pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig')
  return (
    <>
      {text.split(pattern).map((part, i) =>
        terms.includes(part.toLowerCase()) ? <strong key={i} className="font-semibold text-fg-strong">{part}</strong> : <span key={i}>{part}</span>,
      )}
    </>
  )
}

function OperationPreview({ operation }: { operation: OperationModel }) {
  const { resolver, baseUrl, navigate, setPaletteOpen } = useDocs()
  const [copied, copy] = useCopy()
  const media = operation.requestBody?.content[0]
  const required = media ? objectProperties(media.schema, resolver).filter(p => p.required).map(p => p.name) : []
  const success = operation.responses.find(r => r.status.startsWith('2'))
  const returns = success?.content[0] ? typeLabel(success.content[0].schema, resolver) : undefined
  const open = (view: 'operation' | 'playground') => {
    navigate({ view, id: operation.id })
    setPaletteOpen(false)
  }
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-2">
        <MethodPill method={operation.method} size="sm" />
        <code className="truncate font-mono text-xs text-fg">{operation.path}</code>
      </div>
      {operation.description && <p className="line-clamp-3 text-[13px] leading-5 text-body">{operation.description.replace(/[`*_]/g, '')}</p>}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5 rounded-lg border border-line bg-raised p-2.5">
          <span className="text-[11px] text-subtle">Required</span>
          <span className="truncate font-mono text-xs text-fg">{required.length ? required.join(', ') : operation.parameters.filter(p => p.required).map(p => p.name).join(', ') || '—'}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-lg border border-line bg-raised p-2.5">
          <span className="text-[11px] text-subtle">Returns</span>
          <span className="truncate font-mono text-xs text-accent-text">{returns ? returns.refName ?? returns.label : success?.status ?? '—'}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold tracking-wide text-subtle">QUICK ACTIONS</span>
        <button type="button" onClick={() => open('playground')} className="flex items-center gap-2.5 rounded-lg bg-raised px-2.5 py-2 text-left text-xs text-fg hover:bg-active">
          <Icon name="play" size={12} filled className="text-accent" />
          <span className="flex-1">Open in Playground</span>
          <span className="font-mono text-[11px] text-subtle">⌘↵</span>
        </button>
        <button type="button" onClick={() => copy(joinUrl(baseUrl, operation.path))} className="flex items-center gap-2.5 rounded-lg bg-raised px-2.5 py-2 text-left text-xs text-fg hover:bg-active">
          <Icon name={copied ? 'check' : 'link'} size={13} className={copied ? 'text-ok' : 'text-muted'} />
          <span className="flex-1">{copied ? 'Copied' : 'Copy URL'}</span>
        </button>
      </div>
    </div>
  )
}

export function CommandPalette() {
  const { model, search, navigate, paletteOpen, setPaletteOpen, operationById } = useDocs()
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [selected, setSelected] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // ⌘K / Ctrl+K / "/" open the palette from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // composedPath()[0] is the real target even when the UI lives in a shadow root.
      const target = event.composedPath()[0]
      const typing = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(!paletteOpen)
      } else if (event.key === '/' && !typing && !paletteOpen) {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteOpen, setPaletteOpen])

  useEffect(() => {
    if (paletteOpen) requestAnimationFrame(() => inputRef.current?.select())
  }, [paletteOpen])

  const hits = useMemo<SearchHit[]>(() => {
    if (!query.trim()) {
      return model.operations.slice(0, 8).map(op => ({ id: `operation:${op.id}`, kind: 'operation', title: op.summary ?? op.path, subtitle: op.path, method: op.method, operationId: op.id, score: 0 }))
    }
    return search.search(query, { kinds: scope === 'all' ? undefined : [scope], limit: 40 })
  }, [query, scope, search, model])

  const counts = useMemo(() => {
    if (!query.trim()) return undefined
    const all = search.search(query, { limit: 200 })
    return { all: all.length, operation: all.filter(h => h.kind === 'operation').length, schema: all.filter(h => h.kind === 'schema').length, field: all.filter(h => h.kind === 'field').length }
  }, [query, search])

  const groups = (['operation', 'schema', 'field'] as const).map(kind => ({ kind, hits: hits.filter(h => h.kind === kind) })).filter(g => g.hits.length)
  const active = hits.find(h => h.id === selected) ?? hits[0]
  const activeOperation = active?.operationId ? operationById(active.operationId) : undefined

  const choose = (hit: SearchHit, playground = false) => {
    if (hit.operationId) navigate({ view: playground ? 'playground' : 'operation', id: hit.operationId })
    else if (hit.schemaName) navigate({ view: 'schema', name: hit.schemaName })
    setPaletteOpen(false)
  }

  if (!paletteOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh]" role="dialog" aria-modal aria-label="Search">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={() => setPaletteOpen(false)} />
      <Command
        shouldFilter={false}
        loop
        value={active?.id ?? ''}
        onValueChange={setSelected}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            setPaletteOpen(false)
          } else if (event.key === 'Tab') {
            event.preventDefault()
            const index = SCOPES.findIndex(s => s.value === scope)
            setScope(SCOPES[(index + (event.shiftKey ? SCOPES.length - 1 : 1)) % SCOPES.length]!.value)
          } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && active) {
            event.preventDefault()
            choose(active, true)
          }
        }}
        className="relative flex h-[min(560px,80vh)] w-full max-w-[780px] flex-col overflow-hidden rounded-2xl border border-border-strong bg-card shadow-[0_24px_64px_-12px_rgba(0,0,0,0.6)]"
      >
        <div className="flex items-center gap-3 border-b border-border px-[18px] py-4">
          <Icon name="search" size={18} className="text-muted" />
          <Command.Input ref={inputRef} value={query} onValueChange={setQuery} placeholder="Search endpoints, schemas, fields…" className="min-w-0 flex-1 bg-transparent text-[17px] text-fg-strong outline-none placeholder:text-faint" />
          <Kbd>esc</Kbd>
        </div>
        <div className="ad-scroll flex items-center gap-1.5 overflow-x-auto border-b border-line px-4 py-2.5">
          {SCOPES.map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => setScope(option.value)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs transition-colors ${scope === option.value ? 'bg-fg font-medium text-bg' : 'border border-border-strong text-muted hover:text-fg-2'}`}
            >
              {option.label}
              {counts && <span className="ml-1.5 opacity-70">{counts[option.value]}</span>}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 flex-1">
          <Command.List className="ad-scroll min-w-0 flex-1 overflow-y-auto border-r border-line p-2 md:max-w-[430px]">
            <Command.Empty className="px-3 py-10 text-center text-sm text-subtle">No matches for “{query}”.</Command.Empty>
            {groups.map(group => (
              <Command.Group key={group.kind} heading={query.trim() ? GROUP_TITLES[group.kind] : 'Jump to'} className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-subtle">
                {group.hits.map(hit => (
                  <Command.Item
                    key={hit.id}
                    value={hit.id}
                    onSelect={() => choose(hit)}
                    className="flex cursor-pointer items-center gap-2.5 rounded-[9px] border border-transparent px-2.5 py-2 data-[selected=true]:border-accent-line data-[selected=true]:bg-selected"
                  >
                    <span className="flex w-[46px] shrink-0 justify-center">
                      {hit.method ? <MethodPill method={hit.method} size="sm" /> : <Icon name={hit.kind === 'schema' ? 'box' : 'fields'} className="text-accent-text" />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className={`truncate ${hit.kind === 'field' ? 'font-mono text-xs' : 'text-[13px]'} text-fg-2`}><Highlight text={hit.title} query={query} /></span>
                      {hit.subtitle !== hit.title && <span className="truncate font-mono text-[11px] text-subtle">{hit.subtitle}</span>}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
          <div className="ad-scroll hidden w-[350px] shrink-0 overflow-y-auto bg-panel p-[18px] md:block">
            {activeOperation ? (
              <OperationPreview operation={activeOperation} />
            ) : active ? (
              <div className="flex flex-col gap-2">
                <span className="font-mono text-sm text-fg">{active.title}</span>
                <span className="font-mono text-xs text-accent-text">{active.subtitle}</span>
                <p className="text-xs text-subtle">Press ↵ to open the {active.kind === 'schema' ? 'model' : 'model containing this field'}.</p>
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-4 border-t border-line bg-panel px-4 py-2.5 text-[11px] text-subtle">
          <span className="flex items-center gap-1.5"><Kbd>↑↓</Kbd> navigate</span>
          <span className="flex items-center gap-1.5"><Kbd>↵</Kbd> open</span>
          <span className="hidden items-center gap-1.5 sm:flex"><Kbd>⌘↵</Kbd> playground</span>
          <span className="hidden items-center gap-1.5 sm:flex"><Kbd>tab</Kbd> scope</span>
          <span className="flex-1" />
          <span className="hidden text-faint sm:inline">Fuzzy · typo-tolerant · offline</span>
        </div>
      </Command>
    </div>
  )
}
