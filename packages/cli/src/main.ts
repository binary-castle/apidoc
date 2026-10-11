import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { diffSpecs, diffToMarkdown, loadSpec, type ApiModel, type ChangeLevel, type SpecDiff } from '@apidoc/core'

export const VERSION = '0.0.0'

export interface Io {
  out: (text: string) => void
  err: (text: string) => void
  color: boolean
  /** Reads a spec argument; injectable for tests. */
  read?: (source: string) => Promise<ApiModel>
}

const USAGE = `apidoc ${VERSION}

Usage:
  apidoc diff <old> <new> [--format text|markdown|json] [--fail-on breaking|warning]

<old> and <new> can each be a file, an http(s) URL, or a git revision
"<ref>:<path>", e.g. origin/main:openapi.yaml.

Options:
  --format    text (default), markdown (upgrade notes) or json
  --fail-on   exit 1 when there are breaking changes (or warnings too)
  -h, --help  show this help

Exit codes: 0 ok, 1 --fail-on threshold reached, 2 usage or load error.
`

class UsageError extends Error {}

/** File, URL, or "<ref>:<path>" read through git. */
export async function readSource(source: string): Promise<ApiModel> {
  if (/^https?:\/\//.test(source)) return loadSpec({ url: source })
  if (existsSync(source)) return loadSpec({ content: readFileSync(source, 'utf8') })
  const revision = source.match(/^([^:]+):(.+)$/)
  if (revision) {
    let text: string
    try {
      text = execFileSync('git', ['show', `${revision[1]}:${revision[2]}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
    } catch (error) {
      const detail = (error as { stderr?: string }).stderr?.trim() || (error as Error).message
      throw new Error(`Could not read ${source} from git: ${detail}`)
    }
    return loadSpec({ content: text })
  }
  throw new Error(`No such file: ${source}`)
}

function parse(argv: string[]) {
  const positional: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '-h' || arg === '--help') flags.help = true
    else if (arg === '--version') flags.version = true
    else if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split('=', 2) as [string, string | undefined]
      const value = inline ?? argv[++i]
      if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} needs a value`)
      flags[name] = value
    } else positional.push(arg)
  }
  return { positional, flags }
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
  const { positional, flags } = parsed
  if (flags.version) {
    io.out(`${VERSION}\n`)
    return 0
  }
  const [command, ...args] = positional
  if (flags.help || !command) {
    io.out(USAGE)
    return flags.help ? 0 : 2
  }
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
