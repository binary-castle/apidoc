import { describe, expect, it } from 'vitest'
import { checkResponse, inferSchema, loadSpec, Resolver, suggestSpecPatch, validateValue, type ApiModel, type OpenAPIDocument, type OperationModel } from '../src'
import { readSpec } from './fixtures'

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const summary = (issues: { severity: string; kind: string; path: string }[]) => issues.map(i => `${i.severity}:${i.kind}:${i.path}`)

const customer = {
  id: 'cus_9Hq2LxP0aB',
  object: 'customer',
  email: 'ada@lovelace.dev',
  name: null,
  balance: 0,
  livemode: false,
  address: { line1: "12 St James's Sq", city: 'London', country: 'GB' },
  metadata: { plan: 'pro' },
  created: 1760140800,
}

async function orbit() {
  const model = await loadSpec({ content: readSpec('orbit.yaml') })
  return { model, resolver: new Resolver(model.document), op: (id: string) => model.operations.find(o => o.operationId === id)! }
}

describe('validateValue (OpenAPI 3.1 spec)', () => {
  it('accepts a valid object and counts what it checked', async () => {
    const { resolver } = await orbit()
    const result = validateValue(customer, ref('Customer'), resolver)
    expect(result.issues).toEqual([])
    expect(result.checked).toBeGreaterThan(10)
  })

  it('reports wrong types, missing fields, enums, patterns and bad map values with JSONPaths', async () => {
    const { resolver } = await orbit()
    const { email: _email, ...noEmail } = customer
    const bad = { ...noEmail, object: 'cus', balance: '0', address: { city: 'London', country: 'gb' }, metadata: { plan: 3 } }
    expect(summary(validateValue(bad, ref('Customer'), resolver).issues)).toEqual([
      'error:required:$.email',
      'error:const:$.object',
      'error:type:$.balance',
      'error:required:$.address.line1',
      'error:pattern:$.address.country',
      'error:type:$.metadata.plan',
    ])
  })

  it('flags undocumented fields as warnings and suggests a spec patch', async () => {
    const { resolver } = await orbit()
    const { issues } = validateValue({ ...customer, tax_ids: [{ type: 'gb_vat', value: 'GB123' }], address: { ...customer.address, floor: 3 } }, ref('Customer'), resolver)
    expect(issues).toMatchObject([
      { severity: 'warning', kind: 'undocumented-field', path: '$.address.floor', schemaName: 'Address' },
      { severity: 'warning', kind: 'undocumented-field', path: '$.tax_ids', schemaName: 'Customer' },
    ])
    expect(suggestSpecPatch(issues)).toBe(
      [
        '# components/schemas/Address',
        'properties:',
        '  floor:',
        '    type: integer',
        '',
        '# components/schemas/Customer',
        'properties:',
        '  tax_ids:',
        '    type: array',
        '    items:',
        '      type: object',
        '      properties:',
        '        type:',
        '          type: string',
        '        value:',
        '          type: string',
      ].join('\n'),
    )
  })

  it('merges allOf for documented fields without duplicating required errors', async () => {
    const { resolver } = await orbit()
    // CustomerUpdate = allOf [CustomerCreate, { default_payment_method }]
    expect(validateValue({ email: 'a@b.co', default_payment_method: 'pm_1' }, ref('CustomerUpdate'), resolver).issues).toEqual([])
    expect(summary(validateValue({ name: 'x', extra: 1 }, ref('CustomerUpdate'), resolver).issues)).toEqual([
      'error:required:$.email',
      'warning:undocumented-field:$.extra',
    ])
  })

  it('validates array items with indexed paths and formats as warnings', async () => {
    const { resolver } = await orbit()
    const list = { data: [customer, { ...customer, email: 'not-an-email', created: 'yesterday' }], has_more: false }
    expect(summary(validateValue(list, ref('CustomerList'), resolver).issues)).toEqual(['warning:format:$.data[1].email', 'error:type:$.data[1].created'])
    const page = { data: [{ ...customer, address: { line1: 'x', country: 'GB', postal_code: 5 } }] }
    expect(summary(validateValue(page, ref('CustomerList'), resolver).issues)).toEqual(['error:type:$.data[0].address.postal_code'])
    expect(summary(validateValue('nope', { type: 'string', format: 'email' }, resolver).issues)).toEqual(['warning:format:$'])
  })
})

describe('validateValue (dialects and composition)', () => {
  const doc: OpenAPIDocument = {
    openapi: '3.0.3',
    components: {
      schemas: {
        Card: { type: 'object', required: ['kind', 'last4'], properties: { kind: { type: 'string' }, last4: { type: 'string', minLength: 4, maxLength: 4 } } },
        Bank: { type: 'object', required: ['kind', 'iban'], properties: { kind: { type: 'string' }, iban: { type: 'string' } } },
        Method: { oneOf: [ref('Card'), ref('Bank')], discriminator: { propertyName: 'kind', mapping: { card: '#/components/schemas/Card', bank: '#/components/schemas/Bank' } } },
        Strict: { type: 'object', additionalProperties: false, properties: { a: { type: 'integer', minimum: 0, exclusiveMinimum: true, maximum: 10 } } },
      },
    },
  }
  const resolver = new Resolver(doc)

  it('handles 3.0 nullable, 3.1 type arrays and anyOf-null', () => {
    expect(validateValue(null, { type: 'string', nullable: true }, resolver).issues).toEqual([])
    expect(validateValue(null, { type: ['string', 'null'] }, resolver).issues).toEqual([])
    expect(validateValue(null, { anyOf: [ref('Card'), { type: 'null' }] }, resolver).issues).toEqual([])
    expect(summary(validateValue(null, { type: 'string' }, resolver).issues)).toEqual(['error:null:$'])
    expect(validateValue(null, {}, resolver).issues).toEqual([])
    expect(validateValue(3, { type: 'number' }, resolver).issues).toEqual([])
    expect(summary(validateValue(3.5, { type: 'integer' }, resolver).issues)).toEqual(['error:type:$'])
  })

  it('uses the discriminator to pick the oneOf branch', () => {
    expect(validateValue({ kind: 'card', last4: '4242' }, ref('Method'), resolver).issues).toEqual([])
    const wrong = validateValue({ kind: 'card', last4: '42' }, ref('Method'), resolver)
    expect(summary(wrong.issues)).toEqual(['error:no-match:$', 'error:length:$.last4'])
    expect(validateValue({ kind: 'bank', iban: 'GB00' }, ref('Method'), resolver).issues).toEqual([])
  })

  it('enforces additionalProperties: false and 3.0 boolean exclusiveMinimum', () => {
    expect(summary(validateValue({ a: 0, b: 1 }, ref('Strict'), resolver).issues)).toEqual(['error:range:$.a', 'error:additional-property:$.b'])
    expect(validateValue({ a: 10 }, ref('Strict'), resolver).issues).toEqual([])
    expect(summary(validateValue({ a: 1 }, { type: 'object', properties: { a: { type: 'integer', exclusiveMinimum: 1 } } }, resolver).issues)).toEqual(['error:range:$.a'])
  })
})

describe('checkResponse', () => {
  const observe = (status: number, json: unknown, contentType = 'application/json') => ({ status, contentType, body: json === undefined ? '' : JSON.stringify(json), json })

  it('matches status exactly, then ranges, then default', async () => {
    const { resolver, op } = await orbit()
    const report = checkResponse(op('createCustomer'), observe(201, customer), resolver)
    expect(report).toMatchObject({ matchedBy: 'exact', schemaLabel: 'Customer', errors: 0, warnings: 0 })
    expect(report.checked).toBeGreaterThan(10)

    const ranged: OperationModel = { ...op('createCustomer'), responses: [{ status: '4XX', content: [], headers: [] }, { status: 'default', content: [], headers: [] }] }
    expect(checkResponse(ranged, observe(409, undefined), resolver).matchedBy).toBe('range')
    expect(checkResponse(ranged, observe(503, undefined), resolver).matchedBy).toBe('default')
  })

  it('warns about undocumented statuses, content types and bodies', async () => {
    const { resolver, op } = await orbit()
    expect(summary(checkResponse(op('createCustomer'), observe(500, { error: 'boom' }), resolver).issues)).toEqual(['warning:undocumented-status:$'])
    expect(summary(checkResponse(op('createCustomer'), observe(201, customer, 'text/html; charset=utf-8'), resolver).issues)).toEqual(['warning:content-type:$'])
    expect(summary(checkResponse(op('deleteCustomer'), observe(204, { ok: true }), resolver).issues)).toEqual(['warning:unexpected-body:$'])
    expect(checkResponse(op('deleteCustomer'), observe(204, undefined), resolver).issues).toEqual([])
    expect(summary(checkResponse(op('createCustomer'), { status: 201, contentType: 'application/json', body: '<html>' }, resolver).issues)).toEqual(['error:invalid-json:$'])
  })

  it('validates real FastAPI and drf-spectacular schemas', async () => {
    const fastapi: ApiModel = await loadSpec({ content: readSpec('fastapi.json') })
    const create = fastapi.operations.find(o => o.operationId === 'create_customer_v1_customers_post')!
    const body = { email: 'a@b.co', name: null, address: null, metadata: {}, id: 1, balance: 0, created: '2026-10-11T10:00:00Z' }
    expect(checkResponse(create, observe(201, body), new Resolver(fastapi.document)).issues).toEqual([])
    const invalid = checkResponse(create, observe(201, { ...body, address: { line1: 'x', country: 'GBR' } }), new Resolver(fastapi.document))
    expect(summary(invalid.issues)).toEqual(['error:no-match:$.address', 'error:length:$.address.country'])

    const django: ApiModel = await loadSpec({ content: readSpec('django-spectacular.yaml') })
    const djangoCreate = django.operations.find(o => o.method === 'post' && o.path === '/api/v1/customers/')!
    const created = { id: 1, email: 'a@b.co', name: '', country: 'GB', balance: 0, archived: false, created: '2026-10-11T10:00:00Z', tax_ids: [] }
    const report = checkResponse(djangoCreate, observe(201, created), new Resolver(django.document))
    expect(summary(report.issues)).toEqual(['warning:undocumented-field:$.tax_ids'])
    expect(report.schemaLabel).toBe('Customer')
  })
})

describe('inferSchema', () => {
  it('infers formats and nested shapes', () => {
    expect(inferSchema({ when: '2026-10-11T10:00:00Z', id: '3f2b8c1e-7d4a-4f0e-9b6a-2c5d8e1f4a7b', n: 1.5, tags: [] })).toEqual({
      type: 'object',
      properties: { when: { type: 'string', format: 'date-time' }, id: { type: 'string', format: 'uuid' }, n: { type: 'number' }, tags: { type: 'array', items: {} } },
    })
  })
})
