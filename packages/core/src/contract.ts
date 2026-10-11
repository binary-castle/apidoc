import { stringify as toYaml } from 'yaml'
import type { Resolver } from './refs'
import { typeLabel } from './schema'
import type { MediaTypeModel, OperationModel, ResponseModel, SchemaObject } from './types'
import { validateValue, type ContractIssue } from './validate'

export interface ObservedResponse {
  status: number
  /** Raw Content-Type header ("" if absent). */
  contentType: string
  /** Raw body text. */
  body: string
  /** Parsed body, when it was JSON. */
  json?: unknown
}

export interface ContractReport {
  /** The documented response that matched the status, if any. */
  response?: ResponseModel
  /** How the status matched: "201" exactly, the "2XX" range, or "default". */
  matchedBy?: 'exact' | 'range' | 'default'
  media?: MediaTypeModel
  /** e.g. "Customer" or "array<Customer>" */
  schemaLabel?: string
  issues: ContractIssue[]
  /** Values checked against the schema. */
  checked: number
  errors: number
  warnings: number
}

const baseType = (contentType: string) => contentType.split(';')[0]!.trim().toLowerCase()

function matchStatus(operation: OperationModel, status: number): Pick<ContractReport, 'response' | 'matchedBy'> {
  const exact = operation.responses.find(r => r.status === String(status))
  if (exact) return { response: exact, matchedBy: 'exact' }
  const range = operation.responses.find(r => r.status.toUpperCase() === `${String(status)[0]}XX`)
  if (range) return { response: range, matchedBy: 'range' }
  const fallback = operation.responses.find(r => r.status === 'default')
  return fallback ? { response: fallback, matchedBy: 'default' } : {}
}

/** Exact media type first, then wildcards like "application/*" and "*\/*". */
function matchMedia(content: MediaTypeModel[], contentType: string): MediaTypeModel | undefined {
  const actual = baseType(contentType)
  const [kind] = actual.split('/')
  return (
    content.find(m => baseType(m.mediaType) === actual) ??
    content.find(m => baseType(m.mediaType) === `${kind}/*`) ??
    content.find(m => baseType(m.mediaType) === '*/*')
  )
}

/** Compare a live response with what the spec documents for this operation. */
export function checkResponse(operation: OperationModel, observed: ObservedResponse, resolver: Resolver): ContractReport {
  const issues: ContractIssue[] = []
  const done = (extra: Partial<ContractReport> = {}, checked = 0): ContractReport => ({
    ...extra,
    issues,
    checked,
    errors: issues.filter(i => i.severity === 'error').length,
    warnings: issues.filter(i => i.severity === 'warning').length,
  })

  const { response, matchedBy } = matchStatus(operation, observed.status)
  if (!response) {
    const documented = operation.responses.map(r => r.status).join(', ') || 'none'
    issues.push({ severity: 'warning', kind: 'undocumented-status', path: '$', message: `Status ${observed.status} is not documented for this operation (documented: ${documented})` })
    return done()
  }

  const hasBody = observed.body.trim().length > 0
  if (!response.content.length) {
    if (hasBody) issues.push({ severity: 'warning', kind: 'unexpected-body', path: '$', message: `The spec documents no body for ${response.status}, but one was returned` })
    return done({ response, matchedBy })
  }
  if (!hasBody) {
    issues.push({ severity: 'warning', kind: 'missing-body', path: '$', message: `The spec documents a ${response.content.map(c => c.mediaType).join(' / ')} body for ${response.status}, but the response was empty` })
    return done({ response, matchedBy })
  }

  const media = matchMedia(response.content, observed.contentType)
  if (!media) {
    const expected = response.content.map(c => c.mediaType).join(', ')
    issues.push({ severity: 'warning', kind: 'content-type', path: '$', message: `Content-Type ${baseType(observed.contentType) || '(none)'} is not documented for ${response.status} (expected ${expected})` })
    return done({ response, matchedBy })
  }

  const label = typeLabel(media.schema, resolver)
  const schemaLabel = label.refName ?? label.label
  if (!/json/i.test(media.mediaType) || !media.schema) return done({ response, matchedBy, media, schemaLabel })
  if (observed.json === undefined) {
    issues.push({ severity: 'error', kind: 'invalid-json', path: '$', message: `The body is not valid JSON, but ${media.mediaType} is documented` })
    return done({ response, matchedBy, media, schemaLabel })
  }

  const result = validateValue(observed.json, media.schema, resolver, 'response')
  issues.push(...result.issues)
  return done({ response, matchedBy, media, schemaLabel }, result.checked)
}

/** A plausible schema for an observed value (used to suggest spec patches). */
export function inferSchema(value: unknown): SchemaObject {
  if (value === null) return { nullable: true }
  if (Array.isArray(value)) return value.length ? { type: 'array', items: inferSchema(value[0]) } : { type: 'array', items: {} }
  switch (typeof value) {
    case 'boolean':
      return { type: 'boolean' }
    case 'number':
      return { type: Number.isInteger(value) ? 'integer' : 'number' }
    case 'string': {
      if (/^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value))) return { type: 'string', format: 'date-time' }
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return { type: 'string', format: 'uuid' }
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { type: 'string', format: 'email' }
      return { type: 'string' }
    }
    case 'object':
      return { type: 'object', properties: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, inferSchema(v)])) }
    default:
      return {}
  }
}

/**
 * YAML to add the undocumented fields to the spec, grouped by schema, e.g.
 *
 *   # components/schemas/Customer
 *   properties:
 *     tax_ids:
 *       type: array
 */
export function suggestSpecPatch(issues: ContractIssue[]): string | undefined {
  const fields = issues.filter(i => i.kind === 'undocumented-field')
  if (!fields.length) return undefined
  const groups = new Map<string, Record<string, SchemaObject>>()
  for (const issue of fields) {
    const name = issue.path.match(/(?:\.([\w$]+)|\["(.+)"\])$/)
    const field = name?.[1] ?? name?.[2] ?? issue.path
    const target = issue.schemaName ? `components/schemas/${issue.schemaName}` : `inline schema at ${issue.path.replace(/(\.[\w$]+|\[".+"\])$/, '') || '$'}`
    const properties = groups.get(target) ?? {}
    properties[field] = inferSchema(issue.value)
    groups.set(target, properties)
  }
  return [...groups.entries()].map(([target, properties]) => `# ${target}\n${toYaml({ properties }).trimEnd()}`).join('\n\n')
}
