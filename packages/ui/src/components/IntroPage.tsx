import { renderMarkdown } from '../lib/markdown'
import { useDocs } from '../state'
import { AuthPanel } from './Topbar'
import { MethodText } from './ui'

export function IntroPage() {
  const { model, navigate, baseUrl } = useDocs()
  return (
    <div className="ad-scroll flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[760px] flex-col gap-10 px-6 pb-24 pt-10 lg:px-11">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
            {model.info.version && <span className="font-mono">v{model.info.version.replace(/^v/, '')}</span>}
            <span>·</span>
            <span>{model.sourceFormat === 'swagger2' ? 'Swagger 2.0, upgraded to OpenAPI 3' : `OpenAPI ${model.specVersion}`}</span>
          </div>
          <h1 className="text-[34px] font-semibold leading-tight tracking-[-0.02em] text-fg-strong">{model.info.title}</h1>
          {model.info.summary && <p className="text-base text-body">{model.info.summary}</p>}
          {model.info.description && <div className="ad-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(model.info.description) }} />}
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="text-[13px] font-semibold text-fg">Base URL</h2>
          <code className="rounded-[10px] border border-border bg-card px-3.5 py-2.5 font-mono text-[13px] text-fg">{baseUrl}</code>
        </section>

        {Object.keys(model.securitySchemes).length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-[13px] font-semibold text-fg">Authentication</h2>
            <div className="rounded-xl border border-border bg-card p-4">
              <AuthPanel />
            </div>
          </section>
        )}

        <section className="flex flex-col gap-4">
          <h2 className="text-[13px] font-semibold text-fg">Endpoints</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {model.tags.map(tag => (
              <div key={tag.name} className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
                <span className="text-sm font-semibold text-fg">{tag.displayName}</span>
                {tag.description && <p className="line-clamp-2 text-xs leading-5 text-muted">{tag.description}</p>}
                <div className="mt-1 flex flex-col gap-0.5">
                  {tag.operations.slice(0, 6).map(operation => (
                    <button key={operation.id} type="button" onClick={() => navigate({ view: 'operation', id: operation.id })} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-hover">
                      <MethodText method={operation.method} className="w-10" />
                      <span className="truncate text-[13px] text-fg-2">{operation.summary ?? operation.path}</span>
                    </button>
                  ))}
                  {tag.operations.length > 6 && <span className="px-1.5 text-xs text-subtle">+{tag.operations.length - 6} more</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
