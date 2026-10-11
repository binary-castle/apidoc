import { describe, expect, it } from 'vitest'
import { diffSpecs, diffToMarkdown, loadSpec, normalize, type JsonObject, type OpenAPIDocument, type SchemaObject, type SpecDiff } from '../src'
import { readSpec } from './fixtures'

const releases = async () =>
  diffSpecs(await loadSpec({ content: readSpec('orbit-2.3.0.yaml') }), await loadSpec({ content: readSpec('orbit.yaml') }))

const changesOf = (diff: SpecDiff, key: string) =>
  diff.operations.find(op => op.key === key)?.changes.map(c => `${c.level}|${c.location}|${c.path ?? ''}|${c.message}`) ?? []

/** Build a one-operation spec: POST /items with the given request/response schemas. */
function spec(parts: { request?: JsonObject; response?: JsonObject; parameters?: JsonObject[]; security?: JsonObject[]; schemas?: JsonObject; status?: string; mediaType?: string; path?: string }): OpenAPIDocument {
  const operation: JsonObject = {
    responses: { [parts.status ?? '200']: { description: 'ok', content: parts.response ? { [parts.mediaType ?? 'application/json']: { schema: parts.response } } : undefined } },
  }
  if (parts.request) operation.requestBody = { required: true, content: { 'application/json': { schema: parts.request } } }
  if (parts.parameters) operation.parameters = parts.parameters
  if (parts.security) operation.security = parts.security
  return { openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: { [parts.path ?? '/items/{id}']: { post: operation } }, components: { schemas: (parts.schemas ?? {}) as Record<string, SchemaObject>, securitySchemes: { key: { type: 'apiKey', in: 'header', name: 'X-Key' } } } }
}

const diff = (before: OpenAPIDocument, after: OpenAPIDocument) => diffSpecs(normalize(before), normalize(after))
const only = (d: SpecDiff) => d.operations.flatMap(op => op.changes.map(c => `${c.level}|${c.location}|${c.path ?? ''}|${c.message}`))

describe('diffSpecs on two Orbit releases', () => {
  it('summarizes added, removed, deprecated and breaking changes', async () => {
    const d = await releases()
    expect(d.from.version).toBe('2.3.0')
    expect(d.to.version).toBe('2.4.0')
    expect(d.counts).toEqual({ added: 1, removed: 1, changed: 7, deprecated: 1, breaking: 3, warnings: 3 })
    expect(d.operations.filter(op => op.status !== 'changed').map(op => `${op.status} ${op.key}`)).toEqual([
      'removed GET /v2/customers/{}/sources',
      'deprecated DELETE /v2/customers/{}',
      'added POST /v2/payments/intents',
    ])
  })

  it('classifies request and response sides of the same schema change differently', async () => {
    const d = await releases()
    const create = d.operations.find(op => op.key === 'POST /v2/customers')!
    expect(create.operationId).toBe('createcustomer')
    expect(changesOf(d, 'POST /v2/customers')).toEqual([
      'info|request body|address.country|maximum length 64 removed',
      'breaking|request body|address.country|pattern /^[A-Z]{2}$/ added',
      'info|response 201|address.country|maximum length 64 removed',
      'info|response 201|address.country|pattern /^[A-Z]{2}$/ added',
    ])
    const pattern = create.changes[1]!
    expect(pattern.before).toEqual({ type: 'string', maxLength: 64 })
    expect(pattern.after).toEqual({ $ref: 'CountryCode', type: 'string', pattern: '^[A-Z]{2}$' })
    expect(changesOf(d, 'POST /v2/payments/{}/refund')).toEqual([
      'info|request body|amount|now optional',
      'warning|response 200|status|enum value "processing" added',
    ])
    expect(changesOf(d, 'GET /v2/invoices')).toEqual(['info|response 200|data[].lines[].tax_rate|new field in the response'])
    expect(changesOf(d, 'GET /v2/customers')).toContain('warning|query parameter starting_after||parameter removed')
  })

  it('writes grouped Markdown upgrade notes', async () => {
    const markdown = diffToMarkdown(await releases())
    expect(markdown).toContain('# Orbit Payments API: v2.3.0 → v2.4.0\n\n**3 breaking changes.** Review before upgrading.')
    expect(markdown).toContain(
      [
        '## Breaking changes',
        '',
        '- `GET /v2/customers/{id}/sources`: endpoint removed',
        '- request body `address.country`: pattern /^[A-Z]{2}$/ added — `POST /v2/customers`, `PATCH /v2/customers/{id}`',
        '',
        '## Deprecated',
        '',
        '- `DELETE /v2/customers/{id}` (Delete a customer)',
        '',
        '## New endpoints',
        '',
        '- `POST /v2/payments/intents` — Create a payment intent',
      ].join('\n'),
    )
    // The shared Address change is listed once, with every endpoint that returns it.
    expect(markdown).toMatch(/- response `address\.country`: maximum length 64 removed — `POST \/v2\/customers`, `GET \/v2\/customers\/\{id\}`, `PATCH \/v2\/customers\/\{id\}`, `POST \/v2\/customers\/\{id\}\/archive`/)
  })

  it('finds nothing when comparing a spec with itself', async () => {
    const model = await loadSpec({ content: readSpec('orbit.yaml') })
    expect(diffSpecs(model, model).operations).toEqual([])
  })
})

describe('direction rules', () => {
  const obj = (properties: JsonObject, required: string[] = []) => ({ type: 'object', properties, required })

  it('responses: removing fields, new nulls and new enum values affect clients', () => {
    const before = spec({ response: obj({ id: { type: 'string' }, plan: { type: 'string', enum: ['free', 'pro'] }, name: { type: 'string' } }, ['id', 'name']) })
    const after = spec({ response: obj({ plan: { type: 'string', enum: ['free', 'pro', 'team'] }, name: { type: ['string', 'null'] }, extra: { type: 'integer' } }) })
    expect(only(diff(before, after))).toEqual([
      'breaking|response 200|id|field removed from the response',
      'info|response 200|extra|new field in the response',
      'warning|response 200|plan|enum value "team" added',
      'breaking|response 200|name|may now be missing',
      'breaking|response 200|name|may now be null',
    ])
  })

  it('requests: new required fields, removed enum values and lost nulls break callers', () => {
    const before = spec({ request: obj({ plan: { type: 'string', enum: ['free', 'pro'] }, note: { type: ['string', 'null'] }, size: { type: 'integer', maximum: 10 } }) })
    const after = spec({ request: obj({ plan: { type: 'string', enum: ['pro'] }, note: { type: 'string' }, size: { type: 'integer', maximum: 5 }, email: { type: 'string' } }, ['email']) })
    expect(only(diff(before, after))).toEqual([
      'breaking|request body|email|new required field',
      'breaking|request body|plan|enum value "free" removed',
      'breaking|request body|note|null no longer accepted',
      'breaking|request body|size|maximum changed from 10 to 5',
    ])
    // Widening is safe for requests.
    expect(only(diff(after, before)).filter(c => c.startsWith('breaking'))).toEqual([])
  })

  it('parameters, bodies, media types, statuses and security', () => {
    const before = spec({ request: { type: 'object' }, response: { type: 'object' }, parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }] })
    const after = spec({
      request: { type: 'object' },
      response: { type: 'object' },
      mediaType: 'application/xml',
      parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'integer' } }, { name: 'X-Tenant', in: 'header', required: true, schema: { type: 'string' } }],
      security: [{ key: [] }],
    })
    expect(only(diff(before, after))).toEqual([
      'breaking|security||authentication changed from none to key',
      'breaking|query parameter q||parameter is now required',
      'breaking|query parameter q||type changed from string to integer',
      'breaking|header X-Tenant||new required parameter',
      'breaking|response 200||application/json no longer returned',
      'info|response 200||application/xml now returned',
    ])
    const gone = spec({ request: { type: 'object' }, response: { type: 'object' }, status: '201' })
    expect(only(diff(before, gone))).toContain('breaking|response 200||response removed')
  })

  it('matches operations when the base path moves between the server URL and the paths', async () => {
    // drf-yasg: server ".../api" + "/v1/customers/"; drf-spectacular: "/" + "/api/v1/customers/".
    const yasg = await loadSpec({ content: readSpec('django-yasg.json') })
    const spectacular = await loadSpec({ content: readSpec('django-spectacular.yaml') })
    const d = diffSpecs(yasg, spectacular)
    expect(d.operations.filter(op => op.status === 'removed').map(op => op.key)).toEqual(['GET /api/schema/'])
    expect(d.counts.added).toBe(0)
    const create = d.operations.find(op => op.key === 'POST /api/v1/customers/')!
    // readOnly fields (id, balance…) are not request changes, whatever their required flags say.
    expect(create.changes.filter(c => c.location === 'request body' && c.path === 'id')).toEqual([])
    expect(create.changes.find(c => c.location === 'security')).toMatchObject({ level: 'info', message: 'authentication changed from Basic to basicAuth or cookieAuth or tokenAuth or anonymous' })
  })

  it('matches operations across path parameter renames and survives recursive schemas', () => {
    const node = { type: 'object', properties: { name: { type: 'string' }, children: { type: 'array', items: { $ref: '#/components/schemas/Node' } } } }
    const before = spec({ path: '/items/{id}', response: { $ref: '#/components/schemas/Node' }, schemas: { Node: node } })
    const after = spec({ path: '/items/{itemId}', response: { $ref: '#/components/schemas/Node' }, schemas: { Node: { ...node, properties: { ...node.properties, name: { type: 'integer' } } } } })
    const d = diff(before, after)
    expect(d.operations.map(op => `${op.status} ${op.path}`)).toEqual(['changed /items/{itemId}'])
    expect(only(d)).toEqual(['breaking|response 200|name|type changed from string to integer'])
  })
})
