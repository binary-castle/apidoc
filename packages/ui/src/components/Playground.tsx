import { generateSnippet, type HttpMethod, type OperationModel, type ParameterModel } from '@apidoc/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { bodyForMedia, defaultDraft, draftToRequest, type Draft } from '../lib/draft'
import { readStored, writeStored } from '../lib/storage'
import { blockedHeaders, formatBytes, formatMs, sendRequest, type SendFailure, type SendResult } from '../lib/send'
import { useDocs } from '../state'
import { CodeBlock } from './CodeBlock'
import { PathText } from './OperationPage'
import { AuthPanel } from './Topbar'
import { CopyButton, Icon, MethodPill, MethodText, STATUS_DOT, STATUS_TEXT, statusTone } from './ui'

/** Headers that may carry secrets are never written to history. */
const SECRET_HEADER = /authorization|cookie|api[-_]?key|token|secret|password/i

const withoutSecrets = (draft: Draft): Draft => ({
  ...draft,
  headers: Object.fromEntries(Object.entries(draft.headers).filter(([name]) => !SECRET_HEADER.test(name))),
  cookies: {},
})

interface HistoryEntry {
  id: string
  operationId: string
  method: HttpMethod
  path: string
  status?: number
  error?: string
  durationMs: number
  at: number
  draft: Draft
}

const HISTORY_LIMIT = 50
type Tab = 'params' | 'headers' | 'body' | 'auth'

const fieldClass = 'w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs text-fg outline-none placeholder:text-faint focus:border-accent-line'

function timeAgo(at: number) {
  const seconds = Math.round((Date.now() - at) / 1000)
  if (seconds < 45) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`
  return new Date(at).toLocaleDateString()
}

function ParamInputs({ parameters, values, onChange }: { parameters: ParameterModel[]; values: Record<string, string>; onChange: (name: string, value: string) => void }) {
  const { resolver } = useDocs()
  return (
    <div className="flex flex-col gap-3.5">
      {parameters.map(parameter => {
        const schema = resolver.schema(parameter.schema).value
        const options = schema?.enum ?? (schema?.items ? resolver.schema(schema.items).value?.enum : undefined)
        const value = values[parameter.name] ?? ''
        const missing = parameter.required && !value
        return (
          <label key={`${parameter.in}:${parameter.name}`} className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-xs font-medium text-fg">{parameter.name}</span>
              {parameter.required && <span className="text-[11px] text-err">*</span>}
              <span className="font-mono text-[11px] text-subtle">{parameter.in} · {schema?.type ? String(schema.type) : 'string'}{schema?.type === 'array' ? ' (comma-separated)' : ''}</span>
            </span>
            {options && schema?.type !== 'array' ? (
              <select className={fieldClass} value={value} onChange={e => onChange(parameter.name, e.target.value)}>
                {!parameter.required && <option value="">—</option>}
                {options.map(option => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
              </select>
            ) : (
              <input
                className={`${fieldClass} ${missing ? '!border-err-line' : ''}`}
                value={value}
                placeholder={parameter.description ?? (options ? options.join(',') : '')}
                onChange={e => onChange(parameter.name, e.target.value)}
              />
            )}
          </label>
        )
      })}
    </div>
  )
}

function HeaderEditor({ headers, onChange }: { headers: Record<string, string>; onChange: (headers: Record<string, string>) => void }) {
  const rows = Object.entries(headers)
  const update = (index: number, key: string, value: string) => {
    const next = [...rows]
    next[index] = [key, value]
    onChange(Object.fromEntries(next))
  }
  return (
    <div className="flex flex-col gap-2">
      {rows.map(([key, value], index) => (
        <div key={index} className="flex gap-2">
          <input className={`${fieldClass} !text-accent-text`} value={key} placeholder="Header" onChange={e => update(index, e.target.value, value)} />
          <input className={fieldClass} value={value} placeholder="value" onChange={e => update(index, key, e.target.value)} />
          <button type="button" onClick={() => onChange(Object.fromEntries(rows.filter((_, i) => i !== index)))} className="shrink-0 rounded-lg border border-border px-2.5 text-muted hover:text-err" aria-label="Remove header">
            <Icon name="x" size={13} />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange({ ...headers, '': '' })} className="flex w-fit items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted hover:text-fg">
        <Icon name="plus" size={12} /> Add header
      </button>
    </div>
  )
}

function ResponseView({ result, request }: { result: SendResult | SendFailure | undefined; request: ReturnType<typeof draftToRequest> }) {
  const [tab, setTab] = useState<'body' | 'headers' | 'curl'>('body')
  if (!result) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <span className="text-sm text-muted">Send the request to see the response</span>
        <span className="text-xs text-subtle">⌘↵ sends from anywhere on this page</span>
      </div>
    )
  }
  if (!result.ok) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-err-line bg-err-bg p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-err-text">
          <Icon name="alert" size={15} /> {result.kind === 'aborted' ? 'Cancelled' : 'Request failed'}
        </div>
        <p className="text-[13px] leading-5 text-fg-2">{result.message}</p>
        {result.kind === 'network' && (
          <ul className="list-disc pl-5 text-xs leading-5 text-muted">
            <li>Serve the docs from the same domain as the API (the Django/FastAPI integrations do this), or</li>
            <li>allow this origin in the API's CORS settings, or</li>
            <li>copy the request as cURL and run it from a terminal.</li>
          </ul>
        )}
        <CopyButton text={generateSnippet('curl', request)} label="Copy as cURL" className="w-fit border border-border" />
      </div>
    )
  }
  const tone = statusTone(result.status)
  const pretty = result.json !== undefined ? JSON.stringify(result.json, null, 2) : result.body
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`flex items-center gap-2 rounded-lg border px-2.5 py-1 ${tone === 'ok' ? 'border-ok-line bg-ok-bg' : tone === 'warn' ? 'border-warn-line bg-warn-bg' : 'border-err-line bg-err-bg'}`}>
          <span className={`size-1.5 rounded-full ${STATUS_DOT[tone]}`} />
          <span className={`font-mono text-[13px] font-semibold ${STATUS_TEXT[tone]}`}>{result.status}</span>
          {result.statusText && <span className="text-xs text-fg-2">{result.statusText}</span>}
        </span>
        <span className="font-mono text-xs text-fg-2">{formatMs(result.durationMs)}</span>
        <span className="text-subtle">·</span>
        <span className="font-mono text-xs text-fg-2">{formatBytes(result.sizeBytes)}</span>
        <div className="flex-1" />
        <CopyButton text={pretty} label="Copy body" className="border border-border" />
      </div>
      <div className="flex gap-4 border-b border-line">
        {(['body', 'headers', 'curl'] as const).map(name => (
          <button key={name} type="button" onClick={() => setTab(name)} className={`-mb-px border-b-2 pb-2 text-[13px] ${tab === name ? 'border-accent font-medium text-fg' : 'border-transparent text-subtle hover:text-fg-2'}`}>
            {name === 'body' ? 'Body' : name === 'headers' ? `Headers ${result.headers.length}` : 'cURL'}
          </button>
        ))}
      </div>
      {tab === 'body' && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
          <CodeBlock code={pretty || '(empty body)'} language={result.json !== undefined ? 'json' : 'text'} className="h-full px-4 py-3.5" />
        </div>
      )}
      {tab === 'headers' && (
        <div className="ad-scroll flex flex-col overflow-auto rounded-xl border border-border bg-card">
          {result.headers.map(([name, value], index) => (
            <div key={name + index} className={`flex gap-3 px-3.5 py-2 font-mono text-xs ${index ? 'border-t border-line' : ''}`}>
              <span className="w-48 shrink-0 text-accent-text">{name}</span>
              <span className="break-all text-fg-2">{value}</span>
            </div>
          ))}
          {!result.headers.length && <p className="p-3.5 text-xs text-subtle">The browser only exposes CORS-safelisted headers for cross-origin responses.</p>}
        </div>
      )}
      {tab === 'curl' && (
        <div className="relative overflow-hidden rounded-xl border border-border bg-card">
          <CodeBlock code={generateSnippet('curl', request)} language="shellscript" className="px-4 py-3.5" />
          <CopyButton text={generateSnippet('curl', request)} className="absolute right-2 top-2" />
        </div>
      )}
    </div>
  )
}

function Workbench({ operation, initialDraft, onSent }: { operation: OperationModel; initialDraft?: Draft; onSent: (entry: HistoryEntry) => void }) {
  const { model, resolver, baseUrl, credentials } = useDocs()
  const [draft, setDraft] = useState<Draft>(() => initialDraft ?? defaultDraft(operation, resolver))
  const [tab, setTab] = useState<Tab>(() => (operation.requestBody ? 'body' : 'params'))
  const [result, setResult] = useState<SendResult | SendFailure>()
  const [sending, setSending] = useState(false)
  const abort = useRef<AbortController>(undefined)

  const request = useMemo(() => draftToRequest(operation, draft, { baseUrl, model, credentials }), [operation, draft, baseUrl, model, credentials])
  const paramList = operation.parameters.filter(p => p.in !== 'header')
  const headerParams = operation.parameters.filter(p => p.in === 'header')
  const missing = operation.parameters.filter(p => p.required && !{ path: draft.pathParams, query: draft.query, header: draft.headers, cookie: draft.cookies }[p.in][p.name])
  const isJsonBody = draft.contentType ? /json/i.test(draft.contentType) : false
  const jsonError = useMemo(() => {
    if (!isJsonBody || !draft.body.trim()) return undefined
    try {
      JSON.parse(draft.body)
      return undefined
    } catch (error) {
      return (error as Error).message
    }
  }, [draft.body, isJsonBody])
  const blocked = blockedHeaders(request)

  const send = async () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setSending(true)
    const outcome = await sendRequest(request, controller.signal)
    if (abort.current !== controller) return
    setSending(false)
    setResult(outcome)
    onSent({
      id: `${Date.now()}`,
      operationId: operation.id,
      method: operation.method,
      path: operation.path,
      status: outcome.ok ? outcome.status : undefined,
      error: outcome.ok ? undefined : outcome.kind,
      durationMs: outcome.durationMs,
      at: Date.now(),
      draft: withoutSecrets(draft),
    })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void send()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(() => () => abort.current?.abort(), [])

  const setParam = (location: ParameterModel['in'], name: string, value: string) =>
    setDraft(current => {
      const key = ({ path: 'pathParams', query: 'query', header: 'headers', cookie: 'cookies' } as const)[location]
      return { ...current, [key]: { ...current[key], [name]: value } }
    })

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <section className="ad-scroll flex min-w-0 flex-col gap-4 overflow-y-auto p-5 lg:w-[52%] lg:max-w-[620px]">
        <div className="flex items-center rounded-[10px] border border-selected-line bg-card">
          <span className="border-r border-line px-3 py-2.5"><MethodText method={operation.method} className="!text-xs" /></span>
          <code className="min-w-0 flex-1 truncate px-3 font-mono text-[13px] text-fg" title={request.url}>{request.url.replace(baseUrl, '') || '/'}</code>
          <button
            type="button"
            onClick={() => (sending ? abort.current?.abort() : void send())}
            className="m-1 flex items-center gap-2 rounded-[7px] bg-accent py-1.5 pl-3 pr-2 text-xs font-semibold text-on-accent hover:bg-accent-hover"
          >
            {sending ? 'Cancel' : 'Send'}
            <span className="rounded bg-black/15 px-1 font-mono text-[10px] font-normal">⌘↵</span>
          </button>
        </div>
        <p className="-mt-2 truncate px-1 font-mono text-[11px] text-subtle" title={request.url}>{request.url}</p>

        <div className="flex items-center gap-[18px] border-b border-line">
          {(['params', 'headers', 'body', 'auth'] as const).map(name => {
            if (name === 'body' && !operation.requestBody) return null
            const count = name === 'params' ? paramList.length : name === 'headers' ? Object.keys(draft.headers).length : 0
            return (
              <button key={name} type="button" onClick={() => setTab(name)} className={`-mb-px border-b-2 pb-2 text-[13px] capitalize ${tab === name ? 'border-accent font-medium text-fg' : 'border-transparent text-subtle hover:text-fg-2'}`}>
                {name}
                {count > 0 && <span className="ml-1.5 text-subtle">{count}</span>}
              </button>
            )
          })}
        </div>

        {tab === 'params' && (paramList.length ? <ParamInputs parameters={paramList} values={{ ...draft.pathParams, ...draft.query, ...draft.cookies }} onChange={(name, value) => setParam(paramList.find(p => p.name === name)!.in, name, value)} /> : <p className="text-xs text-subtle">This endpoint takes no path or query parameters.</p>)}
        {tab === 'headers' && (
          <div className="flex flex-col gap-4">
            {headerParams.length > 0 && <ParamInputs parameters={headerParams} values={draft.headers} onChange={(name, value) => setParam('header', name, value)} />}
            <HeaderEditor headers={Object.fromEntries(Object.entries(draft.headers).filter(([k]) => !headerParams.some(p => p.name === k)))} onChange={extra => setDraft(current => ({ ...current, headers: { ...Object.fromEntries(Object.entries(current.headers).filter(([k]) => headerParams.some(p => p.name === k))), ...extra } }))} />
          </div>
        )}
        {tab === 'body' && operation.requestBody && (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <select
                value={draft.contentType}
                onChange={e => {
                  const media = operation.requestBody!.content.find(c => c.mediaType === e.target.value)
                  setDraft(current => ({ ...current, contentType: e.target.value, body: bodyForMedia(media, resolver) }))
                }}
                className="rounded-lg border border-line bg-card px-2 py-1 font-mono text-[11px] text-muted outline-none"
              >
                {operation.requestBody.content.map(c => <option key={c.mediaType}>{c.mediaType}</option>)}
              </select>
              <div className="flex-1" />
              <button type="button" onClick={() => setDraft(current => ({ ...current, body: bodyForMedia(operation.requestBody!.content.find(c => c.mediaType === current.contentType), resolver) }))} className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg">
                <Icon name="sparkles" size={12} className="text-accent-text" /> Reset to example
              </button>
              {isJsonBody && draft.body.trim() && !jsonError && (
                <button type="button" onClick={() => setDraft(current => ({ ...current, body: JSON.stringify(JSON.parse(current.body), null, 2) }))} className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg">Format</button>
              )}
            </div>
            <textarea
              value={draft.body}
              onChange={e => setDraft(current => ({ ...current, body: e.target.value }))}
              spellCheck={false}
              className={`ad-scroll min-h-[280px] flex-1 resize-y rounded-xl border bg-card p-3.5 font-mono text-xs leading-5 text-fg outline-none focus:border-accent-line ${jsonError ? 'border-err-line' : 'border-border'}`}
            />
            {jsonError && <p className="flex items-center gap-1.5 text-xs text-err"><Icon name="alert" size={12} /> Invalid JSON: {jsonError}</p>}
          </div>
        )}
        {tab === 'auth' && <AuthPanel />}

        {(missing.length > 0 || blocked.length > 0) && (
          <div className="flex flex-col gap-1 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-xs text-warn-text">
            {missing.length > 0 && <span>Missing required: {missing.map(p => p.name).join(', ')}</span>}
            {blocked.length > 0 && <span>Browsers don't allow setting {blocked.join(', ')}; it will be dropped.</span>}
          </div>
        )}
      </section>
      <section className="flex min-h-[360px] min-w-0 flex-1 flex-col border-t border-line bg-panel p-5 lg:border-l lg:border-t-0">
        <ResponseView result={result} request={request} />
      </section>
    </div>
  )
}

export function Playground({ operationId }: { operationId?: string }) {
  const { model, operationById, navigate } = useDocs()
  const historyKey = `${model.info.title}:history`
  const [history, setHistory] = useState<HistoryEntry[]>(() => readStored(historyKey, []))
  const [restored, setRestored] = useState<{ entry: HistoryEntry; nonce: number }>()
  const operation = operationId ? operationById(operationId) : undefined

  const record = (entry: HistoryEntry) =>
    setHistory(current => {
      const next = [entry, ...current].slice(0, HISTORY_LIMIT)
      writeStored(historyKey, next)
      return next
    })

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <aside className="ad-scroll hidden w-[260px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-line bg-panel p-3 lg:flex">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold tracking-wide text-subtle">HISTORY</span>
          {history.length > 0 && (
            <button type="button" onClick={() => { setHistory([]); writeStored(historyKey, []) }} className="text-[11px] text-subtle hover:text-err">Clear</button>
          )}
        </div>
        {!history.length && <p className="px-1 text-xs leading-5 text-subtle">Requests you send appear here. They stay in this browser.</p>}
        {history.map(entry => {
          const tone = entry.status ? statusTone(entry.status) : 'err'
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                setRestored({ entry, nonce: Date.now() })
                navigate({ view: 'playground', id: entry.operationId })
              }}
              className="flex flex-col gap-1 rounded-lg border border-transparent px-2.5 py-2 text-left hover:border-line hover:bg-hover"
            >
              <span className="flex items-center gap-2">
                <MethodText method={entry.method} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-2">{entry.path}</span>
                <span className={`font-mono text-[11px] ${STATUS_TEXT[tone]}`}>{entry.status ?? 'ERR'}</span>
              </span>
              <span className="text-[11px] text-subtle">{timeAgo(entry.at)} · {formatMs(entry.durationMs)}</span>
            </button>
          )
        })}
        <div className="flex-1" />
        <p className="rounded-[10px] border border-line bg-card p-3 text-[11px] leading-4 text-subtle">History is stored in this browser only. Credentials are never saved with it.</p>
      </aside>
      {operation ? (
        <Workbench
          key={`${operation.id}:${restored?.entry.operationId === operation.id ? restored.nonce : ''}`}
          operation={operation}
          initialDraft={restored?.entry.operationId === operation.id ? restored.entry.draft : undefined}
          onSent={record}
        />
      ) : (
        <div className="ad-scroll flex flex-1 flex-col gap-4 overflow-y-auto p-8">
          <h1 className="text-xl font-semibold text-fg-strong">Pick an endpoint to try</h1>
          <div className="grid max-w-[900px] gap-1.5 md:grid-cols-2">
            {model.operations.map(op => (
              <button key={op.id} type="button" onClick={() => navigate({ view: 'playground', id: op.id })} className="flex items-center gap-3 rounded-lg border border-line bg-card px-3 py-2.5 text-left hover:border-border-strong">
                <MethodPill method={op.method} size="sm" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] text-fg">{op.summary ?? op.path}</span>
                  <span className="truncate font-mono text-[11px] text-subtle"><PathText path={op.path} /></span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
