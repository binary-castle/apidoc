import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { main } from '../src/main'

const specs = fileURLToPath(new URL('../../../examples/specs/', import.meta.url))
const older = `${specs}orbit-2.3.0.yaml`
const newer = `${specs}orbit.yaml`

async function run(...argv: string[]) {
  return runWith(undefined, ...argv)
}

async function runWith(fetchImpl: typeof fetch | undefined, ...argv: string[]) {
  let out = ''
  let err = ''
  const code = await main(argv, { out: t => (out += t), err: t => (err += t), color: false, fetch: fetchImpl })
  return { code, out, err }
}

/** Behaves like the Django example API for the flows in django.arazzo.yaml. */
function fakeDjango(options: { refundStatus?: number } = {}) {
  const calls: string[] = []
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method} ${url.replace('http://django.test', '')}${init?.body ? ` ${init.body}` : ''}`)
    if (url.endsWith('/api/v1/customers/')) return reply(201, { id: 5, email: JSON.parse(String(init?.body)).email })
    if (url.endsWith('/api/v1/payments/')) return reply(201, { id: 9, status: 'succeeded' })
    if (url.endsWith('/refund/')) return options.refundStatus ? reply(options.refundStatus, { detail: 'nope' }) : reply(200, { id: 9, status: 'refunded' })
    if (url.endsWith('/archive/')) return reply(200, { id: 5, archived: true })
    return reply(404, {})
  }) as typeof fetch
  return { impl, calls }
}

const arazzo = `${specs}django.arazzo.yaml`

describe('apidoc diff', () => {
  it('prints a readable summary and exits 0 without --fail-on', async () => {
    const { code, out } = await run('diff', older, newer)
    expect(code).toBe(0)
    expect(out).toContain('Orbit Payments API  v2.3.0 → v2.4.0')
    expect(out).toContain('3 breaking · 3 warnings · 1 added · 1 removed · 1 deprecated · 7 changed')
    expect(out).toContain('REMOVED    GET /v2/customers/{id}/sources')
    expect(out).toContain('  ✖ request body address.country: pattern /^[A-Z]{2}$/ added')
    expect(out).toContain('  ! deprecated')
  })

  it('fails CI on breaking changes, and passes when there are none', async () => {
    const failed = await run('diff', older, newer, '--fail-on', 'breaking')
    expect(failed.code).toBe(1)
    expect(failed.err).toContain('failing because of 3 breaking change(s)')
    const same = await run('diff', newer, newer, '--fail-on=warning')
    expect(same.code).toBe(0)
    expect(same.out).toContain('No differences.')
  })

  it('writes Markdown and JSON', async () => {
    expect((await run('diff', older, newer, '--format', 'markdown')).out).toMatch(/^# Orbit Payments API: v2\.3\.0 → v2\.4\.0/)
    const json = JSON.parse((await run('diff', older, newer, '--format', 'json')).out)
    expect(json.counts.breaking).toBe(3)
  })

  it('reads specs from git revisions', async () => {
    // orbit.yaml is committed, so HEAD:<path> resolves through `git show`.
    const { code, out } = await run('diff', 'HEAD:examples/specs/orbit.yaml', newer)
    expect(code).toBe(0)
    expect(out).toContain('No differences.')
    const missing = await run('diff', 'HEAD:does/not/exist.yaml', newer)
    expect(missing.code).toBe(2)
    expect(missing.err).toContain('Could not read HEAD:does/not/exist.yaml from git')
  })

  it('reports usage errors with exit code 2', async () => {
    expect((await run()).code).toBe(2)
    expect((await run('--help')).code).toBe(0)
    expect((await run('diff', older)).err).toContain('exactly two specs')
    expect((await run('diff', older, newer, '--format', 'xml')).code).toBe(2)
    expect((await run('diff', older, newer, '--fail-on')).err).toContain('--fail-on needs a value')
    expect((await run('diff', 'nope.yaml', newer)).err).toContain('No such file: nope.yaml')
  })
})

describe('apidoc run', () => {
  it('runs every workflow against a server, passing outputs between steps', async () => {
    const api = fakeDjango()
    const { code, out } = await runWith(api.impl, 'run', arazzo, '--server', 'http://django.test', '--input', 'email=new@example.com', '--header', 'Authorization: Token abc')
    expect(code).toBe(0)
    expect(out).toContain('✓ onboardAndCharge  passed')
    expect(out).toMatch(/✓ refundPart\s+POST \/api\/v1\/payments\/\{id\}\/refund\/  200/)
    expect(out).toContain('outputs {"customerId":5,"paymentId":9,"refundStatus":"refunded"}')
    expect(out).toContain('✓ archiveCustomer  passed')
    expect(api.calls.slice(0, 3)).toEqual([
      'POST /api/v1/customers/ {"email":"new@example.com","name":"Ada Lovelace","country":"GB"}',
      'POST /api/v1/payments/ {"customer":5,"amount":4900,"currency":"gbp","description":"Welcome charge for new@example.com"}',
      'POST /api/v1/payments/9/refund/ {"amount":2450,"reason":"requested_by_customer"}',
    ])
  })

  it('exits 1 with the failing expectation when a step fails', async () => {
    const api = fakeDjango({ refundStatus: 400 })
    const { code, out, err } = await runWith(api.impl, 'run', arazzo, '--workflow', 'onboardAndCharge', '--server', 'http://django.test', '--format', 'text')
    expect(code).toBe(1)
    expect(out).toContain('✖ onboardAndCharge  failed')
    expect(out).toContain('expected $statusCode == 200')
    expect(err).toContain('1 of 1 workflow(s) failed')
  })

  it('reports usage problems with exit code 2', async () => {
    expect((await run('run', arazzo)).err).toContain('no absolute server URL; pass --server')
    expect((await run('run', arazzo, '--server', 'http://x', '--workflow', 'nope')).err).toContain('no workflow "nope" (have: onboardAndCharge, archiveCustomer)')
    expect((await run('run', arazzo, '--server', 'http://x', '--input', 'oops')).err).toContain('--input needs name=value')
  })
})
