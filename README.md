# apidoc

OpenAPI documentation you can actually work in — a reference, a request
playground and ⌘K search over any OpenAPI 3.0/3.1 or Swagger 2.0 document.

The design lives in [`design.fig`](design.fig) (open it in OpenPencil; pages
**Dark** and **Light**).

## Layout

```
packages/core     Framework-agnostic engine: load (URL/JSON/YAML), Swagger 2.0 → 3.0
                  upgrade, $ref resolution, normalized model, example generation,
                  request building, code snippets, search index. No UI, no Node-only deps.
packages/ui       React UI (<ApiReference spec="…" />): reference, playground, ⌘K palette.
                  `pnpm dev` runs a dev host with a spec switcher.
packages/standalone
                  <api-docs> web component: one ES module (dist/apidoc.js) with React
                  bundled, rendered in Shadow DOM so host-page CSS can't leak in.
examples/specs    Specs used for tests and the dev host:
                  orbit.yaml (hand-written 3.1), django-spectacular.yaml, django-yasg.json
examples/django   DRF example app exposing both drf-spectacular (3.0) and drf-yasg (2.0).
```

## Getting started

pnpm is pinned in `package.json` and run through Corepack (bundled with Node):

```bash
corepack pnpm install
corepack pnpm dev            # http://localhost:5173 (PORT env overrides)
corepack pnpm test           # core unit tests
corepack pnpm typecheck
```

Open `?spec=<url>` to load any spec, e.g.
`http://localhost:5173/?spec=https://petstore3.swagger.io/api/v3/openapi.json`.
`?theme=dark|light` forces a theme.

### Django example (live "Try it")

```bash
cd examples/django
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver 8000
```

Then pick **Django · drf-spectacular (live)** in the dev host's switcher
(bottom-right). Requests from the playground hit the real API.

Regenerate the fixtures after changing the example:

```bash
.venv/bin/python manage.py spectacular --file ../specs/django-spectacular.yaml
.venv/bin/python manage.py generate_swagger -f json -o --url http://localhost:8000 ../specs/django-yasg.json
```

## Embedding anywhere (standalone bundle)

```html
<api-docs spec-url="/openapi.json"></api-docs>
<script type="module" src="https://YOUR-CDN/apidoc/dist/apidoc.js"></script>
```

- `spec-url` — URL of the OpenAPI/Swagger document (JSON or YAML).
- `theme` — `dark` or `light`; omit to follow the viewer's choice, then their OS.
- Height defaults to the viewport; set `style="--apidoc-height: 600px"` to change it.
- Inline spec instead of a URL: put `<script type="application/json">{…}</script>`
  (or `type="application/yaml"`) inside the element.
- From JavaScript: `document.querySelector('api-docs').spec = { content: specObject }`.

Build and try it against a deliberately hostile host page:

```bash
corepack pnpm --filter @apidoc/standalone build
corepack pnpm --filter @apidoc/standalone preview   # open /demo.html
```

The entry is ~181 KB gzipped (React included). The syntax highlighter and the
fonts (inlined, no third-party font CDN) load as separate chunks on demand.

## How it supports every backend

The UI only needs the URL of an OpenAPI document. Each backend integration is
a thin package that serves one HTML page loading the bundle and pointing it at
that framework's spec URL. Serving docs from the API's own domain also makes
"Try it" work without CORS or a proxy.

## Status

Done:
- Core engine with tests against drf-spectacular, drf-yasg and a 3.1 spec
- Reference page (A01), Playground with history (A02), ⌘K palette (A03)
- Dark and light themes, mobile layout
- `packages/standalone`: `<api-docs>` web component, Shadow DOM isolated

Next:
- Integrations: Django (`apidoc-django`), FastAPI, Express/NestJS
- Publish the bundle (npm → jsDelivr/unpkg)
- Contract check (validate live responses against the spec with Ajv)
- Changelog / spec diff (A04), Workflows / Arazzo (A05)
- Optional proxy for cross-origin "Try it" and DNS/TLS timing
