import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { main } from '../src/main'

const specs = fileURLToPath(new URL('../../../examples/specs/', import.meta.url))
const older = `${specs}orbit-2.3.0.yaml`
const newer = `${specs}orbit.yaml`

async function run(...argv: string[]) {
  let out = ''
  let err = ''
  const code = await main(argv, { out: t => (out += t), err: t => (err += t), color: false })
  return { code, out, err }
}

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
