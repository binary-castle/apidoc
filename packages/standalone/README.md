# @binarycastle/apidoc

OpenAPI documentation you can work in: an API reference, a request playground
that checks every live response against the spec, ⌘K search over endpoints,
schemas and fields, a changelog with breaking-change detection, and runnable
multi-step workflows (Arazzo). One ES
module, no framework required.

**[Live demo](https://binary-castle.github.io/apidoc/)** · [Documentation](https://github.com/binary-castle/apidoc#readme)

Works with any OpenAPI 3.0/3.1 or Swagger 2.0 document: drf-spectacular,
drf-yasg, FastAPI, NestJS, springdoc, Laravel Scramble, a static file…

## Use it

```html
<api-docs spec-url="/openapi.json"></api-docs>
<script type="module" src="https://cdn.jsdelivr.net/npm/@binarycastle/apidoc@0.1/dist/apidoc.js"></script>
```

Or from npm with your bundler:

```bash
npm install @binarycastle/apidoc
```

```js
import '@binarycastle/apidoc' // registers <api-docs>
```

The element renders in Shadow DOM, so your page's CSS can't break it (and its
CSS can't leak out). Fonts and the syntax highlighter load on demand from the
same place as `apidoc.js`; nothing is fetched from third-party CDNs.

## Attributes

| Attribute | |
|---|---|
| `spec-url` | URL of the OpenAPI/Swagger document (JSON or YAML) |
| `theme` | `dark` or `light`; omit to follow the viewer's choice, then their OS |
| `versions` | JSON list of older releases, newest first, for the changelog: `[{"version":"1.2.0","url":"/openapi-1.2.0.yaml","date":"2026-09-18"}]` |
| `workflows-url` | An [Arazzo 1.0](https://spec.openapis.org/arazzo/latest.html) document; its workflows become runnable pages |
| `csrf-header`, `csrf-cookie`, `csrf-token` | Send a CSRF header on unsafe same-origin requests (cookie-session APIs) |
| `nonce` | CSP nonce for the one `<style>` the element adds to the document |
| `accent` | Brand colour (any CSS colour); the accent palette for both themes is derived from it, keeping text readable |
| `logo`, `logo-dark`, `logo-href` | Top-bar logo, a dark-theme variant, and where it links. Defaults to the spec's `info.x-logo` |
| `oauth-client-id`, `oauth-scopes`, `oauth-redirect-url` | Prefill OAuth sign-in: the docs' client id, space-separated scopes, and a same-origin redirect URL (default: this page) |
| `css-url` | Stylesheet applied inside the shadow root after the theme; override any `--ad-*` token or style `.apidoc` |

Relative URLs in attributes resolve against the page, like any other HTML
attribute. For CSS text instead of a file, set the `customCss` property. Height defaults to the viewport; set
`style="--apidoc-height: 600px"` to change it.

Inline spec instead of a URL:

```html
<api-docs>
  <script type="application/json">{ "openapi": "3.1.0", … }</script>
</api-docs>
```

From JavaScript: `document.querySelector('api-docs').spec = { content: specObject }`.

## Content-Security-Policy

No `eval` or `new Function` anywhere, including the response validator. Under
a strict CSP, pass your nonce via the `nonce` attribute and allow
`font-src 'self' data:` for the bundled fonts.

## Framework integrations

- Django: [`apidoc-django`](https://pypi.org/project/apidoc-django/)
- FastAPI: [`apidoc-fastapi`](https://pypi.org/project/apidoc-fastapi/)
- CI breaking-change check: [`@binarycastle/apidoc-cli`](https://www.npmjs.com/package/@binarycastle/apidoc-cli)

MIT licensed. Source: https://github.com/binary-castle/apidoc
