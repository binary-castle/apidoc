import { joinUrl, type OperationModel } from '@apidoc/core'
import { useEffect, useState, type ReactNode } from 'react'
import { renderMarkdown } from '../lib/markdown'
import { useDocs } from '../state'
import { ConsoleShortcutHint, RequestSample, ResponseSample } from './CodePanel'
import { Parameters } from './Parameters'
import { SchemaTree } from './SchemaTree'
import { Chip, CopyButton, Icon, MethodPill, Segmented, STATUS_DOT, STATUS_TEXT, statusTone } from './ui'

/** Highlight {params} inside a path. */
export function PathText({ path }: { path: string }) {
  return (
    <>
      {path.split(/(\{[^}]+\})/).map((part, index) =>
        part.startsWith('{') ? <span key={index} className="text-accent-text">{part}</span> : <span key={index}>{part}</span>,
      )}
    </>
  )
}

function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-[13px] font-semibold text-fg">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

function SecurityChips({ operation }: { operation: OperationModel }) {
  const { model } = useDocs()
  const requirements = operation.security.filter(r => r.schemes.length)
  if (!operation.security.length || !requirements.length) {
    return operation.security.length ? <Chip icon={<Icon name="lock" size={12} className="text-muted" />}>No auth required</Chip> : null
  }
  return (
    <>
      {requirements.map((requirement, index) => (
        <Chip key={index} icon={<Icon name="lock" size={12} className="text-ok" strokeWidth={2} />} title={index ? 'Alternative' : undefined}>
          {requirement.schemes
            .map(s => {
              const scheme = model.securitySchemes[s.name]
              const kind = scheme?.kind === 'http' ? scheme.scheme.charAt(0).toUpperCase() + scheme.scheme.slice(1) : scheme?.kind === 'apiKey' ? 'API key' : scheme?.kind === 'oauth2' ? 'OAuth2' : s.name
              return s.scopes.length ? `${kind} · ${s.scopes.join(', ')}` : kind
            })
            .join(' + ')}
        </Chip>
      ))}
    </>
  )
}

function RequestBodySection({ operation }: { operation: OperationModel }) {
  const body = operation.requestBody!
  const [mediaIndex, setMediaIndex] = useState(0)
  const [requiredOnly, setRequiredOnly] = useState(false)
  const media = body.content[mediaIndex] ?? body.content[0]
  return (
    <Section
      title={body.required ? 'Request body' : 'Request body (optional)'}
      actions={
        <>
          <Segmented value={requiredOnly ? 'required' : 'all'} onChange={v => setRequiredOnly(v === 'required')} options={[{ value: 'all', label: 'All' }, { value: 'required', label: 'Required' }]} />
          {body.content.length > 1 ? (
            <select value={mediaIndex} onChange={e => setMediaIndex(Number(e.target.value))} className="rounded-lg border border-line bg-card px-2 py-1 font-mono text-[11px] text-muted outline-none">
              {body.content.map((c, i) => <option key={c.mediaType} value={i}>{c.mediaType}</option>)}
            </select>
          ) : (
            media && <span className="rounded-lg border border-line px-2 py-1 font-mono text-[11px] text-muted">{media.mediaType}</span>
          )}
        </>
      }
    >
      {body.description && <div className="ad-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(body.description) }} />}
      <SchemaTree schema={media?.schema} mode="request" requiredOnly={requiredOnly} />
    </Section>
  )
}

function ResponsesSection({ operation }: { operation: OperationModel }) {
  const [active, setActive] = useState<string | undefined>(undefined)
  const response = operation.responses.find(r => r.status === active)
  const media = response?.content.find(c => /json/i.test(c.mediaType)) ?? response?.content[0]
  return (
    <Section title="Responses">
      <div className="flex flex-wrap gap-2">
        {operation.responses.map(r => {
          const tone = statusTone(r.status)
          const selected = r.status === active
          return (
            <button
              key={r.status}
              type="button"
              onClick={() => setActive(selected ? undefined : r.status)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${selected ? 'border-accent-line bg-accent-soft' : 'border-border hover:border-border-strong'}`}
            >
              <span className={`size-1.5 rounded-full ${STATUS_DOT[tone]}`} />
              <span className={`font-mono ${STATUS_TEXT[tone]}`}>{r.status}</span>
              <span className="max-w-[220px] truncate text-muted">{r.description?.split('\n')[0] ?? ''}</span>
            </button>
          )
        })}
      </div>
      {response && (
        <div className="flex flex-col gap-3">
          {response.description && <div className="ad-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(response.description) }} />}
          {response.headers.length > 0 && (
            <div className="flex flex-col gap-1">
              {response.headers.map(h => (
                <span key={h.name} className="text-xs text-muted"><code className="font-mono text-fg-2">{h.name}</code> {h.description}</span>
              ))}
            </div>
          )}
          {media ? <SchemaTree schema={media.schema} mode="response" /> : <p className="text-xs text-subtle">No response body.</p>}
        </div>
      )}
    </Section>
  )
}

export function OperationPage({ operation }: { operation: OperationModel }) {
  const { model, baseUrl, navigate, previousDiff, operationChange } = useDocs()
  const tag = model.tags.find(t => t.operations.includes(operation))
  const change = operationChange(operation.id)
  const releaseLabel = previousDiff?.to.version ? `v${previousDiff.to.version.replace(/^v/, '')}` : 'this release'
  const rateLimit = operation.extensions['x-rate-limit'] ?? operation.extensions['x-ratelimit-limit']

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        navigate({ view: 'playground', id: operation.id })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, operation.id])

  const content = (
    <div className="flex flex-col gap-7">
      <header className="flex flex-col gap-3.5">
        {tag && (
          <nav className="flex items-center gap-1.5 text-xs text-subtle">
            <span>{tag.displayName}</span>
            <Icon name="chevronRight" size={11} className="text-faint" />
            <span className="text-muted">{operation.summary ?? operation.path}</span>
          </nav>
        )}
        <h1 className={`text-[28px] font-semibold leading-tight tracking-[-0.02em] ${operation.deprecated ? 'text-muted' : 'text-fg-strong'}`}>
          {operation.summary ?? `${operation.method.toUpperCase()} ${operation.path}`}
        </h1>
        <div className="flex items-center gap-2.5 rounded-[10px] border border-border bg-card py-2 pl-2 pr-1.5">
          <MethodPill method={operation.method} />
          <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg"><PathText path={operation.path} /></code>
          <CopyButton text={joinUrl(baseUrl, operation.path)} label="" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SecurityChips operation={operation} />
          {typeof rateLimit === 'string' || typeof rateLimit === 'number' ? <Chip icon={<Icon name="zap" size={12} className="text-warn" strokeWidth={2} />}>{String(rateLimit)}</Chip> : null}
          {operation.parameters.some(p => p.name.toLowerCase() === 'idempotency-key') && <Chip>Idempotent</Chip>}
          {operation.deprecated && <Chip tone="err">Deprecated</Chip>}
          {change && previousDiff && (
            <button type="button" onClick={() => navigate({ view: 'changelog', from: previousDiff.from.version })}>
              <Chip tone={change === 'added' ? 'ok' : 'warn'}>
                {change === 'added' ? `New in ${releaseLabel}` : change === 'deprecated' ? `Deprecated in ${releaseLabel}` : `Changed in ${releaseLabel}`} · view diff
              </Chip>
            </button>
          )}
          {operation.operationId && <Chip><span className="font-mono">{operation.operationId}</span></Chip>}
        </div>
        {operation.description && <div className="ad-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(operation.description) }} />}
      </header>
      <Parameters parameters={operation.parameters} />
      {operation.requestBody && <RequestBodySection key={`body:${operation.id}`} operation={operation} />}
      {operation.responses.length > 0 && <ResponsesSection key={`responses:${operation.id}`} operation={operation} />}
    </div>
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="ad-scroll min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-6 pb-24 pt-8 lg:px-11">
          {content}
          <div className="mt-10 flex flex-col gap-3.5 xl:hidden">
            <RequestSample operation={operation} />
            <ResponseSample key={operation.id} operation={operation} />
          </div>
        </div>
      </div>
      <aside className="ad-scroll hidden w-[min(560px,40%)] shrink-0 flex-col gap-3.5 overflow-y-auto border-l border-line bg-panel p-5 xl:flex">
        <RequestSample operation={operation} />
        <ResponseSample key={operation.id} operation={operation} />
        <ConsoleShortcutHint />
      </aside>
    </div>
  )
}
