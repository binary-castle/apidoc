import { stringify } from 'yaml'
import { Resolver } from './refs'
import { isNullable, mergeAllOf, schemaTypes, typeLabel } from './schema'
import type { ApiModel, MediaTypeModel, OperationModel, ParameterModel, SchemaObject } from './types'

/**
 * Compare two versions of an API, operation by operation.
 *
 * Whether a change breaks clients depends on direction: narrowing what the
 * API *accepts* (requests) breaks callers, and so does widening what it
 * *returns* (responses), e.g. a new enum value or a field that may now be null.
 */

export type ChangeLevel = 'breaking' | 'warning' | 'info'
type Direction = 'request' | 'response'

export interface SpecChange {
  level: ChangeLevel
  /** Where in the operation: "request body", "response 200", "query parameter limit"… */
  location: string
  /** Dotted path inside a schema, e.g. "address.country" or "lines[].tax_rate". */
  path?: string
  message: string
  /** Compact schema fragments for a before/after view. */
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

export type OperationChangeStatus = 'added' | 'removed' | 'deprecated' | 'changed'

export interface OperationDiff {
  /** Stable key: "POST /v2/customers/{}" (path parameter names don't matter). */
  key: string
  method: string
  path: string
  summary?: string
  /** Operation id in the newer spec (absent when removed), for linking. */
  operationId?: string
  status: OperationChangeStatus
  changes: SpecChange[]
  breaking: number
}

export interface SpecDiff {
  from: { title: string; version: string }
  to: { title: string; version: string }
  operations: OperationDiff[]
  counts: { added: number; removed: number; changed: number; deprecated: number; breaking: number; warnings: number }
}

/** Path prefix from the first server URL, e.g. "/api" for "https://host/api" (Swagger 2.0 basePath). */
function basePath(model: ApiModel): string {
  const url = model.servers[0]?.url ?? '/'
  try {
    return new URL(url.replace(/\{[^}]+\}/g, 'x'), 'http://placeholder').pathname.replace(/\/+$/, '')
  } catch {
    return ''
  }
}

/**
 * "POST /api/v2/customers/{}": full path (server base path included, so moving
 * "/api" between servers and paths is not a remove + add), parameter names ignored.
 */
const operationKey = (operation: OperationModel, base: string) => `${operation.method.toUpperCase()} ${(base + operation.path).replace(/\{[^}]+\}/g, '{}')}`

const SUMMARY_KEYS = ['type', 'format', 'enum', 'const', 'nullable', 'default', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'readOnly', 'writeOnly', 'deprecated'] as const

/** A small, display-friendly view of a schema (no nested properties). */
export function schemaSummary(schema: SchemaObject | undefined, resolver: Resolver): Record<string, unknown> | undefined {
  if (!schema) return undefined
  const { value, name } = resolver.schema(schema)
  if (!value) return name ? { $ref: name } : undefined
  const merged = mergeAllOf(value, resolver) ?? value
  const out: Record<string, unknown> = {}
  if (name) out.$ref = name
  for (const key of SUMMARY_KEYS) if (merged[key] !== undefined) out[key] = merged[key]
  if (!out.type) {
    const label = typeLabel(value, resolver)
    if (label.base !== 'any') out.type = label.label
  }
  if (merged.properties) out.properties = Object.keys(merged.properties)
  if (merged.required?.length) out.required = merged.required
  return out
}

interface Ctx {
  old: Resolver
  next: Resolver
  direction: Direction
  location: string
  changes: SpecChange[]
  visited: Set<string>
}

const typesOf = (schema: SchemaObject) => {
  const types = schemaTypes(schema)
  return types.includes('number') ? [...types, 'integer'] : types
}

const describe = (value: unknown) => (Array.isArray(value) ? value.map(v => JSON.stringify(v)).join(', ') : JSON.stringify(value))

function add(ctx: Ctx, level: ChangeLevel, path: string, message: string, before?: SchemaObject, after?: SchemaObject) {
  ctx.changes.push({
    level,
    location: ctx.location,
    path: path || undefined,
    message,
    before: schemaSummary(before, ctx.old),
    after: schemaSummary(after, ctx.next),
  })
}

type Note = (level: ChangeLevel, message: string) => void

/** Tighter limits break requests; looser limits are only interesting for responses. */
function compareLimits(ctx: Ctx, note: Note, a: SchemaObject, b: SchemaObject) {
  const checks: [keyof SchemaObject, 'max' | 'min', string][] = [
    ['maxLength', 'max', 'maximum length'],
    ['minLength', 'min', 'minimum length'],
    ['maximum', 'max', 'maximum'],
    ['minimum', 'min', 'minimum'],
    ['maxItems', 'max', 'maximum items'],
    ['minItems', 'min', 'minimum items'],
  ]
  for (const [key, kind, label] of checks) {
    const before = a[key] as number | undefined
    const after = b[key] as number | undefined
    if (before === after) continue
    const tighter = after !== undefined && (before === undefined || (kind === 'max' ? after < before : after > before))
    const level: ChangeLevel = ctx.direction === 'request' ? (tighter ? 'breaking' : 'info') : 'info'
    note(level, before === undefined ? `${label} ${after} added` : after === undefined ? `${label} ${before} removed` : `${label} changed from ${before} to ${after}`)
  }
  if (a.pattern !== b.pattern) {
    const level: ChangeLevel = ctx.direction === 'request' && b.pattern ? 'breaking' : 'info'
    note(level, b.pattern ? (a.pattern ? `pattern changed to /${b.pattern}/` : `pattern /${b.pattern}/ added`) : 'pattern removed')
  }
}

function diffSchema(ctx: Ctx, path: string, oldSchema: SchemaObject | undefined, newSchema: SchemaObject | undefined, depth = 0) {
  if (!oldSchema || !newSchema || depth > 24) return
  const oldRef = ctx.old.schema(oldSchema)
  const newRef = ctx.next.schema(newSchema)
  // Recursive schemas: compare each pair of named schemas once per direction.
  if (oldRef.ref && newRef.ref) {
    const key = `${oldRef.ref}|${newRef.ref}|${ctx.direction}|${ctx.location}`
    if (ctx.visited.has(key)) return
    ctx.visited.add(key)
  }
  const a = mergeAllOf(oldSchema, ctx.old)
  const b = mergeAllOf(newSchema, ctx.next)
  if (!a || !b) return
  // Record against the original schemas so before/after keep their $ref names.
  const note: Note = (level, message) => add(ctx, level, path, message, oldSchema, newSchema)

  // Variants: only notice that the set of shapes changed; their contents are compared by name elsewhere.
  const aVariants = (a.oneOf ?? a.anyOf)?.filter(v => v.type !== 'null')
  const bVariants = (b.oneOf ?? b.anyOf)?.filter(v => v.type !== 'null')
  if (aVariants?.length === 1 && bVariants?.length === 1) {
    diffNullability(ctx, note, a, b)
    return diffSchema(ctx, path, aVariants[0], bVariants[0], depth + 1)
  }
  if (aVariants || bVariants) {
    const labels = (variants: SchemaObject[] | undefined, resolver: Resolver) => (variants ?? []).map(v => typeLabel(v, resolver).refName ?? typeLabel(v, resolver).label).sort().join(' | ')
    const before = labels(aVariants, ctx.old)
    const after = labels(bVariants, ctx.next)
    if (before !== after) note('warning', `allowed shapes changed from ${before || 'one shape'} to ${after || 'one shape'}`)
    if (aVariants?.length === 1) return diffSchema(ctx, path, aVariants[0], b, depth + 1)
    if (bVariants?.length === 1) return diffSchema(ctx, path, a, bVariants[0], depth + 1)
    return
  }

  const aTypes = typesOf(a)
  const bTypes = typesOf(b)
  if (aTypes.length && bTypes.length && aTypes.sort().join() !== bTypes.sort().join()) {
    // Requests break when a type the client sends is no longer accepted; responses when a new type can come back.
    const lost = aTypes.filter(t => !bTypes.includes(t))
    const gained = bTypes.filter(t => !aTypes.includes(t))
    const breaking = ctx.direction === 'request' ? lost.length > 0 : gained.length > 0
    note(breaking ? 'breaking' : 'info', `type changed from ${schemaTypes(a).join(' | ')} to ${schemaTypes(b).join(' | ')}`)
    return
  }

  diffNullability(ctx, note, a, b)

  if (a.format !== b.format && a.format && b.format) note('warning', `format changed from ${a.format} to ${b.format}`)

  if (a.enum || b.enum) {
    const before = a.enum ?? []
    const after = b.enum ?? []
    const removed = a.enum && b.enum ? before.filter(v => !after.some(x => JSON.stringify(x) === JSON.stringify(v))) : []
    const added = a.enum && b.enum ? after.filter(v => !before.some(x => JSON.stringify(x) === JSON.stringify(v))) : []
    if (!a.enum && b.enum) note(ctx.direction === 'request' ? 'breaking' : 'info', `now restricted to ${describe(after)}`)
    else if (a.enum && !b.enum) note(ctx.direction === 'response' ? 'warning' : 'info', 'no longer restricted to fixed values')
    if (removed.length) note(ctx.direction === 'request' ? 'breaking' : 'info', `enum value${removed.length > 1 ? 's' : ''} ${describe(removed)} removed`)
    // Clients with exhaustive switches over a response enum need to handle new values.
    if (added.length) note(ctx.direction === 'response' ? 'warning' : 'info', `enum value${added.length > 1 ? 's' : ''} ${describe(added)} added`)
  }

  compareLimits(ctx, note, a, b)

  if (schemaTypes(b).includes('array') || a.items || b.items) {
    diffSchema(ctx, `${path}[]`, a.items, b.items, depth + 1)
  }

  if (a.properties || b.properties) {
    const before = a.properties ?? {}
    const after = b.properties ?? {}
    const requiredBefore = new Set(a.required ?? [])
    const requiredAfter = new Set(b.required ?? [])
    const child = (name: string) => (path ? `${path}.${name}` : name)
    for (const name of Object.keys(before)) {
      if (name in after) continue
      const prop = ctx.old.schema(before[name]).value
      if (ctx.direction === 'response' && prop?.writeOnly) continue
      if (ctx.direction === 'request' && prop?.readOnly) continue
      if (ctx.direction === 'response') add(ctx, 'breaking', child(name), 'field removed from the response', before[name], undefined)
      else add(ctx, b.additionalProperties === false ? 'breaking' : 'warning', child(name), 'field no longer accepted', before[name], undefined)
    }
    for (const name of Object.keys(after)) {
      if (name in before) continue
      const prop = ctx.next.schema(after[name]).value
      if (ctx.direction === 'request') {
        if (prop?.readOnly) continue
        add(ctx, requiredAfter.has(name) ? 'breaking' : 'info', child(name), requiredAfter.has(name) ? 'new required field' : 'new optional field', undefined, after[name])
      } else {
        if (prop?.writeOnly) continue
        add(ctx, 'info', child(name), 'new field in the response', undefined, after[name])
      }
    }
    for (const name of Object.keys(after)) {
      if (!(name in before)) continue
      // readOnly fields never travel in requests, writeOnly never in responses.
      const hidden = (schema: SchemaObject | undefined, resolver: Resolver) => {
        const prop = resolver.schema(schema).value
        return ctx.direction === 'request' ? prop?.readOnly : prop?.writeOnly
      }
      if (hidden(before[name], ctx.old) && hidden(after[name], ctx.next)) continue
      const wasRequired = requiredBefore.has(name)
      const isRequired = requiredAfter.has(name)
      if (wasRequired !== isRequired) {
        if (ctx.direction === 'request') add(ctx, isRequired ? 'breaking' : 'info', child(name), isRequired ? 'now required' : 'now optional', before[name], after[name])
        else add(ctx, isRequired ? 'info' : 'breaking', child(name), isRequired ? 'now always present' : 'may now be missing', before[name], after[name])
      }
      diffSchema(ctx, child(name), before[name], after[name], depth + 1)
    }
  }

  const aAdditional = typeof a.additionalProperties === 'object' ? a.additionalProperties : undefined
  const bAdditional = typeof b.additionalProperties === 'object' ? b.additionalProperties : undefined
  if (aAdditional && bAdditional) diffSchema(ctx, path ? `${path}.*` : '*', aAdditional, bAdditional, depth + 1)
}

function diffNullability(ctx: Ctx, note: Note, a: SchemaObject, b: SchemaObject) {
  const before = isNullable(a)
  const after = isNullable(b)
  if (before === after) return
  if (ctx.direction === 'request') note(before ? 'breaking' : 'info', before ? 'null no longer accepted' : 'now accepts null')
  else note(after ? 'breaking' : 'info', after ? 'may now be null' : 'no longer null')
}

const jsonMedia = (content: MediaTypeModel[]) => content.find(m => /json/i.test(m.mediaType)) ?? content[0]

function diffContent(ctx: Ctx, before: MediaTypeModel[], after: MediaTypeModel[]) {
  for (const media of before) {
    if (!after.some(m => m.mediaType === media.mediaType)) {
      ctx.changes.push({ level: 'breaking', location: ctx.location, message: `${media.mediaType} no longer ${ctx.direction === 'request' ? 'accepted' : 'returned'}` })
    }
  }
  for (const media of after) {
    if (!before.some(m => m.mediaType === media.mediaType)) {
      ctx.changes.push({ level: 'info', location: ctx.location, message: `${media.mediaType} now ${ctx.direction === 'request' ? 'accepted' : 'returned'}` })
    }
  }
  const a = jsonMedia(before)
  const b = after.find(m => m.mediaType === a?.mediaType) ?? jsonMedia(after)
  if (a && b) diffSchema(ctx, '', a.schema, b.schema)
}

const PARAM_LABEL = { path: 'path parameter', query: 'query parameter', header: 'header', cookie: 'cookie' } as const

function diffParameters(base: Omit<Ctx, 'location' | 'direction'>, before: ParameterModel[], after: ParameterModel[]) {
  for (const parameter of before) {
    if (parameter.in === 'path') continue // path params are part of the key
    if (after.some(p => p.in === parameter.in && p.name === parameter.name)) continue
    base.changes.push({ level: 'warning', location: `${PARAM_LABEL[parameter.in]} ${parameter.name}`, message: 'parameter removed', before: schemaSummary(parameter.schema, base.old) })
  }
  for (const parameter of after) {
    const previous = before.find(p => p.in === parameter.in && p.name === parameter.name)
    const location = `${PARAM_LABEL[parameter.in]} ${parameter.name}`
    if (!previous) {
      base.changes.push({ level: parameter.required ? 'breaking' : 'info', location, message: parameter.required ? 'new required parameter' : 'new optional parameter', after: schemaSummary(parameter.schema, base.next) })
      continue
    }
    if (!previous.required && parameter.required) base.changes.push({ level: 'breaking', location, message: 'parameter is now required' })
    if (previous.required && !parameter.required) base.changes.push({ level: 'info', location, message: 'parameter is now optional' })
    if (!previous.deprecated && parameter.deprecated) base.changes.push({ level: 'warning', location, message: 'parameter deprecated' })
    diffSchema({ ...base, direction: 'request', location }, '', previous.schema, parameter.schema)
  }
}

/** "basicAuth or tokenAuth or anonymous": alternatives in a stable order; "" when unauthenticated. */
const securityKey = (operation: OperationModel) => {
  const options = operation.security.map(req => (req.schemes.length ? req.schemes.map(s => s.name).sort().join(' + ') : 'anonymous'))
  return [...new Set(options)].sort((a, b) => (a === 'anonymous' ? 1 : b === 'anonymous' ? -1 : a.localeCompare(b))).join(' or ')
}

function diffOperation(old: Resolver, next: Resolver, before: OperationModel, after: OperationModel): SpecChange[] {
  const base = { old, next, changes: [] as SpecChange[], visited: new Set<string>() }

  if (!before.deprecated && after.deprecated) base.changes.push({ level: 'warning', location: 'operation', message: 'deprecated' })
  if (before.deprecated && !after.deprecated) base.changes.push({ level: 'info', location: 'operation', message: 'no longer deprecated' })

  const securityBefore = securityKey(before)
  const securityAfter = securityKey(after)
  if (securityBefore !== securityAfter) {
    const wasPublic = !before.security.length || before.security.some(r => !r.schemes.length)
    const isPublic = !after.security.length || after.security.some(r => !r.schemes.length)
    const level: ChangeLevel = wasPublic && !isPublic ? 'breaking' : isPublic ? 'info' : 'warning'
    base.changes.push({ level, location: 'security', message: `authentication changed from ${securityBefore || 'none'} to ${securityAfter || 'none'}` })
  }

  diffParameters(base, before.parameters, after.parameters)

  const bodyBefore = before.requestBody
  const bodyAfter = after.requestBody
  if (!bodyBefore && bodyAfter) {
    base.changes.push({ level: bodyAfter.required ? 'breaking' : 'info', location: 'request body', message: bodyAfter.required ? 'request body is now required' : 'optional request body added' })
  } else if (bodyBefore && !bodyAfter) {
    base.changes.push({ level: 'warning', location: 'request body', message: 'request body removed' })
  } else if (bodyBefore && bodyAfter) {
    if (!bodyBefore.required && bodyAfter.required) base.changes.push({ level: 'breaking', location: 'request body', message: 'request body is now required' })
    diffContent({ ...base, direction: 'request', location: 'request body' }, bodyBefore.content, bodyAfter.content)
  }

  for (const response of before.responses) {
    if (after.responses.some(r => r.status === response.status)) continue
    const success = response.status.startsWith('2')
    base.changes.push({ level: success ? 'breaking' : 'warning', location: `response ${response.status}`, message: 'response removed' })
  }
  for (const response of after.responses) {
    const previous = before.responses.find(r => r.status === response.status)
    if (!previous) {
      base.changes.push({ level: 'info', location: `response ${response.status}`, message: `new response${response.description ? `: ${response.description.split('\n')[0]}` : ''}` })
      continue
    }
    diffContent({ ...base, direction: 'response', location: `response ${response.status}` }, previous.content, response.content)
  }

  return base.changes
}

/** Compare an older and a newer version of an API. */
export function diffSpecs(older: ApiModel, newer: ApiModel): SpecDiff {
  const old = new Resolver(older.document)
  const next = new Resolver(newer.document)
  const olderBase = basePath(older)
  const newerBase = basePath(newer)
  const before = new Map(older.operations.map(op => [operationKey(op, olderBase), op]))
  const after = new Map(newer.operations.map(op => [operationKey(op, newerBase), op]))
  const operations: OperationDiff[] = []

  for (const [key, operation] of after) {
    const previous = before.get(key)
    if (!previous) {
      operations.push({ key, method: operation.method.toUpperCase(), path: operation.path, summary: operation.summary, operationId: operation.id, status: 'added', changes: [], breaking: 0 })
      continue
    }
    const changes = diffOperation(old, next, previous, operation)
    if (!changes.length) continue
    const status: OperationChangeStatus = !previous.deprecated && operation.deprecated ? 'deprecated' : 'changed'
    operations.push({ key, method: operation.method.toUpperCase(), path: operation.path, summary: operation.summary, operationId: operation.id, status, changes, breaking: changes.filter(c => c.level === 'breaking').length })
  }
  for (const [key, operation] of before) {
    if (after.has(key)) continue
    operations.push({
      key,
      method: operation.method.toUpperCase(),
      path: operation.path,
      summary: operation.summary,
      status: 'removed',
      changes: [{ level: 'breaking', location: 'operation', message: 'endpoint removed' }],
      breaking: 1,
    })
  }

  const order: Record<OperationChangeStatus, number> = { removed: 0, changed: 1, deprecated: 2, added: 3 }
  operations.sort((x, y) => order[x.status] - order[y.status] || x.path.localeCompare(y.path) || x.method.localeCompare(y.method))
  const all = operations.flatMap(op => op.changes)
  return {
    from: { title: older.info.title, version: older.info.version },
    to: { title: newer.info.title, version: newer.info.version },
    operations,
    counts: {
      added: operations.filter(op => op.status === 'added').length,
      removed: operations.filter(op => op.status === 'removed').length,
      changed: operations.filter(op => op.status === 'changed').length,
      deprecated: operations.filter(op => op.status === 'deprecated').length,
      breaking: all.filter(c => c.level === 'breaking').length,
      warnings: all.filter(c => c.level === 'warning').length,
    },
  }
}

/** A before/after fragment as YAML, for side-by-side views. */
export const fragmentToYaml = (fragment: Record<string, unknown> | undefined) => (fragment ? stringify(fragment, { flowCollectionPadding: false }).trimEnd() : '')

const versionLabel = (v: { version: string }) => (v.version ? `v${v.version.replace(/^v/, '')}` : 'previous')

/** Upgrade notes as Markdown, breaking changes first. */
export function diffToMarkdown(diff: SpecDiff): string {
  const lines = [`# ${diff.to.title}: ${versionLabel(diff.from)} → ${versionLabel(diff.to)}`, '']
  const { counts } = diff
  lines.push(
    counts.breaking
      ? `**${counts.breaking} breaking change${counts.breaking === 1 ? '' : 's'}.** Review before upgrading.`
      : 'No breaking changes.',
    '',
  )
  const section = (title: string, items: string[]) => {
    if (!items.length) return
    lines.push(`## ${title}`, '', ...items, '')
  }
  /**
   * One line per distinct change; a shared schema (e.g. Address) changing shows
   * up in many endpoints, so list the endpoints instead of repeating the change.
   */
  const grouped = (level: ChangeLevel) => {
    const groups = new Map<string, { change: SpecChange; endpoints: string[] }>()
    for (const op of diff.operations) {
      for (const change of op.changes) {
        if (change.level !== level || (op.status === 'deprecated' && change.location === 'operation')) continue
        const location = change.location.startsWith('response') ? 'response' : change.location
        const key = `${location}|${change.path ?? ''}|${change.message}`
        const group = groups.get(key) ?? { change: { ...change, location }, endpoints: [] }
        group.endpoints.push(`\`${op.method} ${op.path}\``)
        groups.set(key, group)
      }
    }
    return [...groups.values()].map(({ change, endpoints }) =>
      change.location === 'operation'
        ? `- ${endpoints.join(', ')}: ${change.message}`
        : `- ${change.location}${change.path ? ` \`${change.path}\`` : ''}: ${change.message} — ${endpoints.join(', ')}`,
    )
  }
  section('Breaking changes', grouped('breaking'))
  section('Deprecated', diff.operations.filter(op => op.status === 'deprecated').map(op => `- \`${op.method} ${op.path}\`${op.summary ? ` (${op.summary})` : ''}`))
  section('New endpoints', diff.operations.filter(op => op.status === 'added').map(op => `- \`${op.method} ${op.path}\`${op.summary ? ` — ${op.summary}` : ''}`))
  section('Worth checking', grouped('warning'))
  section('Other changes', grouped('info'))
  return lines.join('\n').trimEnd() + '\n'
}
