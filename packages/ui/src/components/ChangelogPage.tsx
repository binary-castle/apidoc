import { diffSpecs, diffToMarkdown, fragmentToYaml, loadSpec, type ApiModel, type ChangeLevel, type OperationDiff, type SpecChange, type SpecDiff } from '@apidoc/core'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { renderMarkdown } from '../lib/markdown'
import { loadVersion, type LoadState } from '../lib/versions'
import { useDocs } from '../state'
import { CodeBlock } from './CodeBlock'
import { PathText } from './OperationPage'
import { CopyButton, Icon, MethodText, Segmented, Tag } from './ui'

const CUSTOM = 'custom'
const vLabel = (version: string) => (version ? `v${version.replace(/^v/, '')}` : 'unversioned')

const LEVEL_STYLE: Record<ChangeLevel, { mark: string; text: string; label: string }> = {
  breaking: { mark: '✖', text: 'text-err', label: 'Breaking' },
  warning: { mark: '!', text: 'text-warn', label: 'Check' },
  info: { mark: '·', text: 'text-subtle', label: 'Info' },
}

const STATUS_TAG = {
  added: { tone: 'ok', label: 'NEW' },
  changed: { tone: 'warn', label: 'CHANGED' },
  deprecated: { tone: 'err', label: 'DEPRECATED' },
  removed: { tone: 'err', label: 'REMOVED' },
} as const

/** Before/after YAML with lines that differ highlighted. */
function SideBySide({ change }: { change: SpecChange }) {
  const before = fragmentToYaml(change.before).split('\n').filter(Boolean)
  const after = fragmentToYaml(change.after).split('\n').filter(Boolean)
  const column = (title: string, lines: string[], other: string[], tone: 'err' | 'ok') => (
    <div className="flex min-w-0 flex-1 flex-col gap-px rounded-[9px] border border-line bg-card px-2 py-2">
      <span className="px-1.5 pb-1 text-[11px] text-subtle">{title}</span>
      {lines.length ? (
        lines.map((line, index) => {
          const changed = !other.includes(line)
          return (
            <div key={index} className={`flex gap-2 rounded px-1.5 py-0.5 font-mono text-xs ${changed ? (tone === 'err' ? 'bg-err-bg text-err-text' : 'bg-ok-bg text-ok-text') : 'text-muted'}`}>
              <span className="w-2 shrink-0 select-none">{changed ? (tone === 'err' ? '−' : '+') : ''}</span>
              <span className="whitespace-pre-wrap break-all">{line}</span>
            </div>
          )
        })
      ) : (
        <span className="px-1.5 font-mono text-xs text-faint">(absent)</span>
      )}
    </div>
  )
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {column('before', before, after, 'err')}
      {column('after', after, before, 'ok')}
    </div>
  )
}

/** Changes to the same field (e.g. "maxLength removed" + "pattern added") share one before/after. */
function groupChanges(changes: SpecChange[]) {
  const groups: { location: string; path?: string; changes: SpecChange[] }[] = []
  for (const change of changes) {
    const group = groups.find(g => g.location === change.location && g.path === change.path)
    if (group) group.changes.push(change)
    else groups.push({ location: change.location, path: change.path, changes: [change] })
  }
  return groups
}

function ChangeGroup({ location, path, changes }: { location: string; path?: string; changes: SpecChange[] }) {
  const withFragments = changes.find(c => c.before || c.after)
  return (
    <div className="flex flex-col gap-2 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-5 text-xs">
        {location !== 'operation' && <span className="text-muted">{location}</span>}
        {path && <code className="rounded bg-raised px-1.5 py-px font-mono text-[11px] text-fg-2">{path}</code>}
      </div>
      {changes.map((change, index) => {
        const style = LEVEL_STYLE[change.level]
        return (
          <div key={index} className="flex items-start gap-2.5">
            <span className={`w-3 shrink-0 text-center font-mono text-xs font-bold leading-5 ${style.text}`} title={style.label}>{style.mark}</span>
            <span className="text-[13px] leading-5 text-fg">{change.message}</span>
          </div>
        )
      })}
      {withFragments && (
        <div className="pl-5">
          <SideBySide change={withFragments} />
        </div>
      )}
    </div>
  )
}

function OperationRow({ op, breakingOnly, defaultOpen }: { op: OperationDiff; breakingOnly: boolean; defaultOpen: boolean }) {
  const { navigate } = useDocs()
  const [open, setOpen] = useState(defaultOpen)
  const changes = breakingOnly ? op.changes.filter(c => c.level === 'breaking') : op.changes
  const tag = STATUS_TAG[op.status]
  const expandable = op.status !== 'added' && op.status !== 'removed' && changes.length > 0
  const method = op.method.toLowerCase() as Parameters<typeof MethodText>[0]['method']
  return (
    <div className={open ? 'bg-panel' : ''}>
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="w-[86px] shrink-0"><Tag tone={tag.tone}>{tag.label}</Tag></span>
        <MethodText method={method} className="w-11 shrink-0" />
        <button
          type="button"
          disabled={!expandable}
          onClick={() => setOpen(o => !o)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={expandable ? open : undefined}
        >
          <code className={`truncate font-mono text-[13px] ${op.status === 'removed' ? 'text-muted line-through decoration-faint' : 'text-fg'}`}><PathText path={op.path} /></code>
          <span className="hidden truncate text-xs text-subtle md:inline">{op.summary}</span>
          <span className="flex-1" />
          {op.breaking > 0 && <span className="shrink-0 text-[11px] font-medium text-err">{op.breaking} breaking</span>}
          {expandable && <span className="shrink-0 text-[11px] text-subtle">{changes.length} change{changes.length === 1 ? '' : 's'}</span>}
          {expandable && <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} className="shrink-0 text-subtle" />}
        </button>
        {op.operationId && (
          <button type="button" onClick={() => navigate({ view: 'operation', id: op.operationId! })} className="shrink-0 rounded-md px-1.5 py-1 text-[11px] text-subtle hover:bg-hover hover:text-fg" title="Open endpoint">
            <Icon name="link" size={12} />
          </button>
        )}
      </div>
      {open && expandable && <div className="flex flex-col divide-y divide-line border-t border-line">{groupChanges(changes).map((group, index) => <ChangeGroup key={index} {...group} />)}</div>}
    </div>
  )
}

function SummaryCard({ label, value, hint, tone }: { label: string; value: number; hint: ReactNode; tone: 'ok' | 'warn' | 'err' | 'safe' }) {
  const color = { ok: 'text-ok', warn: 'text-warn', err: 'text-delete', safe: 'text-ok' }[tone]
  return (
    <div className={`flex flex-1 flex-col gap-1 rounded-xl border p-4 ${tone === 'safe' ? 'border-ok-line bg-ok-bg' : 'border-line bg-card'}`}>
      <span className={`text-xs ${tone === 'safe' ? 'text-ok-text' : 'text-subtle'}`}>{label}</span>
      <span className={`text-[26px] font-semibold leading-tight ${color}`}>{value}</span>
      <span className={`text-[11px] ${tone === 'safe' ? 'text-ok-text' : 'text-subtle'}`}>{hint}</span>
    </div>
  )
}

function CustomSpecPicker({ onLoaded }: { onLoaded: (model: ApiModel, label: string) => void }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const load = async (task: () => Promise<ApiModel>, label: string) => {
    setBusy(true)
    setError(undefined)
    try {
      onLoaded(await task(), label)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      className="flex flex-col gap-2 rounded-xl border border-dashed border-border-strong p-3"
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault()
        const file = e.dataTransfer.files[0]
        if (file) void load(async () => loadSpec({ content: await file.text() }), file.name)
      }}
    >
      <span className="text-xs font-medium text-fg">Compare with another spec</span>
      <form
        className="flex gap-1.5"
        onSubmit={e => {
          e.preventDefault()
          if (url.trim()) void load(() => loadSpec({ url: url.trim() }), url.trim())
        }}
      >
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="URL of an older spec" className="min-w-0 flex-1 rounded-lg border border-border bg-raised px-2.5 py-1.5 font-mono text-[11px] text-fg outline-none placeholder:text-faint focus:border-accent-line" />
        <button type="submit" disabled={busy} className="rounded-lg border border-border px-2.5 text-xs text-fg-2 hover:border-border-strong">Load</button>
      </form>
      <span className="text-[11px] text-subtle">
        or drop a JSON/YAML file here,{' '}
        <button type="button" onClick={() => fileRef.current?.click()} className="text-accent-text underline underline-offset-2">choose a file</button>
      </span>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.yaml,.yml,application/json,application/yaml"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) void load(async () => loadSpec({ content: await file.text() }), file.name)
        }}
      />
      {busy && <span className="text-[11px] text-muted">Loading…</span>}
      {error && <span className="text-[11px] leading-4 text-err">{error}</span>}
    </div>
  )
}

export function ChangelogPage({ from }: { from?: string }) {
  const { model, versions, specUrl, navigate } = useDocs()
  const current = model.info.version
  const releases = useMemo(() => [{ version: current, url: '', date: undefined as string | undefined }, ...versions], [current, versions])
  const [custom, setCustom] = useState<{ model: ApiModel; label: string }>()
  const [to, setTo] = useState(current)
  const [breakingOnly, setBreakingOnly] = useState(false)
  const fromVersion = from ?? (custom ? CUSTOM : versions[0]?.version)

  // Load every release once: the timeline shows per-release counts.
  const [models, setModels] = useState<Record<string, LoadState<ApiModel>>>({})
  useEffect(() => {
    let cancelled = false
    for (const release of versions) {
      setModels(m => (m[release.version] ? m : { ...m, [release.version]: { status: 'loading' } }))
      loadVersion(release.url, specUrl)
        .then(value => !cancelled && setModels(m => ({ ...m, [release.version]: { status: 'ready', value } })))
        .catch((e: Error) => !cancelled && setModels(m => ({ ...m, [release.version]: { status: 'error', message: e.message } })))
    }
    return () => {
      cancelled = true
    }
  }, [versions, specUrl])

  const modelFor = (version: string | undefined): LoadState<ApiModel> => {
    if (!version) return { status: 'idle' }
    if (version === CUSTOM) return custom ? { status: 'ready', value: custom.model } : { status: 'idle' }
    if (version === current) return { status: 'ready', value: model }
    return models[version] ?? { status: 'loading' }
  }

  const fromState = modelFor(fromVersion)
  const toState = modelFor(to)
  // Memoize on the models themselves; the load-state wrappers are recreated every render.
  const fromModel = fromState.status === 'ready' ? fromState.value : undefined
  const toModel = toState.status === 'ready' ? toState.value : undefined
  const diff: SpecDiff | undefined = useMemo(() => (fromModel && toModel ? diffSpecs(fromModel, toModel) : undefined), [fromModel, toModel])
  const markdown = useMemo(() => (diff ? diffToMarkdown(diff) : ''), [diff])

  // Per-release counts for the timeline: each release against the one before it.
  const timeline = useMemo(() => {
    const ready = (version: string) => (version === current ? model : models[version]?.status === 'ready' ? (models[version] as { value: ApiModel }).value : undefined)
    return releases.map((release, index) => {
      const older = releases[index + 1]
      const a = older && ready(older.version)
      const b = ready(release.version)
      return a && b ? diffSpecs(a, b).counts : undefined
    })
  }, [releases, models, model, current])
  const releaseCounts = (index: number) => timeline[index]

  const pickRelease = (index: number) => {
    const older = releases[index + 1]
    setTo(releases[index]!.version)
    if (older) navigate({ view: 'changelog', from: older.version })
  }

  const visible = diff?.operations.filter(op => !breakingOnly || op.breaking > 0) ?? []
  const options = [...releases.map(r => ({ value: r.version, label: vLabel(r.version) })), ...(custom ? [{ value: CUSTOM, label: custom.label }] : [])]

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <aside className="ad-scroll hidden w-[264px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-panel p-4 lg:flex">
        <span className="text-[11px] font-semibold tracking-wide text-subtle">RELEASES</span>
        {versions.length ? (
          <div className="flex flex-col">
            {releases.map((release, index) => {
              const counts = releaseCounts(index)
              const selected = release.version === to && (releases[index + 1]?.version === fromVersion || !releases[index + 1])
              const last = index === releases.length - 1
              return (
                <div key={release.version} className="flex gap-3">
                  <div className="flex w-3 flex-col items-center pt-3">
                    <span className={`size-2.5 shrink-0 rounded-full ${index === 0 ? 'bg-accent' : counts?.breaking ? 'bg-delete' : 'bg-faint'}`} />
                    {!last && <span className="w-0.5 flex-1 bg-border" />}
                  </div>
                  <button
                    type="button"
                    onClick={() => pickRelease(index)}
                    disabled={last}
                    className={`mb-1.5 flex flex-1 flex-col gap-1 rounded-[9px] border px-2.5 py-2 text-left ${selected ? 'border-selected-line bg-selected' : 'border-transparent hover:bg-hover'}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[13px] font-semibold text-fg">{vLabel(release.version)}</span>
                      {index === 0 && <Tag tone="ok">current</Tag>}
                      {counts && counts.breaking > 0 && <Tag tone="err">{counts.breaking} breaking</Tag>}
                    </span>
                    {release.date && <span className="text-[11px] text-subtle">{new Date(release.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>}
                    {counts && (
                      <span className="flex gap-2 font-mono text-[11px]">
                        <span className="text-ok">+{counts.added}</span>
                        <span className="text-warn">~{counts.changed + counts.deprecated}</span>
                        <span className="text-delete">−{counts.removed}</span>
                      </span>
                    )}
                    {last && <span className="text-[11px] text-faint">oldest configured release</span>}
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-xs leading-5 text-muted">
            No earlier releases are configured. Pass <code className="font-mono text-fg-2">versions</code> to show a release history, or compare with any spec below.
          </p>
        )}
        <CustomSpecPicker
          onLoaded={(loaded, label) => {
            setCustom({ model: loaded, label })
            setTo(current)
            navigate({ view: 'changelog', from: CUSTOM })
          }}
        />
      </aside>

      <div className="ad-scroll min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[860px] flex-col gap-5 px-6 pb-24 pt-7 lg:px-10">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="flex-1 whitespace-nowrap text-[26px] font-semibold tracking-[-0.02em] text-fg-strong">What changed</h1>
            {options.length > 1 && (
              <span className="flex items-center gap-1.5 rounded-lg border border-border bg-raised px-2 py-1">
                <select value={fromVersion ?? ''} onChange={e => navigate({ view: 'changelog', from: e.target.value })} className="bg-transparent font-mono text-xs text-muted outline-none">
                  {options.filter(o => o.value !== to).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <Icon name="chevronRight" size={12} className="text-subtle" />
                <select value={to} onChange={e => setTo(e.target.value)} className="bg-transparent font-mono text-xs text-fg outline-none">
                  {options.filter(o => o.value !== fromVersion && o.value !== CUSTOM).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </span>
            )}
            {diff && diff.counts.breaking > 0 && (
              <Segmented value={breakingOnly ? 'breaking' : 'all'} onChange={v => setBreakingOnly(v === 'breaking')} options={[{ value: 'all', label: 'All' }, { value: 'breaking', label: 'Breaking only' }]} size="md" />
            )}
          </div>

          {!fromVersion && <p className="rounded-xl border border-line bg-card p-5 text-sm leading-6 text-muted">Pick an older spec to compare with: drop a file or paste a URL in the panel on the left.</p>}
          {(fromState.status === 'loading' || toState.status === 'loading') && <p className="text-sm text-muted">Loading releases…</p>}
          {fromState.status === 'error' && <p className="rounded-xl border border-err-line bg-err-bg p-4 text-[13px] text-err-text">Could not load {vLabel(fromVersion ?? '')}: {fromState.message}</p>}
          {toState.status === 'error' && <p className="rounded-xl border border-err-line bg-err-bg p-4 text-[13px] text-err-text">Could not load {vLabel(to)}: {toState.message}</p>}

          {diff && (
            <>
              <div className="flex flex-col gap-3 sm:flex-row">
                <SummaryCard label="Added" value={diff.counts.added} hint={`endpoint${diff.counts.added === 1 ? '' : 's'}`} tone="ok" />
                <SummaryCard label="Changed" value={diff.counts.changed} hint={`${diff.counts.warnings} worth checking`} tone="warn" />
                <SummaryCard label="Deprecated · removed" value={diff.counts.deprecated + diff.counts.removed} hint={`${diff.counts.deprecated} deprecated · ${diff.counts.removed} removed`} tone="err" />
                <SummaryCard label="Breaking" value={diff.counts.breaking} hint={diff.counts.breaking ? 'review before upgrading' : 'safe to upgrade'} tone={diff.counts.breaking ? 'err' : 'safe'} />
              </div>
              {visible.length ? (
                <div className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line">
                  {visible.map(op => <OperationRow key={op.key} op={op} breakingOnly={breakingOnly} defaultOpen={op.breaking > 0} />)}
                </div>
              ) : (
                <p className="rounded-xl border border-line bg-card p-5 text-sm text-muted">{diff.operations.length ? 'No breaking changes.' : `No differences between ${vLabel(diff.from.version)} and ${vLabel(diff.to.version)}.`}</p>
              )}
              <details className="group rounded-xl border border-selected-line bg-selected 2xl:hidden">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3">
                  <Icon name="book" size={14} className="text-accent-text" />
                  <span className="flex-1 text-[13px] font-semibold text-fg">Upgrade notes</span>
                  <CopyButton text={markdown} label="Markdown" />
                  <Icon name="chevronDown" size={12} className="text-subtle transition-transform group-open:rotate-180" />
                </summary>
                <div className="ad-prose border-t border-selected-line px-4 py-3 !text-xs !leading-5 [&_h1]:!text-sm [&_h2]:!text-[13px]" dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }} />
              </details>
            </>
          )}
        </div>
      </div>

      <aside className="ad-scroll hidden w-[340px] shrink-0 flex-col gap-3.5 overflow-y-auto border-l border-line bg-panel p-5 2xl:flex">
        {diff && (
          <div className="flex flex-col gap-3 rounded-xl border border-selected-line bg-selected p-4">
            <div className="flex items-center gap-2">
              <Icon name="book" size={14} className="text-accent-text" />
              <span className="flex-1 text-[13px] font-semibold text-fg">Upgrade notes</span>
              <CopyButton text={markdown} label="Markdown" />
            </div>
            <div className="ad-prose ad-scroll max-h-[420px] overflow-y-auto !text-xs !leading-5 [&_h1]:!text-sm [&_h2]:!text-[13px]" dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }} />
          </div>
        )}
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
          <span className="text-[13px] font-semibold text-fg">Check pull requests</span>
          <p className="text-xs leading-5 text-muted">The same diff runs in CI and fails the build on breaking changes.</p>
          <div className="relative overflow-hidden rounded-lg border border-line bg-panel">
            <CodeBlock code={'apidoc diff origin/main:openapi.yaml \\\n  openapi.yaml --fail-on breaking'} language="shellscript" className="px-3 py-2.5" />
          </div>
        </div>
      </aside>
    </div>
  )
}
