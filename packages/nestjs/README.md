# @binarycastle/apidoc-nestjs

[apidoc](https://github.com/binary-castle/apidoc) for NestJS: an OpenAPI
reference, a request playground with a contract check, a changelog between
releases and runnable Arazzo workflows, set up like Swagger UI.

**[Live demo](https://binary-castle.github.io/apidoc/)** · [Documentation](https://github.com/binary-castle/apidoc#readme)

```bash
npm install @binarycastle/apidoc-nestjs
```

```ts
import { ApidocModule } from '@binarycastle/apidoc-nestjs'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

const app = await NestFactory.create(AppModule)
const config = new DocumentBuilder().setTitle('Orbit').setVersion('1.0.0').build()
const document = SwaggerModule.createDocument(app, config)

ApidocModule.setup('docs', app, document)   // → /docs/
await app.listen(3000)
```

The document is served at `/docs/openapi.json` and the UI bundle from
`/docs/_static/`, so nothing loads from a CDN and "Try it" calls your API
same-origin. Keep `SwaggerModule.setup('swagger', app, document)` alongside it
if you like.

- Works with `@nestjs/platform-express` and `@nestjs/platform-fastify`.
- Works with NestJS 10, 11 (CommonJS) and 12 (ESM); it has no dependency on Nest itself.
- `document` may be a factory, `() => SwaggerModule.createDocument(app, config)`,
  called once on the first request.

## Options

`ApidocModule.setup(path, app, document, options)`:

| Option | |
|---|---|
| `useGlobalPrefix` | Put the docs under `app.setGlobalPrefix(...)`. Off by default, like `SwaggerModule`. |
| `title` | Page title. Defaults to the document's `info.title`. |
| `theme` | `'dark'` or `'light'`. Omit to follow the viewer, then their OS. |
| `versions` | Older releases, newest first, for the changelog: `[{ version: '2.3.0', url: '/openapi-2.3.0.json' }]` |
| `workflowsUrl` | An Arazzo 1.x document with multi-step workflows to run from the docs. |
| `csrf` | `{ header, cookie?, token?: (req, res) => string }` for cookie-session APIs. |
| `nonce` | `(req, res) => nonce` for a strict CSP. Defaults to `res.locals.cspNonce` (Express) or `reply.cspNonce` from @fastify/helmet. |
| `accent`, `logo`, `logoDark`, `cssUrl`, `faviconUrl` | Branding: brand colour, logos, a stylesheet that can override any `--ad-*` token, favicon. |
| `bundleUrl` | Load the UI from a CDN instead of serving it. |
| `specUrl` | With `document` set to `null`: point at a spec served elsewhere. |

```ts
ApidocModule.setup('docs', app, null, { specUrl: '/api-json' })
```

MIT licensed.
