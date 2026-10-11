import { describe, expect, it } from 'vitest'
import { loadSpec, Resolver, SpecError, typeLabel } from '../src'
import { readSpec } from './fixtures'

describe('loadSpec', () => {
  it('normalizes the hand-written OpenAPI 3.1 spec', async () => {
    const model = await loadSpec({ content: readSpec('orbit.yaml') })
    expect(model.specVersion).toBe('3.1.0')
    expect(model.info.title).toBe('Orbit Payments API')
    expect(model.tags.map(t => t.name)).toEqual(['Customers', 'Payments', 'Invoices'])

    const create = model.operations.find(o => o.operationId === 'createCustomer')!
    expect(create.id).toBe('createcustomer')
    expect(create.parameters).toMatchObject([{ name: 'Idempotency-Key', in: 'header', required: false }])
    expect(create.requestBody?.required).toBe(true)
    expect(create.responses.map(r => r.status)).toEqual(['201', '409', '422'])
    // $ref'd response is resolved, its schema stays a $ref so the UI can show "Error".
    expect(create.responses[2]!.content[0]!.schema).toEqual({ $ref: '#/components/schemas/Error' })
    expect(create.security).toEqual([{ schemes: [{ name: 'bearerAuth', scopes: [] }] }])
    expect(create.extensions['x-rate-limit']).toBe('100/min')
  })

  it('merges path-level parameters and keeps per-operation security overrides', async () => {
    const model = await loadSpec({ content: readSpec('orbit.yaml') })
    const retrieve = model.operations.find(o => o.operationId === 'retrieveCustomer')!
    expect(retrieve.parameters.map(p => `${p.in}:${p.name}`)).toEqual(['path:id'])
    const pdf = model.operations.find(o => o.operationId === 'downloadInvoicePdf')!
    expect(pdf.security).toHaveLength(2)
    const remove = model.operations.find(o => o.method === 'delete')!
    expect(remove.deprecated).toBe(true)
  })

  it('reads drf-spectacular output', async () => {
    const model = await loadSpec({ content: readSpec('django-spectacular.yaml') })
    expect(model.sourceFormat).toBe('openapi3')
    // No `servers` in the spec: requests go to the spec's own origin.
    expect(model.servers).toEqual([{ url: '/', variables: {} }])
    const create = model.operations.find(o => o.method === 'post' && o.path === '/api/v1/customers/')!
    expect(create.summary).toBe('Create a customer')
    expect(create.requestBody?.content.map(c => c.mediaType)).toContain('application/json')
    expect(Object.keys(model.securitySchemes).sort()).toEqual(['basicAuth', 'cookieAuth', 'tokenAuth'])
  })

  it('upgrades drf-yasg Swagger 2.0 output', async () => {
    const model = await loadSpec({ content: readSpec('django-yasg.json') })
    expect(model.sourceFormat).toBe('swagger2')
    expect(model.specVersion).toBe('2.0')
    expect(model.document.openapi).toBe('3.0.3')
    expect(model.servers[0]!.url).toBe('http://localhost:8000/api')

    const create = model.operations.find(o => o.method === 'post' && o.path === '/v1/customers/')!
    const body = create.requestBody!.content[0]!
    expect(body.mediaType).toBe('application/json')
    // definitions were rewritten to components/schemas and still resolve.
    const resolver = new Resolver(model.document)
    expect(resolver.schema(body.schema).name).toBe('Customer')
    expect(resolver.schema(body.schema).value?.properties?.email).toBeDefined()
    expect(create.responses[0]!.content[0]!.schema).toEqual({ $ref: '#/components/schemas/Customer' })

    const list = model.operations.find(o => o.method === 'get' && o.path === '/v1/customers/')!
    const page = list.parameters.find(p => p.name === 'page')
    if (page) expect(page.schema?.type).toBe('integer')
  })

  it('converts Swagger 2.0 formData and query arrays', async () => {
    const model = await loadSpec({
      content: {
        swagger: '2.0',
        info: { title: 't', version: '1' },
        paths: {
          '/upload': {
            post: {
              consumes: ['multipart/form-data'],
              parameters: [
                { name: 'file', in: 'formData', type: 'file', required: true },
                { name: 'note', in: 'formData', type: 'string' },
                { name: 'tags', in: 'query', type: 'array', items: { type: 'string' }, collectionFormat: 'multi' },
              ],
              responses: { 200: { description: 'ok' } },
            },
          },
        },
      },
    })
    const op = model.operations[0]!
    const media = op.requestBody!.content[0]!
    expect(media.mediaType).toBe('multipart/form-data')
    expect(media.schema).toEqual({
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' }, note: { type: 'string' } },
      required: ['file'],
    })
    expect(op.parameters[0]).toMatchObject({ name: 'tags', explode: true, schema: { type: 'array' } })
    expect(model.servers).toEqual([{ url: '/', variables: {} }])
  })

  it('labels types across 3.0 and 3.1 conventions', async () => {
    const model = await loadSpec({ content: readSpec('orbit.yaml') })
    const resolver = new Resolver(model.document)
    const customer = model.schemas.find(s => s.name === 'Customer')!.schema
    expect(typeLabel(customer.properties!.name, resolver)).toMatchObject({ label: 'string', nullable: true })
    expect(typeLabel(customer.properties!.address, resolver)).toMatchObject({ refName: 'Address', label: 'object' })
    expect(typeLabel(customer.properties!.metadata, resolver).label).toBe('map<string, string>')
    expect(typeLabel({ type: 'array', items: { $ref: '#/components/schemas/Customer' } }, resolver).label).toBe('array<Customer>')
    expect(typeLabel({ type: 'string', format: 'email' }, resolver).label).toBe('string · email')
    // `const` without `type` (common in 3.1) takes its type from the value.
    expect(typeLabel(customer.properties!.object, resolver).label).toBe('string')
  })

  it('rejects documents that are not OpenAPI', async () => {
    await expect(loadSpec({ content: '{"hello": 1}' })).rejects.toBeInstanceOf(SpecError)
    await expect(loadSpec({ content: '[1, 2' })).rejects.toThrow(/Could not parse/)
  })
})
