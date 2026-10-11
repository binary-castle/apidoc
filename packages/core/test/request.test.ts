import { describe, expect, it } from 'vitest'
import { applyAuth, applyCsrf, buildRequest, buildSearchIndex, generateSnippet, loadSpec, resolveServerUrl, Resolver, sampleFromSchema } from '../src'
import { readSpec } from './fixtures'

const orbit = () => loadSpec({ content: readSpec('orbit.yaml') })

describe('samples', () => {
  it('builds request bodies without readOnly fields and uses examples/hints', async () => {
    const model = await orbit()
    const resolver = new Resolver(model.document)
    const customer = model.schemas.find(s => s.name === 'Customer')!.schema
    const response = sampleFromSchema(customer, resolver, 'response') as Record<string, unknown>
    expect(response).toMatchObject({ id: 'cus_9Hq2LxP0aB', object: 'customer', email: 'ada@example.com', created: 1760140800 })
    expect(response.address).toMatchObject({ country: 'GB', city: 'London' })

    const request = sampleFromSchema(customer, resolver, 'request') as Record<string, unknown>
    expect(request).not.toHaveProperty('id')

    const update = model.schemas.find(s => s.name === 'CustomerUpdate')!.schema
    expect(sampleFromSchema(update, resolver, 'request')).toHaveProperty('default_payment_method')
  })

  it('terminates on recursive schemas', () => {
    const resolver = new Resolver({
      openapi: '3.1.0',
      components: { schemas: { Node: { type: 'object', properties: { name: { type: 'string' }, children: { type: 'array', items: { $ref: '#/components/schemas/Node' } } } } } },
    })
    expect(sampleFromSchema({ $ref: '#/components/schemas/Node' }, resolver)).toEqual({ name: 'Ada Lovelace', children: [] })
  })
})

describe('requests and snippets', () => {
  it('fills path params, query arrays, headers and auth', async () => {
    const model = await orbit()
    const local = model.servers[2]!
    expect(resolveServerUrl(local)).toBe('http://localhost:8080')
    expect(resolveServerUrl(local, { port: '3000' })).toBe('http://localhost:3000')

    const invoices = model.operations.find(o => o.operationId === 'listInvoices')!
    const request = buildRequest(invoices, { baseUrl: 'https://api.orbit.dev/', query: { status: ['open', 'paid'], limit: '' } })
    expect(request.url).toBe('https://api.orbit.dev/v2/invoices?status=open%2Cpaid')

    const retrieve = model.operations.find(o => o.operationId === 'retrieveCustomer')!
    const withAuth = applyAuth(
      buildRequest(retrieve, { baseUrl: 'https://api.orbit.dev', pathParams: { id: 'cus 1' } }),
      model.securitySchemes.bearerAuth!,
      { token: 'sk_test_123' },
    )
    expect(withAuth.url).toBe('https://api.orbit.dev/v2/customers/cus%201')
    expect(withAuth.headers).toContainEqual(['Authorization', 'Bearer sk_test_123'])
  })

  it('generates snippets for every target', async () => {
    const model = await orbit()
    const create = model.operations.find(o => o.operationId === 'createCustomer')!
    const request = buildRequest(create, {
      baseUrl: 'https://api.orbit.dev',
      headers: { 'Idempotency-Key': "it's-1" },
      body: '{"email":"ada@lovelace.dev","vip":true,"note":null}',
      contentType: 'application/json',
    })
    const curl = generateSnippet('curl', request)
    expect(curl).toContain("curl -X POST 'https://api.orbit.dev/v2/customers'")
    expect(curl).toContain(`-H 'Idempotency-Key: it'\\''s-1'`)
    expect(generateSnippet('python', request)).toContain('"vip": True')
    expect(generateSnippet('python', request)).toContain('json=payload')
    expect(generateSnippet('javascript', request)).toContain('body: JSON.stringify(')
    expect(generateSnippet('go', request)).toContain('http.NewRequest("POST"')
    expect(generateSnippet('http', request)).toMatch(/^POST \/v2\/customers HTTP\/1.1\nHost: api.orbit.dev/)
  })
})

describe('csrf', () => {
  const csrf = { headerName: 'X-CSRFToken', cookieName: 'csrftoken', token: 'embedded' }
  const page = { pageOrigin: 'http://localhost:8000', cookies: 'sessionid=abc; csrftoken=fromcookie' }
  const post = { method: 'POST', url: '/api/v1/customers/', headers: [] as [string, string][] }

  it('adds the cookie token to unsafe same-origin requests', () => {
    expect(applyCsrf(post, csrf, page).headers).toEqual([['X-CSRFToken', 'fromcookie']])
    expect(applyCsrf({ ...post, url: 'http://localhost:8000/x' }, csrf, page).headers).toHaveLength(1)
  })

  it('falls back to the embedded token when the cookie is missing or HttpOnly', () => {
    expect(applyCsrf(post, csrf, { ...page, cookies: 'sessionid=abc' }).headers).toEqual([['X-CSRFToken', 'embedded']])
  })

  it('never sends the token cross-origin or on safe methods, and respects a manual header', () => {
    expect(applyCsrf({ ...post, url: 'https://evil.example/steal' }, csrf, page).headers).toEqual([])
    expect(applyCsrf({ ...post, method: 'GET' }, csrf, page).headers).toEqual([])
    expect(applyCsrf({ ...post, headers: [['x-csrftoken', 'mine']] }, csrf, page).headers).toEqual([['x-csrftoken', 'mine']])
    expect(applyCsrf(post, undefined, page)).toBe(post)
  })
})

describe('search', () => {
  it('finds operations, schemas and nested fields with typos', async () => {
    const model = await orbit()
    const index = buildSearchIndex(model)
    expect(index.search('create cust')[0]).toMatchObject({ kind: 'operation', operationId: 'createcustomer' })
    expect(index.search('custmer', { kinds: ['schema'] })[0]).toMatchObject({ kind: 'schema', title: 'Customer' })
    const fields = index.search('tax rate', { kinds: ['field'] })
    expect(fields[0]).toMatchObject({ title: 'Invoice.lines.tax_rate', schemaName: 'Invoice' })
  })
})
