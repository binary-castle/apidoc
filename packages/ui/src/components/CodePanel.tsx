import { exampleForMedia, generateSnippet, SNIPPET_TARGETS, type OperationModel } from '@apidoc/core'
import { useMemo, useState } from 'react'
import { defaultDraft, draftToRequest } from '../lib/draft'
import type { CodeLanguage } from '../lib/highlight'
import { readStored, writeStored } from '../lib/storage'
import { useDocs } from '../state'
import { CodeBlock } from './CodeBlock'
import { SchemaTree } from './SchemaTree'
import { CopyButton, Icon, Kbd, Segmented, STATUS_TEXT, statusTone } from './ui'

export function RequestSample({ operation }: { operation: OperationModel }) {
  const { model, resolver, baseUrl, credentials, navigate } = useDocs()
  const [target, setTarget] = useState(() => readStored('snippet-target', 'curl'))
  const snippet = useMemo(() => {
    const request = draftToRequest(operation, defaultDraft(operation, resolver), { baseUrl, model, resolver, credentials, placeholders: true })
    return generateSnippet(target, request)
  }, [operation, resolver, baseUrl, model, credentials, target])
  const language = (SNIPPET_TARGETS.find(t => t.id === target)?.language ?? 'shellscript') as CodeLanguage
  const authorized = Object.values(credentials).some(c => c.token || c.username || c.password)

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="ad-scroll flex items-center gap-0.5 overflow-x-auto border-b border-line px-2 pt-1">
        {SNIPPET_TARGETS.map(option => (
          <button
            key={option.id}
            type="button"
            onClick={() => {
              setTarget(option.id)
              writeStored('snippet-target', option.id)
            }}
            className={`-mb-px shrink-0 border-b-2 px-2.5 py-2 text-xs transition-colors ${target === option.id ? 'border-accent font-medium text-fg' : 'border-transparent text-subtle hover:text-fg-2'}`}
          >
            {option.label}
          </button>
        ))}
        <div className="flex-1" />
        <CopyButton text={snippet} label="Copy code" className="shrink-0" />
      </div>
      <CodeBlock code={snippet} language={language} className="max-h-[340px] px-4 py-3.5" />
      <div className="flex items-center gap-2.5 border-t border-line px-3 py-2.5">
        <span className="flex items-center gap-1.5 rounded-md bg-hover px-2 py-1 text-[11px] text-muted">
          <span className={`size-1.5 rounded-full ${authorized ? 'bg-ok' : 'bg-faint'}`} />
          {authorized ? 'Using your credentials' : 'Placeholders for credentials'}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => navigate({ view: 'playground', id: operation.id })}
          className="flex items-center gap-2 rounded-lg bg-accent py-1.5 pl-3 pr-2 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-hover"
        >
          <Icon name="play" size={11} filled strokeWidth={1.5} />
          Try it
          <span className="rounded bg-black/15 px-1 font-mono text-[10px] font-normal">⌘↵</span>
        </button>
      </div>
    </div>
  )
}

export function ResponseSample({ operation }: { operation: OperationModel }) {
  const { resolver } = useDocs()
  const withContent = operation.responses.filter(r => r.content.length)
  const [status, setStatus] = useState(withContent[0]?.status)
  const [view, setView] = useState<'example' | 'schema'>('example')
  const response = withContent.find(r => r.status === status) ?? withContent[0]
  const media = response?.content.find(c => /json/i.test(c.mediaType)) ?? response?.content[0]
  const example = useMemo(() => (media ? exampleForMedia(media, resolver, 'response') : undefined), [media, resolver])
  const isJson = media ? /json/i.test(media.mediaType) : false
  const text = example === undefined ? '' : isJson || typeof example !== 'string' ? JSON.stringify(example, null, 2) : example

  if (!response) {
    const first = operation.responses[0]
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3.5 text-xs text-subtle">
        {first ? <><span className={`font-mono ${STATUS_TEXT[statusTone(first.status)]}`}>{first.status}</span> {first.description ?? ''} · no body</> : 'No documented responses.'}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2.5">
        <span className="text-xs font-medium text-fg">Example response</span>
        <div className="flex-1" />
        <div className="flex gap-0.5 rounded-lg bg-panel p-0.5">
          {withContent.map(r => (
            <button
              key={r.status}
              type="button"
              onClick={() => setStatus(r.status)}
              className={`rounded-md px-2 py-0.5 font-mono text-[11px] ${r.status === response.status ? `bg-active ${STATUS_TEXT[statusTone(r.status)]}` : 'text-subtle hover:text-fg-2'}`}
            >
              {r.status}
            </button>
          ))}
        </div>
        <Segmented value={view} onChange={setView} options={[{ value: 'example', label: isJson ? 'JSON' : 'Example' }, { value: 'schema', label: 'Schema' }]} />
      </div>
      {view === 'example' ? (
        <div className="relative">
          <CodeBlock code={text || '// no example'} language={isJson ? 'json' : 'yaml'} className="max-h-[420px] px-4 py-3.5" />
          {text && <CopyButton text={text} className="absolute right-2 top-2" />}
        </div>
      ) : (
        <div className="ad-scroll max-h-[420px] overflow-auto p-3.5">
          <SchemaTree schema={media?.schema} mode="response" />
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-line px-3.5 py-2 text-[11px] text-subtle">
        <span className="font-mono">{media?.mediaType}</span>
        {response.description && <span className="truncate">· {response.description}</span>}
      </div>
    </div>
  )
}

export function ConsoleShortcutHint() {
  return (
    <p className="flex items-center gap-1.5 px-1 text-[11px] text-subtle">
      <Kbd>⌘K</Kbd> search everything · <Kbd>⌘↵</Kbd> try this endpoint
    </p>
  )
}
