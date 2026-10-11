import { useEffect, useRef, useState } from 'react'
import { readStored, writeStored } from '../lib/storage'
import { useDocs } from '../state'
import { Icon, MethodText, Tag } from './ui'

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { model, route, navigate, previousDiff, operationChange, arazzo } = useDocs()
  const storageKey = `${model.info.title}:collapsed`
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => readStored(storageKey, {}))
  const activeRef = useRef<HTMLButtonElement>(null)

  const activeOperation = route.view === 'operation' || route.view === 'playground' ? route.id : undefined
  const activeSchema = route.view === 'schema' ? route.name : undefined

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeOperation, activeSchema])

  const toggle = (name: string) =>
    setCollapsed(current => {
      const next = { ...current, [name]: !current[name] }
      writeStored(storageKey, next)
      return next
    })

  const go = (target: Parameters<typeof navigate>[0]) => {
    navigate(target.view === 'operation' && route.view === 'playground' ? { view: 'playground', id: target.id } : target)
    onNavigate?.()
  }

  const total = model.operations.length
  return (
    <nav className="ad-scroll flex h-full w-[260px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-line bg-panel px-3 pb-3 pt-4">
      <div className="flex flex-col gap-px">
        <button type="button" onClick={() => go({ view: 'intro' })} className={`flex items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left text-[13px] ${route.view === 'intro' ? 'bg-selected text-fg' : 'text-fg-2 hover:bg-hover'}`}>
          <Icon name="book" className="text-muted" />
          Introduction
        </button>
        {Object.keys(model.securitySchemes).length > 0 && (
          <button type="button" onClick={() => go({ view: 'intro' })} className="flex items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left text-[13px] text-fg-2 hover:bg-hover">
            <Icon name="lock" className="text-muted" />
            Authentication
          </button>
        )}
        <button type="button" onClick={() => go({ view: 'changelog' })} className={`flex items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left text-[13px] ${route.view === 'changelog' ? 'bg-selected text-fg' : 'text-fg-2 hover:bg-hover'}`}>
          <Icon name="clock" className="text-muted" />
          <span className="flex-1">Changelog</span>
          {previousDiff && previousDiff.operations.length > 0 && (
            previousDiff.counts.breaking > 0
              ? <Tag tone="err">{previousDiff.counts.breaking} breaking</Tag>
              : <Tag tone="accent">{previousDiff.operations.length} changed</Tag>
          )}
        </button>
      </div>

      {arazzo.status === 'ready' && (
        <div className="flex flex-col gap-px">
          <button type="button" onClick={() => toggle('__workflows')} className="flex items-center gap-1.5 px-2 pb-1 text-left">
            <Icon name={collapsed.__workflows ? 'chevronRight' : 'chevronDown'} size={11} strokeWidth={2.4} className="text-subtle" />
            <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-subtle">Workflows</span>
            <span className="font-mono text-[10px] text-faint">{arazzo.value.doc.workflows.length}</span>
          </button>
          {!collapsed.__workflows &&
            arazzo.value.doc.workflows.map(workflow => {
              const active = route.view === 'workflow' && (route.id ?? arazzo.value.doc.workflows[0]!.workflowId) === workflow.workflowId
              return (
                <button
                  key={workflow.workflowId}
                  type="button"
                  onClick={() => go({ view: 'workflow', id: workflow.workflowId })}
                  className={`flex items-center gap-2 rounded-[7px] border px-2 py-1.5 text-left ${active ? 'border-selected-line bg-selected' : 'border-transparent hover:bg-hover'}`}
                >
                  <span className="flex w-10 shrink-0 justify-center"><Icon name="play" size={10} filled className="text-accent-text" /></span>
                  <span className={`flex-1 truncate text-[13px] ${active ? 'font-medium text-fg-strong' : 'text-fg-2'}`}>{workflow.summary ?? workflow.workflowId}</span>
                  <span className="font-mono text-[10px] text-faint" title={`${workflow.steps.length} steps`}>{workflow.steps.length}</span>
                </button>
              )
            })}
        </div>
      )}

      {model.tags.map(tag => {
        const isCollapsed = collapsed[tag.name] ?? false
        return (
          <div key={tag.name} className="flex flex-col gap-px">
            <button type="button" onClick={() => toggle(tag.name)} className="flex items-center gap-1.5 px-2 pb-1 text-left">
              <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} size={11} strokeWidth={2.4} className="text-subtle" />
              <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.04em] text-subtle">{tag.displayName}</span>
              <span className="font-mono text-[10px] text-faint">{tag.operations.length}</span>
            </button>
            {!isCollapsed &&
              tag.operations.map(operation => {
                const active = operation.id === activeOperation
                return (
                  <button
                    key={operation.id}
                    ref={active ? activeRef : undefined}
                    type="button"
                    onClick={() => go({ view: 'operation', id: operation.id })}
                    className={`flex items-center gap-2 rounded-[7px] border px-2 py-1.5 text-left transition-colors ${
                      active ? 'border-selected-line bg-selected' : 'border-transparent hover:bg-hover'
                    }`}
                  >
                    <MethodText method={operation.method} className="w-10 shrink-0" />
                    <span className={`flex-1 truncate text-[13px] ${operation.deprecated ? 'text-subtle line-through decoration-faint' : active ? 'font-medium text-fg-strong' : 'text-fg-2'}`}>
                      {operation.summary ?? operation.path}
                    </span>
                    {operation.deprecated ? (
                      <Tag tone="err">DEPRECATED</Tag>
                    ) : operationChange(operation.id) === 'added' ? (
                      <Tag tone="ok">NEW</Tag>
                    ) : operationChange(operation.id) === 'changed' ? (
                      <span className="size-1.5 shrink-0 rounded-full bg-warn" title="Changed since the previous release" />
                    ) : null}
                  </button>
                )
              })}
          </div>
        )
      })}

      {model.schemas.length > 0 && (
        <div className="flex flex-col gap-px">
          <button type="button" onClick={() => toggle('__models')} className="flex items-center gap-1.5 px-2 pb-1 text-left">
            <Icon name={collapsed.__models ?? true ? 'chevronRight' : 'chevronDown'} size={11} strokeWidth={2.4} className="text-subtle" />
            <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-subtle">Models</span>
            <span className="font-mono text-[10px] text-faint">{model.schemas.length}</span>
          </button>
          {!(collapsed.__models ?? true) &&
            model.schemas.map(schema => (
              <button
                key={schema.name}
                ref={schema.name === activeSchema ? activeRef : undefined}
                type="button"
                onClick={() => go({ view: 'schema', name: schema.name })}
                className={`flex items-center gap-2 rounded-[7px] px-2 py-1.5 text-left font-mono text-xs ${schema.name === activeSchema ? 'bg-selected text-fg' : 'text-fg-2 hover:bg-hover'}`}
              >
                <Icon name="box" size={13} className="text-accent-text" />
                <span className="truncate">{schema.name}</span>
              </button>
            ))}
        </div>
      )}

      <div className="flex-1" />
      <div className="flex flex-col gap-1 rounded-[10px] border border-line bg-card p-3">
        <span className="text-[11px] text-subtle">
          {model.sourceFormat === 'swagger2' ? 'Swagger 2.0 (upgraded)' : `OpenAPI ${model.specVersion}`} · {total} operation{total === 1 ? '' : 's'}
        </span>
      </div>
    </nav>
  )
}
