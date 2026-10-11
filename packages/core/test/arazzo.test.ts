import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  evaluateExpression,
  exportWorkflow,
  findOperation,
  loadSpec,
  parseArazzo,
  parseCondition,
  checkCriterion,
  resolveValue,
  runWorkflow,
  type ExpressionContext,
  type HttpRequestSpec,
  type StepResponse,
  type WorkflowRun,
} from '../src'
import { readSpec } from './fixtures'

const json = (status: number, body: unknown, headers: [string, string][] = []): StepResponse => ({
  status,
  headers: [['content-type', 'application/json'], ...headers],
  body: JSON.stringify(body),
  json: body,
})

/** A fake API: responses are taken in order; requests are recorded. */
function fakeApi(...responses: StepResponse[]) {
  const requests: HttpRequestSpec[] = []
  return {
    requests,
    send: async (request: HttpRequestSpec) => {
      requests.push(request)
      const next = responses.shift()
      if (!next) throw new Error('unexpected request')
      return next
    },
  }
}

const orbit = async () => ({ doc: parseArazzo(readSpec('orbit.arazzo.yaml')), model: await loadSpec({ content: readSpec('orbit.yaml') }) })

describe('parseArazzo', () => {
  it('reads documents and rejects invalid ones with a reason', () => {
    const doc = parseArazzo(readSpec('django.arazzo.yaml'))
    expect(doc.workflows.map(w => w.workflowId)).toEqual(['onboardAndCharge', 'archiveCustomer'])
    expect(() => parseArazzo('{"openapi": "3.1.0"}')).toThrow(/Not an Arazzo 1.x document/)
    expect(() => parseArazzo({ arazzo: '1.0.1', workflows: [{ workflowId: 'w', steps: [{ stepId: 's' }] }] })).toThrow(/exactly one of operationId/)
  })

  it('finds every step of the Django flows in the drf-spectacular spec', async () => {
    const doc = parseArazzo(readSpec('django.arazzo.yaml'))
    const model = await loadSpec({ content: readSpec('django-spectacular.yaml') })
    const steps = doc.workflows.flatMap(w => w.steps)
    expect(steps.map(s => findOperation(s, model)?.path)).toEqual(['/api/v1/customers/', '/api/v1/payments/', '/api/v1/payments/{id}/refund/', '/api/v1/customers/', '/api/v1/customers/{id}/archive/'])
  })
})

describe('expressions and conditions', () => {
  const ctx: ExpressionContext = {
    inputs: { email: 'a@b.co', user: { name: 'Ada' } },
    steps: { create: { outputs: { id: 7, tags: ['x', 'y'] } } },
    response: json(201, { id: 'pi_1', status: 'succeeded', items: [{ amount: 50 }], 'a/b': true }, [['X-Count', '5']]),
  }

  it('evaluates runtime expressions, JSON pointers included', () => {
    expect(evaluateExpression('$inputs.user.name', ctx)).toBe('Ada')
    expect(evaluateExpression('$steps.create.outputs.tags.1', ctx)).toBe('y')
    expect(evaluateExpression('$statusCode', ctx)).toBe(201)
    expect(evaluateExpression('$response.body#/items/0/amount', ctx)).toBe(50)
    expect(evaluateExpression('$response.body#/a~1b', ctx)).toBe(true)
    expect(evaluateExpression('$response.header.x-count', ctx)).toBe('5')
    expect(() => evaluateExpression('$steps.missing.outputs.id', ctx)).toThrow('step "missing" has not run')
    expect(() => evaluateExpression('$response.body#/nope', ctx)).toThrow('nothing at /nope')
  })

  it('keeps types for whole expressions and interpolates {$...} in strings', () => {
    expect(resolveValue({ id: '$steps.create.outputs.id', note: 'for {$inputs.email} #{$steps.create.outputs.id}', list: ['$inputs.user'] }, ctx)).toEqual({
      id: 7,
      note: 'for a@b.co #7',
      list: [{ name: 'Ada' }],
    })
  })

  it('parses conditions with precedence, quotes, negation and numeric headers', () => {
    const check = (condition: string) => checkCriterion({ condition }, ctx).passed
    expect(check("$statusCode == 201 && $response.body#/status == 'succeeded'")).toBe(true)
    expect(check('$statusCode == 200 || $response.body#/items/0/amount >= 50')).toBe(true)
    expect(check('!($statusCode < 300)')).toBe(false)
    expect(check('$response.header.X-Count == 5')).toBe(true)
    expect(check('$response.body#/status != "failed"')).toBe(true)
    expect(checkCriterion({ condition: '^pi_', context: '$response.body#/id', type: 'regex' }, ctx).passed).toBe(true)
    expect(checkCriterion({ condition: '$[?(@.x)]', type: 'jsonpath' }, ctx)).toMatchObject({ passed: false, error: 'jsonpath criteria are not supported yet' })
    expect(() => parseCondition('$statusCode ==')).toThrow('ends unexpectedly')
    expect(() => parseCondition('$statusCode = 1')).toThrow('Cannot parse')
  })
})

describe('runWorkflow', () => {
  it('runs steps in order, passing outputs into later requests', async () => {
    const { doc, model } = await orbit()
    const api = fakeApi(json(201, { id: 'cus_1' }), json(200, { id: 'pi_1', status: 'succeeded' }))
    const updates: WorkflowRun[] = []
    const run = await runWorkflow(doc, 'onboardAndCharge', { model, baseUrl: 'https://api.test', send: api.send, onUpdate: r => updates.push(r) })
    expect(run).toMatchObject({ status: 'passed', outputs: { paymentId: 'pi_1' } })
    expect(run.steps.map(s => [s.stepId, s.status, s.outputs])).toEqual([
      ['createCustomer', 'passed', { customerId: 'cus_1' }],
      ['confirmPayment', 'passed', { paymentId: 'pi_1' }],
    ])
    expect(api.requests[0]).toMatchObject({ method: 'POST', url: 'https://api.test/v2/customers' })
    expect(api.requests[0]!.headers).toContainEqual(['Idempotency-Key', 'onboard-ada@lovelace.dev'])
    expect(JSON.parse(api.requests[1]!.body!)).toEqual({ amount: 4900, currency: 'gbp', customer: 'cus_1', confirm: true })
    // Live updates: each step goes pending → running → passed.
    expect(updates.map(u => u.steps.map(s => s.status).join(','))).toContain('passed,running')
  })

  it('retries while the criteria of an onFailure action hold, then gives up', async () => {
    const { doc, model } = await orbit()
    const processing = json(200, { id: 'pi_1', status: 'processing' })
    const retried = fakeApi(json(201, { id: 'cus_1' }), processing, json(200, { id: 'pi_1', status: 'succeeded' }))
    const ok = await runWorkflow(doc, 'onboardAndCharge', { model, baseUrl: 'https://api.test', send: retried.send })
    expect(ok.status).toBe('passed')
    expect(ok.steps[1]).toMatchObject({ status: 'passed', attempt: 2 })

    const stuck = fakeApi(json(201, { id: 'cus_1' }), processing, processing, processing)
    const failed = await runWorkflow(doc, 'onboardAndCharge', { model, baseUrl: 'https://api.test', send: stuck.send })
    expect(failed).toMatchObject({ status: 'failed', error: 'Step confirmPayment failed after 3 attempts' })
  })

  it('stops at the first failing step and skips the rest', async () => {
    const { doc, model } = await orbit()
    const api = fakeApi(json(409, { type: 'conflict' }))
    const run = await runWorkflow(doc, 'onboardAndCharge', { model, baseUrl: 'https://api.test', send: api.send })
    expect(run.status).toBe('failed')
    expect(run.steps.map(s => s.status)).toEqual(['failed', 'skipped'])
    expect(run.steps[0]!.criteria).toEqual([{ condition: '$statusCode == 201', passed: false }])
  })

  it('supports stepping through and cancelling', async () => {
    const { doc, model } = await orbit()
    const api = fakeApi(json(201, { id: 'cus_1' }), json(200, { id: 'pi_1', status: 'succeeded' }))
    const controller = new AbortController()
    const run = await runWorkflow(doc, 'onboardAndCharge', {
      model,
      baseUrl: 'https://api.test',
      send: api.send,
      signal: controller.signal,
      beforeStep: async (_step, index) => {
        if (index === 1) controller.abort()
      },
    })
    expect(run.status).toBe('cancelled')
    expect(run.steps.map(s => s.status)).toEqual(['passed', 'skipped'])
    expect(api.requests).toHaveLength(1)
  })

  it('guards against goto loops and runs nested workflows', async () => {
    const model = await loadSpec({ content: readSpec('orbit.yaml') })
    const doc = parseArazzo({
      arazzo: '1.0.1',
      info: { title: 't' },
      workflows: [
        { workflowId: 'loop', steps: [{ stepId: 'again', operationId: 'listCustomers', onSuccess: [{ type: 'goto', stepId: 'again' }] }] },
        { workflowId: 'child', inputs: { properties: { email: { type: 'string' } } }, steps: [{ stepId: 'find', operationId: 'listCustomers', parameters: [{ name: 'email', in: 'query', value: '$inputs.email' }], outputs: { count: '$response.body#/has_more' } }], outputs: { more: '$steps.find.outputs.count' } },
        { workflowId: 'parent', steps: [{ stepId: 'call', workflowId: 'child', parameters: [{ name: 'email', value: 'x@y.z' }], outputs: { more: '$outputs.more' } }] },
      ],
    })
    const loop = await runWorkflow(doc, 'loop', { model, baseUrl: 'https://api.test', send: async () => json(200, { data: [] }) })
    expect(loop.error).toMatch(/Stopped after 200 step executions/)

    const seen: string[] = []
    const parent = await runWorkflow(doc, 'parent', { model, baseUrl: 'https://api.test', send: async r => (seen.push(r.url), json(200, { has_more: false })) })
    expect(parent).toMatchObject({ status: 'passed', steps: [{ outputs: { more: false } }] })
    expect(seen).toEqual(['https://api.test/v2/customers?email=x%40y.z'])
  })
})

describe('exportWorkflow', () => {
  const django = async () => ({ doc: parseArazzo(readSpec('django.arazzo.yaml')), model: await loadSpec({ content: readSpec('django-spectacular.yaml') }) })

  it('writes a TypeScript script that compiles and threads outputs through', async () => {
    const { doc, model } = await django()
    const code = exportWorkflow('typescript', doc, 'onboardAndCharge', model, 'http://localhost:8000')
    expect(code).toContain('const res = await call("POST", `/api/v1/payments/${encodeURIComponent(String(steps.chargeCustomer.paymentId))}/refund/`')
    expect(code).toContain('customer: steps.createCustomer.customerId')
    expect(code).toContain('description: "Welcome charge for " + String(inputs.email)')
    expect(code).toContain('check(res.body.status === "succeeded", "chargeCustomer", "$response.body#/status == \'succeeded\'")')
    const output = ts.transpileModule(code, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
    expect(output.diagnostics?.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([])
  })

  it('writes a Python script that parses', async () => {
    const { doc, model } = await django()
    const code = exportWorkflow('python', doc, 'onboardAndCharge', model, 'http://localhost:8000')
    expect(code).toContain('res = call("POST", "/api/v1/payments/" + quote(str(steps["chargeCustomer"]["paymentId"]), safe="") + "/refund/"')
    expect(code).toContain('check(res["status"] == 200, "refundPart", "$statusCode == 200")')
    expect(() => execFileSync('python3', ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], { input: code })).not.toThrow()
  })

  it('writes a REST Client .http file with typed response references', async () => {
    const { doc, model } = await django()
    const code = exportWorkflow('http', doc, 'onboardAndCharge', model, 'http://localhost:8000/')
    expect(code).toContain('@baseUrl = http://localhost:8000\n@email = ada@example.com\n@name = Ada Lovelace\n@amount = 4900')
    expect(code).toContain('# @name createCustomer\n# expect: $statusCode == 201\nPOST {{baseUrl}}/api/v1/customers/')
    // Customer.id is an integer in the schema, so it's spliced in unquoted.
    expect(code).toContain('"customer": {{createCustomer.response.body.$.id}}')
    expect(code).toContain('"description": "Welcome charge for {{email}}"')
    expect(code).toContain('POST {{baseUrl}}/api/v1/payments/{{chargeCustomer.response.body.$.id}}/refund/')
  })
})
