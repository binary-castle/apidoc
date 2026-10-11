import { describe, expect, it } from 'vitest'
import { createApidoc } from '../src'

const docs = createApidoc({ specUrl: '/openapi.json' })
const request = (url: string, mount = '/docs') => docs({ method: 'GET', url, mount, req: undefined, res: undefined })

describe('createApidoc', () => {
  it('only answers under its mount', async () => {
    expect(await request('/abcd/')).toBeUndefined()
    expect(await request('/docsx/')).toBeUndefined()
    expect(await request('/')).toBeUndefined()
    expect((await request('/docs/'))?.status).toBe(200)
    expect((await request('/DOCS/'))?.status).toBe(200)
    expect((await request('/docs'))?.status).toBe(302)
  })

  it('works mounted at the root', async () => {
    expect((await request('/', ''))?.status).toBe(200)
    expect((await request('/_static/apidoc.js', '/'))?.status).toBe(200)
    expect(await request('/other', '')).toBeUndefined()
  })

  it('redirects relative to the last path segment, keeping the query', async () => {
    expect((await request('/v1/docs?x=1', '/v1/docs'))?.headers.Location).toBe('docs/?x=1')
  })

  it('ignores methods other than GET and HEAD', async () => {
    expect(await docs({ method: 'POST', url: '/docs/', mount: '/docs', req: undefined, res: undefined })).toBeUndefined()
  })
})
