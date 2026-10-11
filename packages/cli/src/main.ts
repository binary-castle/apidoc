import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  diffSpecs,
  diffToMarkdown,
  loadSpec,
  parseArazzo,
  resolveServerUrl,
  runWorkflow,
  type ApiModel,
  type ArazzoDocument,
  type ChangeLevel,
  type SpecDiff,
  type StepResponse,
  type WorkflowRun,
} from '@apidoc/core'
import { version } from '../package.json'

export const VERSION = version

export interface Io {
  out: (text: string) => void
  err: (text: string) => void
  color: boolean
  /** Reads a spec argument; injectable for tests. */
  read?: (source: string) => Promise<ApiModel>
  /** HTTP for `apidoc run`; injectable for tests. */
  fetch?: typeof fetch
}

const USAGE = `apidoc ${VERSION}

Usage:
  apidoc diff <old> <new> [--format text|markdown|json] [--fail-on breaking|warning]
  apidoc run <arazzo> [--workflow <id>] [--spec <openapi>] [--server <url>]
                      [--input name=value]... [--header "Name: value"]... [--format text|json]

Files can be paths, http(s) URLs, or git revisions "<ref>:<path>"
(e.g. origin/main:openapi.yaml).

diff
  --format    text (default), markdown (upgrade notes) or json
  --fail-on   exit 1 when there are breaking changes (or warnings too)

run (Arazzo 1.x workflows as smoke tests)
  --workflow  run one workflow (default: all, in order)
  --spec      the OpenAPI document (default: the first sourceDescription)
  --server    base URL to call (default: the spec's first absolute server)
  --input     workflow input, repeatable; values are parsed as JSON when they can be
  --header    header for every request, repeatable, e.g. "Authorization: Bearer $TOKEN"

Exit codes: 0 ok, 1 threshold reached or a workflow failed, 2 usage or load error.
`

class UsageError extends Error {}

/** Text of a file, an http(s) URL, or "<ref>:<path>" read through git. */
export async function readText(source: string, doFetch: typeof fetch = fetch): Promise<string> {
  if (/^https?:\/\//.test(source)) {
    const response = await doFetch(source)
    if (!response.ok) throw new Error(`Could not fetch ${source}: HTTP ${response.status}`)
    return response.text()
  }
  if (existsSync(source)) return readFileSync(source, 'utf8')
  const revision = source.match(/^([^:]+):(.+)$/)
  if (revision) {
    try {
      return execFileSync('git', ['show', `${revision[1]}:${revision[2]}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
    } catch (error) {
      const detail = (error as { stderr?: string }).stderr?.trim() || (error as Error).message
      throw new Error(`Could not read ${source} from git: ${detail}`)
    }
  }
  throw new Error(`No such file: ${source}`)
}

export const readSource = async (source: string): Promise<ApiModel> => loadSpec({ content: await readText(source) })

/** Resolve a sourceDescription URL relative to the Arazzo file (path, URL or git revision). */
function relativeTo(base: string, url: string): string {
  if (/^https?:\/\//.test(url) || url.startsWith('/')) return url
  if (/^https?:\/\//.test(base)) return new URL(url, base).toString()
  const revision = base.match(/^([^:]+):(.+)$/)
  if (revision && !existsSync(base)) return `${revision[1]}:${resolve('/', dirname(revision[2]!), url).slice(1)}`
  return resolve(dirname(base), url)
}

const REPEATABLE = new Set(['input', 'header'])

function parse(argv: string[]) {
  const positional: string[] = []
  const flags: Record<string, string | true> = {}
  const lists: Record<string, string[]> = { input: [], header: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '-h' || arg === '--help') flags.help = true
    else if (arg === '--version') flags.version = true
    else if (arg.startsWith('--')) {
      // Split on the first "=" only: --input=email=a@b.co
      const equals = arg.indexOf('=')
      const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals)
      const value = equals === -1 ? argv[++i] : arg.slice(equals + 1)
      if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} needs a value`)
      if (REPEATABLE.has(name)) lists[name]!.push(value)
      else flags[name] = value
    } else positional.push(arg)
  }
  return { positional, flags, lists }
}

const paint = (enabled: boolean) => (code: string, text: string) => (enabled ? `\u001b[${code}m${text}\u001b[0m` : text)

const MARK: Record<ChangeLevel, string> = { breaking: '✖', warning: '!', info: '·' }

export function formatText(diff: SpecDiff, color: boolean): string {
  const c = paint(color)
  const levelColor: Record<ChangeLevel, string> = { breaking: '31', warning: '33', info: '2' }
  const statusColor = { added: '32', removed: '31', deprecated: '33', changed: '36' } as const
  const { counts } = diff
  const from = diff.from.version ? `v${diff.from.version.replace(/^v/, '')}` : 'old'
  const to = diff.to.version ? `v${diff.to.version.replace(/^v/, '')}` : 'new'
  const lines = [
    `${c('1', diff.to.title)}  ${from} → ${to}`,
    '',
    `  ${c(counts.breaking ? '31;1' : '32', `${counts.breaking} breaking`)} · ${counts.warnings} warnings · ${counts.added} added · ${counts.removed} removed · ${counts.deprecated} deprecated · ${counts.changed} changed`,
  ]
  if (!diff.operations.length) return [...lines, '', '  No differences.', ''].join('\n')
  for (const op of diff.operations) {
    lines.push('', `${c(statusColor[op.status], op.status.toUpperCase().padEnd(10))} ${c('1', `${op.method} ${op.path}`)}${op.summary ? c('2', `  ${op.summary}`) : ''}`)
    for (const change of op.changes) {
      if (op.status === 'removed') continue
      const where = change.location === 'operation' ? '' : `${change.location}${change.path ? ` ${change.path}` : ''}: `
      lines.push(`  ${c(levelColor[change.level], MARK[change.level])} ${where}${change.message}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

export async function main(argv: string[], io: Io): Promise<number> {
  let parsed: ReturnType<typeof parse>
  try {
    parsed = parse(argv)
  } catch (error) {
    io.err(`${(error as Error).message}\n\n${USAGE}`)
    return 2
  }
  const { positional, flags, lists } = parsed
  if (flags.version) {
    io.out(`${VERSION}\n`)
    return 0
  }
  const [command, ...args] = positional
  if (flags.help || !command) {
    io.out(USAGE)
    return flags.help ? 0 : 2
  }
  if (command === 'run') return runCommand(args, flags, lists, io)
  if (command !== 'diff') {
    io.err(`Unknown command "${command}".\n\n${USAGE}`)
    return 2
  }
  if (args.length !== 2) {
    io.err(`diff needs exactly two specs: <old> <new>.\n\n${USAGE}`)
    return 2
  }
  const format = (flags.format ?? 'text') as string
  const failOn = flags['fail-on'] as string | undefined
  if (!['text', 'markdown', 'json'].includes(format)) {
    io.err(`--format must be text, markdown or json.\n`)
    return 2
  }
  if (failOn !== undefined && !['breaking', 'warning'].includes(failOn)) {
    io.err(`--fail-on must be breaking or warning.\n`)
    return 2
  }

  const read = io.read ?? readSource
  let older: ApiModel
  let newer: ApiModel
  try {
    ;[older, newer] = await Promise.all([read(args[0]!), read(args[1]!)])
  } catch (error) {
    io.err(`apidoc: ${(error as Error).message}\n`)
    return 2
  }

  const diff = diffSpecs(older, newer)
  if (format === 'json') io.out(`${JSON.stringify(diff, null, 2)}\n`)
  else if (format === 'markdown') io.out(diffToMarkdown(diff))
  else io.out(formatText(diff, io.color))

  const failed = failOn === 'breaking' ? diff.counts.breaking > 0 : failOn === 'warning' ? diff.counts.breaking + diff.counts.warnings > 0 : false
  if (failed) io.err(`apidoc: failing because of ${failOn === 'breaking' ? `${diff.counts.breaking} breaking change(s)` : `${diff.counts.breaking} breaking change(s) and ${diff.counts.warnings} warning(s)`} (--fail-on ${failOn}).\n`)
  return failed ? 1 : 0
}

const parseInput = (raw: string): [string, unknown] => {
  const equals = raw.indexOf('=')
  if (equals < 1) throw new UsageError(`--input needs name=value, got "${raw}"`)
  const value = raw.slice(equals + 1)
  try {
    return [raw.slice(0, equals), JSON.parse(value)]
  } catch {
    return [raw.slice(0, equals), value]
  }
}

const parseHeader = (raw: string): [string, string] => {
  const colon = raw.indexOf(':')
  if (colon < 1) throw new UsageError(`--header needs "Name: value", got "${raw}"`)
  return [raw.slice(0, colon).trim(), raw.slice(colon + 1).trim()]
}

export function formatRun(run: WorkflowRun, color: boolean): string {
  const c = paint(color)
  const mark = { passed: c('32', '✓'), failed: c('31', '✖'), skipped: c('2', '-'), pending: c('2', '·'), running: '…', waiting: '…' } as const
  const lines = [`${run.status === 'passed' ? c('32', '✓') : c('31', '✖')} ${c('1', run.workflowId)}  ${run.status}`]
  for (const step of run.steps) {
    const target = step.operation ? `${step.operation.method} ${step.operation.path}` : ''
    const status = step.response ? `  ${step.response.status}` : ''
    const time = step.durationMs !== undefined ? c('2', `  ${step.durationMs} ms`) : ''
    lines.push(`  ${mark[step.status]} ${step.stepId.padEnd(18)} ${target}${status}${time}${step.attempt > 1 ? c('2', `  (attempt ${step.attempt})`) : ''}`)
    for (const criterion of step.criteria.filter(x => !x.passed)) lines.push(`      ${c('31', 'expected')} ${criterion.condition}${criterion.error ? c('2', ` (${criterion.error})`) : ''}`)
    if (step.error && !step.criteria.some(x => !x.passed)) lines.push(`      ${c('31', step.error)}`)
  }
  if (Object.keys(run.outputs).length) lines.push(`  outputs ${JSON.stringify(run.outputs)}`)
  return `${lines.join('\n')}\n`
}

async function runCommand(args: string[], flags: Record<string, string | true>, lists: Record<string, string[]>, io: Io): Promise<number> {
  if (args.length !== 1) {
    io.err(`run needs exactly one Arazzo document.\n\n${USAGE}`)
    return 2
  }
  const format = (flags.format ?? 'text') as string
  if (!['text', 'json'].includes(format)) {
    io.err('--format must be text or json for run.\n')
    return 2
  }
  const doFetch = io.fetch ?? fetch
  let doc: ArazzoDocument
  let model: ApiModel
  let inputs: Record<string, unknown>
  let headers: [string, string][]
  try {
    inputs = Object.fromEntries(lists.input!.map(parseInput))
    headers = lists.header!.map(parseHeader)
    const source = args[0]!
    doc = parseArazzo(await readText(source, doFetch))
    const specSource = typeof flags.spec === 'string' ? flags.spec : doc.sourceDescriptions[0] ? relativeTo(source, doc.sourceDescriptions[0].url) : undefined
    if (!specSource) throw new UsageError('No OpenAPI document: pass --spec or add a sourceDescription.')
    model = await loadSpec({ content: await readText(specSource, doFetch) })
  } catch (error) {
    io.err(`apidoc: ${(error as Error).message}\n`)
    return 2
  }

  const server = typeof flags.server === 'string' ? flags.server : model.servers.map(s => resolveServerUrl(s)).find(url => /^https?:\/\//.test(url))
  if (!server) {
    io.err('apidoc: the spec has no absolute server URL; pass --server https://…\n')
    return 2
  }
  const workflowId = typeof flags.workflow === 'string' ? flags.workflow : undefined
  const selected = workflowId ? doc.workflows.filter(w => w.workflowId === workflowId) : doc.workflows
  if (!selected.length) {
    io.err(`apidoc: no workflow "${workflowId}" (have: ${doc.workflows.map(w => w.workflowId).join(', ')})\n`)
    return 2
  }

  const send = async (request: { method: string; url: string; headers: [string, string][]; body?: string }): Promise<StepResponse> => {
    const response = await doFetch(request.url, { method: request.method, headers: request.headers, body: request.body })
    const body = await response.text()
    let json: unknown
    try {
      json = JSON.parse(body)
    } catch {
      // not JSON
    }
    return { status: response.status, headers: [...response.headers.entries()], body, json }
  }

  const runs: WorkflowRun[] = []
  for (const workflow of selected) {
    const run = await runWorkflow(doc, workflow.workflowId, {
      model,
      baseUrl: server,
      inputs,
      send,
      prepare: request => ({ ...request, headers: [...request.headers.filter(([name]) => !headers.some(([h]) => h.toLowerCase() === name.toLowerCase())), ...headers] }),
    })
    runs.push(run)
    if (format === 'text') io.out(formatRun(run, io.color))
  }
  if (format === 'json') io.out(`${JSON.stringify(runs, null, 2)}\n`)
  const failed = runs.filter(r => r.status !== 'passed')
  if (failed.length) io.err(`apidoc: ${failed.length} of ${runs.length} workflow(s) failed.\n`)
  return failed.length ? 1 : 0
}
