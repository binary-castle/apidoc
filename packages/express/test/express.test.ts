import type { AddressInfo } from 'node:net'
import express from 'express'
// @ts-expect-error -- Express 4 under an alias; typed as Express 5 below.
import express4 from 'express4'
import { afterEach, describe, expect, it } from 'vitest'
import { apidoc, renderApidocHtml, type ExpressApidocOptions } from '../src'

const servers: { close(): void }[] = []
afterEach(() => servers.splice(0).forEach(server => server.close()))

type Express = typeof express

async function serve(app: ReturnType<Express>) {
  const server = app.listen(0)
  servers.push(server)
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return (path: string, init?: RequestInit) => fetch(base + path, { redirect: 'manual', ...init })
}

function docsApp(factory: Express, options: ExpressApidocOptions<any, any>, mount = '/docs') {
  const app = factory()
  app.use(mount, apidoc(options))
  app.use((_req, res) => res.status(404).send('app 404'))
  return serve(app)
}

const spec = { openapi: '3.1.0', info: { title: 'Orbit <API>', version: '1.0.0' }, paths: {} }

describe.each([
  ['Express 5', express],
  ['Express 4', express4 as unknown as Express],
])('%s', (_name, factory) => {
  it('serves the page with the spec URL and the bundle from the app', async () => {
    const get = await docsApp(factory, { specUrl: '/openapi.json', title: 'Orbit' })
    const response = await get('/docs/')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const html = await response.text()
    expect(html).toContain('<title>Orbit</title>')
    expect(html).toContain('<api-docs spec-url="/openapi.json"></api-docs>')
    expect(html).toContain('src="_static/apidoc.js"')

    const bundle = await get('/docs/_static/apidoc.js')
    expect(bundle.status).toBe(200)
    expect(bundle.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(bundle.headers.get('cache-control')).toBe('no-cache')
    expect((await bundle.text()).length).toBeGreaterThan(10_000)
  })

  it('redirects the bare mount to the trailing-slash URL, relative so proxy prefixes survive', async () => {
    const get = await docsApp(factory, { specUrl: '/openapi.json' })
    const response = await get('/docs?tab=1')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('docs/?tab=1')
  })

  it('serves an inline spec next to the page and titles the page from it', async () => {
    const get = await docsApp(factory, { spec }, '/reference')
    const html = await (await get('/reference/')).text()
    expect(html).toContain('<title>Orbit &lt;API&gt;</title>')
    expect(html).toContain('spec-url="openapi.json"')
    const document = await get('/reference/openapi.json')
    expect(document.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(await document.json()).toEqual(spec)
  })

  it('serves YAML text as openapi.yaml', async () => {
    const get = await docsApp(factory, { spec: 'openapi: 3.0.3\ninfo: {title: Y, version: "1"}\npaths: {}\n' })
    expect(await (await get('/docs/')).text()).toContain('spec-url="openapi.yaml"')
    const document = await get('/docs/openapi.yaml')
    expect(document.headers.get('content-type')).toBe('application/yaml; charset=utf-8')
    expect(await document.text()).toContain('openapi: 3.0.3')
  })

  it('calls a spec function per request with the request', async () => {
    const seen: string[] = []
    const get = await docsApp(factory, {
      spec: (req: express.Request) => {
        seen.push(req.get('x-tenant') ?? '')
        return { ...spec, info: { ...spec.info, title: `Tenant ${req.get('x-tenant')}` } }
      },
    })
    expect(await (await get('/docs/', { headers: { 'x-tenant': 'a' } })).text()).toContain('<title>Tenant a</title>')
    const document = (await (await get('/docs/openapi.json', { headers: { 'x-tenant': 'b' } })).json()) as typeof spec
    expect(document.info.title).toBe('Tenant b')
    expect(seen).toEqual(['a', 'b'])
  })

  it('serves hashed chunks as immutable and answers If-None-Match with 304', async () => {
    const get = await docsApp(factory, { specUrl: '/openapi.json' })
    const entry = await (await get('/docs/_static/apidoc.js')).text()
    const chunk = entry.match(/chunks\/[\w.-]+\.js/)?.[0]
    expect(chunk).toBeDefined()
    const response = await get(`/docs/_static/${chunk}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')

    const etag = response.headers.get('etag')!
    const again = await get(`/docs/_static/${chunk}`, { headers: { 'if-none-match': etag } })
    expect(again.status).toBe(304)
    expect(await again.text()).toBe('')
  })

  it('passes everything else on to the app', async () => {
    const get = await docsApp(factory, { specUrl: '/openapi.json' })
    for (const path of ['/docs/_static/../../package.json', '/docs/_static/chunks/nope.js', '/docs/_static/%2e%2e/package.json', '/docs/openapi.json', '/docs/other']) {
      const response = await get(path)
      expect([404, 400], path).toContain(response.status)
    }
    expect((await get('/docs/', { method: 'POST' })).status).toBe(404)
    expect(await (await get('/docs/other')).text()).toBe('app 404')
  })

  it('answers HEAD without a body', async () => {
    const get = await docsApp(factory, { specUrl: '/openapi.json' })
    const response = await get('/docs/', { method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
  })

  it('adds the CSP nonce from res.locals.cspNonce', async () => {
    const app = factory()
    app.use((_req, res, next) => {
      res.locals.cspNonce = 'n0nce"'
      next()
    })
    app.use('/docs', apidoc({ specUrl: '/openapi.json' }))
    const html = await (await (await serve(app))('/docs/')).text()
    expect(html).toContain('<style nonce="n0nce&quot;">')
    expect(html).toContain('src="_static/apidoc.js" nonce="n0nce&quot;"')
    expect(html).toContain(' nonce="n0nce&quot;"></api-docs>')
  })

  it('passes CSRF settings and a per-request token to the element', async () => {
    const app = factory()
    // Annotating the callback gives it Express's own Request type; app.use accepts the result.
    app.use('/docs', apidoc({ specUrl: '/openapi.json', csrf: { header: 'x-csrf-token', cookie: 'csrf', token: (req: express.Request) => `token-for-${req.path}` } }))
    const html = await (await (await serve(app))('/docs/')).text()
    expect(html).toContain('csrf-header="x-csrf-token" csrf-cookie="csrf" csrf-token="token-for-/"')
  })

  it('uses bundleUrl instead of serving the bundle', async () => {
    const cdn = 'https://cdn.jsdelivr.net/npm/@binarycastle/apidoc@0.1/dist/apidoc.js'
    const get = await docsApp(factory, { specUrl: '/openapi.json', bundleUrl: cdn })
    expect(await (await get('/docs/')).text()).toContain(`src="${cdn}"`)
    expect((await get('/docs/_static/apidoc.js')).status).toBe(404)
  })

  it('reports errors from a spec function to Express', async () => {
    const app = factory()
    app.use(
      '/docs',
      apidoc({
        spec: () => {
          throw new Error('no spec today')
        },
      }),
    )
    app.use((error: Error, _req: unknown, res: { status(code: number): { send(body: string): void } }, _next: unknown) => res.status(500).send(error.message))
    const response = await (await serve(app))('/docs/openapi.json')
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('no spec today')
  })
})

describe('apidoc options', () => {
  it('needs exactly one of specUrl and spec', () => {
    expect(() => apidoc({})).toThrow(/specUrl/)
    expect(() => apidoc({ specUrl: '/a', spec })).toThrow(/not both/)
  })

  it('rejects an unknown theme', () => {
    expect(() => apidoc({ specUrl: '/a', theme: 'blue' as 'dark' })).toThrow(/theme/)
  })
})

describe('renderApidocHtml', () => {
  it('writes versions and workflows as attributes and fixes the background for a theme', () => {
    const html = renderApidocHtml({
      specUrl: '/openapi.yaml',
      bundleUrl: '/static/apidoc.js',
      theme: 'light',
      versions: [{ version: '2.3.0', url: '/openapi-2.3.0.yaml' }],
      workflowsUrl: '/flows.arazzo.yaml',
    })
    expect(html).toContain('theme="light"')
    expect(html).toContain('versions="[{&quot;version&quot;:&quot;2.3.0&quot;,&quot;url&quot;:&quot;/openapi-2.3.0.yaml&quot;}]"')
    expect(html).toContain('workflows-url="/flows.arazzo.yaml"')
    expect(html).toContain('background: #fff;')
    expect(html).not.toContain('prefers-color-scheme')
    expect(html).toContain('<title>API Reference</title>')
  })

  it('takes separate script and style nonces', () => {
    const html = renderApidocHtml({ specUrl: '/s', bundleUrl: '/b', nonce: { script: 'js', style: 'css' } })
    expect(html).toContain('<style nonce="css">')
    expect(html).toContain('<script type="module" src="/b" nonce="js">')
    expect(html).toContain('nonce="css"></api-docs>')
  })

  it('adds branding attributes and a favicon', () => {
    const html = renderApidocHtml({ specUrl: '/s', bundleUrl: '/b', accent: '#14b8a6', logo: 'logo.svg', logoDark: 'logo-dark.svg', cssUrl: 'brand.css', faviconUrl: 'favicon.svg' })
    expect(html).toContain('accent="#14b8a6" logo="logo.svg" logo-dark="logo-dark.svg" css-url="brand.css"')
    expect(html).toContain('<link rel="icon" href="favicon.svg">')
    expect(renderApidocHtml({ specUrl: '/s', bundleUrl: '/b' })).not.toMatch(/accent=|logo=|css-url=|rel="icon"/)
  })

  it('passes OAuth sign-in defaults', () => {
    const html = renderApidocHtml({ specUrl: '/s', bundleUrl: '/b', oauthClientId: 'docs', oauthScopes: ['read', 'write'] })
    expect(html).toContain('oauth-client-id="docs" oauth-scopes="read write"')
  })

  it('ignores the CSRF cookie and token without a header', () => {
    const html = renderApidocHtml({ specUrl: '/s', bundleUrl: '/b', csrfCookie: 'c', csrfToken: 't' })
    expect(html).not.toContain('csrf')
  })
})
