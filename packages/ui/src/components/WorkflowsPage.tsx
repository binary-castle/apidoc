import {
  applyAuth,
  applyCsrf,
  checkResponse,
  defaultInputs,
  exportWorkflow,
  findOperation,
  isExpression,
  runWorkflow,
  type ArazzoDocument,
  type ArazzoStep,
  type ArazzoWorkflow,
  type HttpMethod,
  type HttpRequestSpec,
  type StepResponse,
  type StepRun,
  type WorkflowExportFormat,
  type WorkflowRun,
} from '@apidoc/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { pickSecurity } from '../lib/draft'
import { formatMs, sendRequest } from '../lib/send'
import { useDocs } from '../state'
import { CodeBlock } from './CodeBlock'
import { PathText } from './OperationPage'
import { CopyButton, Icon, MethodPill, STATUS_TEXT, statusTone, Tag } from './ui'

type ExportTab = WorkflowExportFormat | 'arazzo'

const EXPORT_TABS: { id: ExportTab; label: string; language: 'javascript' | 'python' | 'text' | 'yaml' }[] = [
  { id: 'typescript', label: 'TypeScript', language: 'javascript' },
  { id: 'python', label: 'Python', language: 'python' },
  { id: 'http', label: '.http', language: 'text' },
  { id: 'arazzo', label: 'Arazzo', language: 'yaml' },
]

const fieldClass = 'w-full rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-xs text-fg outline-none placeholder:text-faint focus:border-accent-line'

/** Expressions a step reads from inputs or earlier steps (shown as "uses" chips). */
function referencedExpressions(step: ArazzoStep): string[] {
  const found = new Set<string>()
  const visit = (value: unknown) => {
    if (isExpression(value)) {
      if (/^\$(inputs|steps)\./.test(value)) found.add(value)
    } else if (typeof value === 'string') {
      for (const match of value.matchAll(/\{(\$(?:inputs|steps)\.[^{}]+)\}/g)) found.add(match[1]!)
    } else if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  for (const parameter of step.parameters ?? []) visit('value' in parameter ? parameter.value : undefined)
  visit(step.requestBody?.payload)
  return [...found]
}

const preview = (value: unknown) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 36 ? `${text.slice(0, 33)}…` : text
}

function StatusDot({ status }: { status: StepRun['status'] }) {
  const base = 'flex size-7 shrink-0 items-center justify-center rounded-full border'
  switch (status) {
    case 'passed':
      return <span className={`${base} border-ok-line bg-ok-bg`}><Icon name="check" size={13} strokeWidth={2.6} className="text-ok" /></span>
    case 'failed':
      return <span className={`${base} border-err-line bg-err-bg`}><Icon name="x" size={13} strokeWidth={2.6} className="text-err" /></span>
    case 'running':
      return <span className={`${base} border-accent bg-accent-soft`}><span className="size-2 animate-pulse rounded-full bg-accent" /></span>
    case 'waiting':
      return <span className={`${base} border-warn-line bg-warn-bg`}><Icon name="clock" size={13} className="text-warn" /></span>
    case 'skipped':
      return <span className={`${base} border-line bg-panel`}><span className="size-1.5 rounded-full bg-faint" /></span>
    default:
      return <span className={`${base} border-border bg-card`}><span className="size-1.5 rounded-full bg-subtle" /></span>
  }
}

function StepCard({ step, index, result, paused, last }: { step: ArazzoStep; index: number; result?: StepRun; paused: boolean; last: boolean }) {
  const { model, resolver } = useDocs()
  const operation = useMemo(() => findOperation(step, model), [step, model])
  const uses = useMemo(() => referencedExpressions(step), [step])
  const [open, setOpen] = useState(false)
  const status = result?.status ?? 'pending'
  const response = result?.response
  const contract = useMemo(
    () => (operation && response ? checkResponse(operation, { status: response.status, contentType: response.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '', body: response.body, json: response.json }, resolver) : undefined),
    [operation, response, resolver],
  )
  const criteria = result?.criteria.length ? result.criteria : (step.successCriteria ?? []).map(c => ({ condition: c.condition, passed: undefined as boolean | undefined, error: undefined }))
  const active = status === 'running' || paused

  return (
    <div className="flex gap-4">
      <div className="flex w-7 flex-col items-center">
        <StatusDot status={paused ? 'pending' : status} />
        {!last && <span className={`w-0.5 flex-1 ${status === 'passed' ? 'bg-ok-line' : 'bg-border'}`} />}
      </div>
      <div className={`mb-3.5 flex min-w-0 flex-1 flex-col gap-2.5 rounded-xl border p-3.5 ${active ? 'border-accent-line bg-selected' : 'border-border bg-card'} ${status === 'skipped' ? 'opacity-60' : ''}`}>
        <div className="flex flex-wrap items-center gap-2.5">
          {operation ? <MethodPill method={operation.method as HttpMethod} size="sm" /> : <Tag tone="accent">WORKFLOW</Tag>}
          <code className="min-w-0 truncate font-mono text-[13px] text-fg">{operation ? <PathText path={operation.path} /> : step.workflowId}</code>
          <span className="font-mono text-xs text-subtle">{step.stepId}</span>
          <span className="flex-1" />
          {paused && <span className="text-xs text-accent-text">Next up</span>}
          {status === 'waiting' && <span className="text-xs text-warn">Retrying…</span>}
          {response && <span className={`font-mono text-xs ${STATUS_TEXT[statusTone(response.status)]}`}>{response.status}</span>}
          {result?.durationMs !== undefined && <span className="font-mono text-xs text-subtle">{formatMs(result.durationMs)}</span>}
          {result && result.attempt > 1 && <span className="text-[11px] text-subtle">attempt {result.attempt}</span>}
        </div>
        {step.description && <p className="text-xs text-muted">{step.description}</p>}

        {uses.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-subtle">uses</span>
            {uses.map(expression => (
              <span key={expression} className="flex items-center gap-1 rounded-md border border-accent-line bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] text-accent-text">
                <Icon name="link" size={10} />
                {expression}
              </span>
            ))}
          </div>
        )}

        {step.outputs && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-subtle">outputs</span>
            {Object.entries(step.outputs).map(([name, expression]) => (
              <span key={name} className="flex items-center gap-1 rounded-md border border-border bg-raised px-1.5 py-0.5 font-mono text-[11px]">
                <span className="text-accent-text">{name}</span>
                <span className="text-subtle">=</span>
                {result && name in result.outputs ? <span className="text-sx-string">{preview(result.outputs[name])}</span> : <span className="text-faint">{expression}</span>}
              </span>
            ))}
          </div>
        )}

        {criteria.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-subtle">success when</span>
            {criteria.map((criterion, i) => (
              <span
                key={i}
                title={criterion.error}
                className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${
                  criterion.passed === true ? 'border-ok-line bg-ok-bg text-ok-text' : criterion.passed === false ? 'border-err-line bg-err-bg text-err-text' : 'border-border text-muted'
                }`}
              >
                {criterion.condition}
              </span>
            ))}
            {contract && (
              <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${contract.errors ? 'bg-err-bg text-err' : contract.warnings ? 'bg-warn-bg text-warn' : 'text-ok'}`}>
                {contract.issues.length ? `spec: ${contract.issues.length} issue${contract.issues.length === 1 ? '' : 's'}` : '✓ matches spec'}
              </span>
            )}
          </div>
        )}

        {result?.error && (
          <p className="flex items-start gap-1.5 rounded-lg border border-err-line bg-err-bg px-2.5 py-1.5 text-xs text-err-text">
            <Icon name="alert" size={12} className="mt-0.5" />
            {result.error}
          </p>
        )}

        {result?.request && (
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => setOpen(o => !o)} className="flex w-fit items-center gap-1 text-[11px] text-subtle hover:text-fg-2">
              <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} /> Request and response
            </button>
            {open && (
              <div className="grid gap-2 lg:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-mono text-[11px] text-muted">{result.request.method} {result.request.url}</span>
                  <CodeBlock code={result.request.body ?? '(no body)'} language={result.request.body?.trim().startsWith('{') ? 'json' : 'text'} className="max-h-56 rounded-lg border border-line bg-panel px-3 py-2" />
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-mono text-[11px] text-muted">Response {response?.status}</span>
                  <CodeBlock code={response ? (response.json !== undefined ? JSON.stringify(response.json, null, 2) : response.body || '(empty)') : ''} language={response?.json !== undefined ? 'json' : 'text'} className="max-h-56 rounded-lg border border-line bg-panel px-3 py-2" />
                </div>
              </div>
            )}
          </div>
        )}
        <span className="sr-only">Step {index + 1}</span>
      </div>
    </div>
  )
}

function InputsForm({ workflow, doc, values, onChange, disabled }: { workflow: ArazzoWorkflow; doc: ArazzoDocument; values: Record<string, string>; onChange: (name: string, value: string) => void; disabled: boolean }) {
  const ref = workflow.inputs?.$ref?.match(/^#\/components\/inputs\/(.+)$/)?.[1]
  const schema = ref ? doc.components?.inputs?.[ref] : workflow.inputs
  const properties = Object.entries(schema?.properties ?? {})
  if (!properties.length) return null
  const required = new Set(schema?.required ?? [])
  return (
    <div className="grid gap-3 rounded-xl border border-line bg-card p-3.5 sm:grid-cols-2">
      {properties.map(([name, property]) => (
        <label key={name} className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-xs font-medium text-fg">{name}</span>
            {required.has(name) && <span className="text-[11px] text-err">*</span>}
            <span className="font-mono text-[11px] text-subtle">{String(property.type ?? 'string')}</span>
          </span>
          <input className={fieldClass} value={values[name] ?? ''} disabled={disabled} onChange={e => onChange(name, e.target.value)} />
          {property.description && <span className="text-[11px] leading-4 text-subtle">{property.description}</span>}
        </label>
      ))}
    </div>
  )
}

/** Form strings → typed inputs according to the input schema. */
function typedInputs(workflow: ArazzoWorkflow, values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [name, raw] of Object.entries(values)) {
    const type = workflow.inputs?.properties?.[name]?.type
    if (raw === '') continue
    if (type === 'integer' || type === 'number') out[name] = Number(raw)
    else if (type === 'boolean') out[name] = raw === 'true'
    else if (type === 'object' || type === 'array') {
      try {
        out[name] = JSON.parse(raw)
      } catch {
        out[name] = raw
      }
    } else out[name] = raw
  }
  return out
}

const formValues = (workflow: ArazzoWorkflow, doc: ArazzoDocument) =>
  Object.fromEntries(Object.entries(defaultInputs(workflow, doc)).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]))

function Workbench({ workflow, doc, text }: { workflow: ArazzoWorkflow; doc: ArazzoDocument; text: string }) {
  const { model, baseUrl, credentials, csrf } = useDocs()
  const [values, setValues] = useState(() => formValues(workflow, doc))
  const [run, setRun] = useState<WorkflowRun>()
  const [paused, setPaused] = useState<number>()
  const [tab, setTab] = useState<ExportTab>('typescript')
  const resume = useRef<() => void>(undefined)
  const abort = useRef<AbortController>(undefined)
  const running = run?.status === 'running'

  useEffect(() => () => abort.current?.abort(), [])

  const send = async (request: HttpRequestSpec): Promise<StepResponse> => {
    const outcome = await sendRequest(request, abort.current?.signal)
    if (!outcome.ok) {
      if (outcome.kind === 'aborted') throw new DOMException('Aborted', 'AbortError')
      throw new Error(outcome.message)
    }
    return { status: outcome.status, headers: outcome.headers, body: outcome.body, json: outcome.json }
  }

  const start = async (stepThrough: boolean) => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const result = await runWorkflow(doc, workflow.workflowId, {
      model,
      baseUrl,
      inputs: typedInputs(workflow, values),
      send,
      // Same credentials and CSRF handling as the playground.
      prepare: (request, operation) => {
        let prepared = request
        for (const scheme of pickSecurity(operation, model, credentials)) {
          const credential = credentials[scheme.name]
          if (credential && (credential.token || credential.username || credential.password)) prepared = applyAuth(prepared, scheme, credential)
        }
        return applyCsrf(prepared, csrf, { pageOrigin: window.location.origin, cookies: document.cookie })
      },
      onUpdate: update => {
        if (abort.current === controller) setRun(update)
      },
      signal: controller.signal,
      beforeStep: stepThrough
        ? (_step, index) =>
            new Promise<void>(resolve => {
              setPaused(index)
              resume.current = () => {
                resume.current = undefined
                setPaused(undefined)
                resolve()
              }
            })
        : undefined,
    })
    if (abort.current === controller) {
      setPaused(undefined)
      setRun(result)
    }
  }

  const cancel = () => {
    abort.current?.abort()
    // A run paused between steps is waiting on us; let it see the abort.
    resume.current?.()
  }

  const exported = useMemo(() => {
    if (tab === 'arazzo') return text
    try {
      return exportWorkflow(tab, doc, workflow.workflowId, model, baseUrl)
    } catch (error) {
      return `// ${(error as Error).message}`
    }
  }, [tab, text, doc, workflow, model, baseUrl])
  const language = EXPORT_TABS.find(t => t.id === tab)!.language

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="ad-scroll min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[820px] flex-col gap-5 px-6 pb-24 pt-7 lg:px-10">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[11px] font-semibold tracking-wide text-subtle">WORKFLOW · ARAZZO {doc.arazzo}</span>
              <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-fg-strong">{workflow.summary ?? workflow.workflowId}</h1>
              {workflow.description && <p className="text-[13px] leading-5 text-body">{workflow.description}</p>}
            </div>
            <div className="flex items-center gap-2 pt-1">
              {running ? (
                <>
                  {paused !== undefined && (
                    <button type="button" onClick={() => resume.current?.()} className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-hover">
                      <Icon name="play" size={11} filled /> Run step {paused + 1}
                    </button>
                  )}
                  <button type="button" onClick={cancel} className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg-2 hover:border-border-strong">Cancel</button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => void start(true)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg-2 hover:border-border-strong">Step through</button>
                  <button type="button" onClick={() => void start(false)} className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-hover">
                    <Icon name="play" size={11} filled /> {run ? 'Run again' : 'Run all'}
                  </button>
                </>
              )}
            </div>
          </div>

          <InputsForm workflow={workflow} doc={doc} values={values} onChange={(name, value) => setValues(v => ({ ...v, [name]: value }))} disabled={running} />

          {run && run.status !== 'running' && (
            <div className={`flex items-center gap-2.5 rounded-[10px] border px-3 py-2 text-xs ${run.status === 'passed' ? 'border-ok-line bg-ok-bg text-ok-text' : run.status === 'cancelled' ? 'border-border bg-card text-muted' : 'border-err-line bg-err-bg text-err-text'}`}>
              <Icon name={run.status === 'passed' ? 'check' : 'alert'} size={14} strokeWidth={2.2} />
              <span className="flex-1">
                {run.status === 'passed' ? `All ${run.steps.filter(s => s.status === 'passed').length} steps passed` : run.status === 'cancelled' ? 'Cancelled' : run.error}
              </span>
              <span className="font-mono text-subtle">{formatMs(run.steps.reduce((sum, s) => sum + (s.durationMs ?? 0), 0))}</span>
            </div>
          )}

          <div className="flex flex-col">
            {workflow.steps.map((step, index) => (
              <StepCard key={step.stepId} step={step} index={index} result={run?.steps[index]} paused={paused === index} last={index === workflow.steps.length - 1} />
            ))}
          </div>
        </div>
      </div>

      <aside className="ad-scroll hidden w-[400px] shrink-0 flex-col gap-3.5 overflow-y-auto border-l border-line bg-panel p-5 xl:flex">
        <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center gap-0.5 border-b border-line px-2 pt-1">
            {EXPORT_TABS.map(option => (
              <button key={option.id} type="button" onClick={() => setTab(option.id)} className={`-mb-px border-b-2 px-2.5 py-2 text-xs ${tab === option.id ? 'border-accent font-medium text-fg' : 'border-transparent text-subtle hover:text-fg-2'}`}>
                {option.label}
              </button>
            ))}
            <span className="flex-1" />
            <CopyButton text={exported} label="Copy" className="shrink-0" />
          </div>
          <CodeBlock code={exported} language={language} className="max-h-[480px] px-4 py-3" />
        </div>
        {run && Object.keys(run.outputs).length > 0 && (
          <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center border-b border-line px-3.5 py-2 text-xs font-medium text-fg">Workflow outputs</div>
            <CodeBlock code={JSON.stringify(run.outputs, null, 2)} language="json" className="px-4 py-3" />
          </div>
        )}
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
          <span className="text-[13px] font-semibold text-fg">Run it as a smoke test</span>
          <p className="text-xs leading-5 text-muted">The same runner works from the command line and fails CI when a step fails.</p>
          <CodeBlock code={`apidoc run workflows.arazzo.yaml \\\n  --workflow ${workflow.workflowId} \\\n  --server ${baseUrl}`} language="shellscript" className="rounded-lg border border-line bg-panel px-3 py-2.5" />
        </div>
      </aside>
    </div>
  )
}

export function WorkflowsPage({ id }: { id?: string }) {
  const { arazzo } = useDocs()

  if (arazzo.status !== 'ready') {
    return (
      <div className="m-auto max-w-[520px] p-8 text-center">
        {arazzo.status === 'loading' && <p className="text-sm text-muted">Loading workflows…</p>}
        {arazzo.status === 'error' && <p className="rounded-xl border border-err-line bg-err-bg p-4 text-[13px] text-err-text">Could not load the Arazzo document: {arazzo.message}</p>}
        {arazzo.status === 'idle' && (
          <p className="text-sm leading-6 text-muted">
            No workflows configured. Point <code className="font-mono text-fg-2">workflows</code> at an Arazzo 1.x document to describe multi-step flows (create a customer, then charge them…) that people can run here.
          </p>
        )}
      </div>
    )
  }

  const { doc, text } = arazzo.value
  const workflow = doc.workflows.find(w => w.workflowId === id) ?? doc.workflows[0]!

  // The sidebar lists the workflows; this page is the selected one.
  return <Workbench key={workflow.workflowId} workflow={workflow} doc={doc} text={text} />
}
