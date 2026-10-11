import { sampleFromSchema, typeLabel, type SchemaEntry } from '@apidoc/core'
import { useMemo } from 'react'
import { renderMarkdown } from '../lib/markdown'
import { useDocs } from '../state'
import { CodeBlock } from './CodeBlock'
import { SchemaTree } from './SchemaTree'
import { CopyButton, Icon, MethodText } from './ui'

export function SchemaPage({ entry }: { entry: SchemaEntry }) {
  const { model, resolver, navigate } = useDocs()
  const example = useMemo(() => JSON.stringify(sampleFromSchema(entry.schema, resolver, 'response'), null, 2), [entry, resolver])
  // Operations whose request or response references this schema (by $ref string match).
  const usedBy = useMemo(
    () => model.operations.filter(op => JSON.stringify([op.requestBody, op.responses]).includes(`"${entry.ref}"`)),
    [model, entry],
  )
  const description = resolver.schema(entry.schema).value?.description

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="ad-scroll min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[720px] flex-col gap-7 px-6 pb-24 pt-8 lg:px-11">
          <header className="flex flex-col gap-3">
            <nav className="flex items-center gap-1.5 text-xs text-subtle">
              <span>Models</span>
              <Icon name="chevronRight" size={11} className="text-faint" />
              <span className="text-muted">{entry.name}</span>
            </nav>
            <h1 className="font-mono text-[26px] font-semibold tracking-[-0.01em] text-fg-strong">{entry.name}</h1>
            <span className="font-mono text-xs text-subtle">{typeLabel(entry.schema, resolver).label}</span>
            {description && <div className="ad-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(description) }} />}
          </header>
          <SchemaTree schema={entry.schema} mode="response" />
          {usedBy.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-[13px] font-semibold text-fg">Used by</h2>
              <div className="flex flex-col rounded-[10px] border border-line">
                {usedBy.map((operation, index) => (
                  <button key={operation.id} type="button" onClick={() => navigate({ view: 'operation', id: operation.id })} className={`flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-hover ${index ? 'border-t border-line' : ''}`}>
                    <MethodText method={operation.method} className="w-10" />
                    <span className="font-mono text-xs text-fg-2">{operation.path}</span>
                    <span className="truncate text-xs text-subtle">{operation.summary}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
      <aside className="ad-scroll hidden w-[min(520px,38%)] shrink-0 overflow-y-auto border-l border-line bg-panel p-5 xl:block">
        <div className="relative overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center border-b border-line px-3.5 py-2.5 text-xs font-medium text-fg">Example</div>
          <CodeBlock code={example} language="json" className="px-4 py-3.5" />
          <CopyButton text={example} className="absolute right-2 top-1.5" />
        </div>
      </aside>
    </div>
  )
}
