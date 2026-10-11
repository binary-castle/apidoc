# @binarycastle/apidoc-express

Serve [apidoc](https://github.com/binary-castle/apidoc) from an Express app:
an OpenAPI reference, a request playground with a contract check, a changelog
between releases and runnable Arazzo workflows. The UI bundle is served by
your app (no CDN), so "Try it" calls your API same-origin, without CORS.

**[Live demo](https://binary-castle.github.io/apidoc/)** · [Documentation](https://github.com/binary-castle/apidoc#readme)

```bash
npm install @binarycastle/apidoc-express
```

```js
import { apidoc } from '@binarycastle/apidoc-express'

app.use('/docs', apidoc({ specUrl: '/openapi.json' }))
```

Open `/docs/`. `/docs` redirects there so relative URLs keep working behind a
proxy that adds a path prefix.

Works with Express 4 and 5, from CommonJS and ESM. Using NestJS? See
[`@binarycastle/apidoc-nestjs`](https://www.npmjs.com/package/@binarycastle/apidoc-nestjs).

## Serving the document too

Already building the document in code (swagger-jsdoc, zod-to-openapi, tsoa…)?
Pass it as `spec` and it is served next to the docs as `openapi.json`:

```js
app.use('/docs', apidoc({ spec: openapiDocument }))
```

`spec` also takes JSON or YAML text (served as `openapi.yaml`), or a function
`(req) => document` called per request, for example per tenant.

## Options

| Option | |
|---|---|
| `specUrl` | URL of the OpenAPI/Swagger document. Relative URLs resolve against the docs page. |
| `spec` | The document itself, instead of `specUrl`. |
| `title` | Page title. Defaults to `info.title` of `spec`, else "API Reference". |
| `theme` | `'dark'` or `'light'`. Omit to follow the viewer, then their OS. |
| `versions` | Older releases, newest first, for the changelog: `[{ version: '2.3.0', url: '/openapi-2.3.0.yaml', date: '2026-09-18' }]` |
| `workflowsUrl` | An Arazzo 1.x document with multi-step workflows to run from the docs. |
| `csrf` | `{ header, cookie?, token? }` for cookie-session APIs (see below). |
| `nonce` | `(req, res) => nonce` for a strict CSP. Defaults to `res.locals.cspNonce`. |
| `accent` | Brand colour (any CSS colour). The palette for both themes is derived from it, keeping text readable. |
| `logo`, `logoDark` | Top-bar logo, and a variant for the dark theme. |
| `cssUrl` | Stylesheet applied inside the docs after the theme; can override any `--ad-*` token. |
| `faviconUrl` | Favicon for the docs page. |
| `oauthClientId`, `oauthScopes` | Prefill OAuth sign-in in the playground. Register the docs URL as a redirect URI. |
| `bundleUrl` | Load the UI from a CDN instead of serving it, e.g. `https://cdn.jsdelivr.net/npm/@binarycastle/apidoc@0.1/dist/apidoc.js`. |

### Session cookies and CSRF

The playground sends the viewer's cookies. If unsafe requests need a CSRF
token, tell apidoc where it lives:

```js
import { doubleCsrf } from 'csrf-csrf'
const { generateCsrfToken } = doubleCsrf({ /* … */ })

app.use('/docs', apidoc({
  specUrl: '/openapi.json',
  csrf: { header: 'x-csrf-token', token: (req, res) => generateCsrfToken(req, res) },
}))
```

Or `csrf: { header: 'x-xsrf-token', cookie: 'XSRF-TOKEN' }` for a readable
cookie. The token is only sent on unsafe, same-origin requests.

### Content-Security-Policy

The page has one inline `<style>` and one module `<script>`, both carrying the
nonce. With helmet:

```js
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64')
  next()
})
app.use(helmet({ contentSecurityPolicy: { directives: {
  scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
  styleSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
} } }))
```

## Other Node frameworks

`createApidoc(options)` is the framework-agnostic core: give it
`{ method, url, mount, ifNoneMatch, req, res }` and it returns
`{ status, headers, body }` or `undefined`. `send(res, response)` writes that to
a Node `ServerResponse`. `renderApidocHtml()` returns just the page.

```js
import { createServer } from 'node:http'
import { createApidoc, send } from '@binarycastle/apidoc-express'

const docs = createApidoc({ specUrl: '/openapi.json' })
createServer(async (req, res) => {
  const response = await docs({ method: req.method, url: req.url, mount: '/docs', ifNoneMatch: req.headers['if-none-match'], req, res })
  if (response) return send(res, response)
  // … your routes
}).listen(3000)
```

MIT licensed.
