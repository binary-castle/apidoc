import { readFileSync } from 'node:fs'
import { checkResponse, loadSpec, parseArazzo, Resolver, runWorkflow, type ApiModel, type HttpRequestSpec } from '@apidoc/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { createSandbox, SANDBOX_ORIGIN } from '../src/sandbox'

const specs = new URL('../../examples/specs/', import.meta.url)
let model: ApiModel
let resolver: Resolver

beforeAll(async () => {
  model = await loadSpec({ content: readFileSync(new URL('orbit.yaml', specs), 'utf8') })
  resolver = new Resolver(model.document)
})

let clock = 1_791_000_000_000
const sandbox = () => createSandbox({ latency: () => 0, now: () => (clock += 1000) })

type Box = ReturnType<typeof sandbox>

async function call(box: Box, method: string, path: string, init: { json?: unknown; form?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers)
  let body: string | undefined
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(init.json)
  } else if (init.form) {
    headers.set('Content-Type', 'application/x-www-form-urlencoded')
    body = new URLSearchParams(init.form).toString()
  }
  const response = (await box.handle(new Request(SANDBOX_ORIGIN + path, { method, headers, body })))!
  const text = await response.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    // Not JSON.
  }
  return { status: response.status, headers: response.headers, contentType: response.headers.get('content-type') ?? '', body: text, json: json as any }
}

/** The contract check the docs run on every playground response. */
function contract(operationId: string, response: Awaited<ReturnType<typeof call>>) {
  const operation = model.operations.find(op => op.operationId === operationId)!
  const report = checkResponse(operation, response, resolver)
  return report.issues.map(issue => `${issue.severity} ${issue.kind} ${issue.path}`)
}

describe('Orbit sandbox', () => {
  it('ignores requests to other origins', async () => {
    expect(await sandbox().handle(new Request('https://example.com/v2/customers'))).toBeUndefined()
  })

  it('answers every documented operation in line with the spec', async () => {
    const box = sandbox()
    const list = await call(box, 'GET', '/v2/customers?limit=1')
    expect(list.status).toBe(200)
    expect(list.json.has_more).toBe(true)
    expect(contract('listCustomers', list)).toEqual([])

    const created = await call(box, 'POST', '/v2/customers', { json: { email: 'ada@lovelace.dev', name: 'Ada Lovelace', address: { line1: "12 St James's Sq", city: 'London', country: 'GB' } } })
    expect(created.status).toBe(201)
    expect(contract('createCustomer', created)).toEqual([])
    const id = created.json.id as string
    expect(id).toMatch(/^cus_/)

    const duplicate = await call(box, 'POST', '/v2/customers', { json: { email: 'ada@lovelace.dev' } })
    expect(duplicate.status).toBe(409)
    expect(duplicate.json.existing_id).toBe(id)
    expect(contract('createCustomer', duplicate)).toEqual([])

    const invalid = await call(box, 'POST', '/v2/customers', { json: { email: 'grace@navy.mil', address: { line1: 'x', country: 'gb' } } })
    expect(invalid.status).toBe(422)
    expect(invalid.json).toEqual({ type: 'validation_error', message: 'address.country must be an ISO-3166 alpha-2 code', field: 'address.country' })
    expect(contract('createCustomer', invalid)).toEqual([])

    const updated = await call(box, 'PATCH', `/v2/customers/${id}`, { json: { name: 'Augusta Ada King', metadata: { plan: 'pro' } } })
    expect(updated.json.name).toBe('Augusta Ada King')
    expect(contract('updateCustomer', updated)).toEqual([])

    const archived = await call(box, 'POST', `/v2/customers/${id}/archive`)
    expect(archived.json.metadata).toEqual({ plan: 'pro', archived: 'true' })
    expect(contract('archiveCustomer', archived)).toEqual([])

    const intent = await call(box, 'POST', '/v2/payments/intents', { json: { amount: 4900, currency: 'gbp', customer: id, confirm: true } })
    expect(intent.json.status).toBe('succeeded')
    expect(contract('createPaymentIntent', intent)).toEqual([])

    const declined = await call(box, 'POST', '/v2/payments/intents', { json: { amount: 4002, currency: 'gbp', customer: id } })
    expect(declined.status).toBe(402)
    expect(contract('createPaymentIntent', declined)).toEqual([])

    const refund = await call(box, 'POST', `/v2/payments/${intent.json.id}/refund`, { form: { amount: '2450', reason: 'requested_by_customer' } })
    expect(refund.status).toBe(200)
    expect(contract('refundPayment', refund)).toEqual([])

    const invoices = await call(box, 'GET', '/v2/invoices?status=open,paid')
    expect(invoices.json.data.map((i: { status: string }) => i.status)).toEqual(['paid', 'open'])
    expect(contract('listInvoices', invoices)).toEqual([])

    const pdf = await call(box, 'GET', `/v2/invoices/${invoices.json.data[0].id}/pdf`)
    expect(pdf.contentType).toBe('application/pdf')
    expect(pdf.body.startsWith('%PDF-1.4')).toBe(true)
    expect(contract('downloadInvoicePdf', pdf)).toEqual([])

    const deleted = await call(box, 'DELETE', `/v2/customers/${id}`)
    expect(deleted.status).toBe(204)
    expect(deleted.headers.get('sunset')).toContain('2027')
    expect(contract('deleteCustomer', deleted)).toEqual([])
  })

  it('returns one undocumented field from "Retrieve a customer" for the contract check to find', async () => {
    const response = await call(sandbox(), 'GET', '/v2/customers/cus_9Hq2LxP0aB')
    expect(response.status).toBe(200)
    expect(contract('retrieveCustomer', response)).toEqual(['warning undocumented-field $.tax_exempt'])
  })

  it('404s for unknown customers', async () => {
    const response = await call(sandbox(), 'GET', '/v2/customers/cus_nope')
    expect(response.status).toBe(404)
    expect(contract('retrieveCustomer', response)).toEqual([])
  })

  it('replays the first response for a repeated Idempotency-Key', async () => {
    const box = sandbox()
    const headers = { 'Idempotency-Key': 'k1' }
    const first = await call(box, 'POST', '/v2/customers', { json: { email: 'kj@nasa.gov' }, headers })
    const again = await call(box, 'POST', '/v2/customers', { json: { email: 'kj@nasa.gov' }, headers })
    expect(again.status).toBe(201)
    expect(again.json.id).toBe(first.json.id)
    expect(again.headers.get('idempotent-replayed')).toBe('true')
    expect((await call(box, 'POST', '/v2/customers', { json: { email: 'kj@nasa.gov' } })).status).toBe(409)
  })

  it('runs the onboardAndCharge workflow, twice', async () => {
    const box = sandbox()
    const doc = parseArazzo(readFileSync(new URL('orbit.arazzo.yaml', specs), 'utf8'))
    const send = async (request: HttpRequestSpec) => {
      const response = (await box.handle(new Request(request.url, { method: request.method, headers: request.headers, body: request.body })))!
      const body = await response.text()
      return { status: response.status, headers: [...response.headers.entries()], body, json: body ? JSON.parse(body) : undefined }
    }
    for (let i = 0; i < 2; i++) {
      const run = await runWorkflow(doc, 'onboardAndCharge', { model, baseUrl: SANDBOX_ORIGIN, send })
      expect(run.status, run.steps.map(s => `${s.stepId}: ${s.status} ${s.error ?? ''}`).join('\n')).toBe('passed')
      expect(run.outputs.paymentId).toMatch(/^pi_/)
    }
  })
})
