import { suggestSpecPatch, type ContractIssue, type ContractReport, type IssueKind } from '@apidoc/core'
import { useMemo } from 'react'
import { useDocs } from '../state'
import { CodeBlock } from './CodeBlock'
import { CopyButton, Icon } from './ui'

const KIND_LABEL: Record<IssueKind, string> = {
  type: 'wrong type',
  null: 'unexpected null',
  required: 'missing field',
  enum: 'not an allowed value',
  const: 'wrong constant',
  format: 'format',
  range: 'out of range',
  length: 'length',
  pattern: 'pattern',
  items: 'array',
  'additional-property': 'field not allowed',
  'undocumented-field': 'undocumented field',
  'no-match': 'no matching shape',
  not: 'forbidden shape',
  'undocumented-status': 'undocumented status',
  'content-type': 'content type',
  'unexpected-body': 'unexpected body',
  'missing-body': 'missing body',
  'invalid-json': 'invalid JSON',
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

function matchedNote(report: ContractReport) {
  if (!report.response) return ''
  if (report.matchedBy === 'range') return ` (matched the ${report.response.status} range)`
  if (report.matchedBy === 'default') return ' (matched the default response)'
  return ''
}

/** One-line verdict under the status row; clicking opens the details tab. */
export function ContractStrip({ report, onOpen }: { report: ContractReport; onOpen: () => void }) {
  const { model } = useDocs()
  const version = model.info.version ? ` · v${model.info.version.replace(/^v/, '')}` : ''
  if (!report.issues.length) {
    return (
      <button type="button" onClick={onOpen} className="flex items-center gap-2.5 rounded-[10px] border border-ok-line bg-ok-bg px-3 py-2 text-left">
        <Icon name="check" size={14} strokeWidth={2.4} className="text-ok" />
        <span className="flex-1 text-xs text-ok-text">
          Matches the spec{report.schemaLabel ? ` · ${report.schemaLabel}` : ''}
          {report.checked ? ` · ${plural(report.checked, 'value')} checked` : ''}
          {version}
        </span>
      </button>
    )
  }
  const errors = report.errors > 0
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex items-center gap-2.5 rounded-[10px] border px-3 py-2 text-left ${errors ? 'border-err-line bg-err-bg' : 'border-warn-line bg-warn-bg'}`}
    >
      <Icon name="alert" size={14} strokeWidth={2} className={errors ? 'text-err' : 'text-warn'} />
      <span className={`flex-1 text-xs ${errors ? 'text-err-text' : 'text-warn-text'}`}>
        {[report.errors && plural(report.errors, 'contract error'), report.warnings && plural(report.warnings, 'warning')].filter(Boolean).join(' · ')}
        <span className="opacity-75"> · differs from the spec{version}</span>
      </span>
      <span className={`text-[11px] ${errors ? 'text-err' : 'text-warn'}`}>Details</span>
    </button>
  )
}

function IssueRow({ issue }: { issue: ContractIssue }) {
  const error = issue.severity === 'error'
  return (
    <div className="flex gap-3 px-3.5 py-3">
      <Icon name="alert" size={14} strokeWidth={2} className={`mt-0.5 ${error ? 'text-err' : 'text-warn'}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[13px] leading-5 text-fg">{issue.message}</span>
        <span className="flex flex-wrap items-center gap-2">
          <code className={`rounded px-1.5 py-px font-mono text-[11px] ${error ? 'bg-err-bg text-err-text' : 'bg-warn-bg text-warn-text'}`}>{issue.path}</code>
          <span className="text-[11px] text-subtle">{KIND_LABEL[issue.kind]}</span>
          {issue.schemaName && <span className="font-mono text-[11px] text-accent-text">{issue.schemaName}</span>}
        </span>
      </div>
    </div>
  )
}

export function ContractDetails({ report }: { report: ContractReport }) {
  const patch = useMemo(() => suggestSpecPatch(report.issues), [report])
  const issues = [...report.issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
  return (
    <div className="ad-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      {report.response && !report.errors && (
        <div className="flex items-center gap-2.5 rounded-[10px] border border-ok-line bg-ok-bg px-3 py-2.5 text-xs text-ok-text">
          <Icon name="check" size={14} strokeWidth={2.4} className="text-ok" />
          Status {report.response.status}
          {report.schemaLabel ? ` and ${plural(report.checked, 'value')} match ${report.schemaLabel}` : ' matches the spec'}
          {matchedNote(report)}
        </div>
      )}
      {issues.length > 0 && <div className="flex flex-col divide-y divide-line rounded-xl border border-border bg-card">{issues.map((issue, index) => <IssueRow key={index} issue={issue} />)}</div>}
      {patch && (
        <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-line px-3.5 py-2">
            <Icon name="sparkles" size={13} className="text-accent-text" />
            <span className="flex-1 text-xs font-medium text-fg">Suggested spec patch</span>
            <CopyButton text={patch} label="Copy YAML" />
          </div>
          <CodeBlock code={patch} language="yaml" className="px-4 py-3" />
          <p className="border-t border-line px-3.5 py-2 text-[11px] leading-4 text-subtle">
            Inferred from this one response. Check types and add descriptions before merging it into the spec.
          </p>
        </div>
      )}
      <p className="px-1 text-[11px] leading-4 text-subtle">
        Checked in your browser against the loaded spec: status, content type and body schema. Errors break the documented contract; warnings mean the spec is incomplete.
      </p>
    </div>
  )
}
