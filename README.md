# apidoc

OpenAPI documentation you can actually work in — a reference, a request
playground and ⌘K search over any OpenAPI 3.0/3.1 or Swagger 2.0 document.

The design lives in [`design.fig`](design.fig) (open it in OpenPencil; pages
**Dark** and **Light**).

## Layout

```
packages/core     Framework-agnostic engine: load (URL/JSON/YAML), Swagger 2.0 → 3.0
                  upgrade, $ref resolution, normalized model, example generation,
                  request building, code snippets, search index, and the contract
                  check (an eval-free JSON Schema validator for 3.0 and 3.1).
                  No UI, no Node-only deps.
packages/ui       React UI (<ApiReference spec="…" />): reference, playground, ⌘K palette.
                  `pnpm dev` runs a dev host with a spec switcher.
packages/cli      `apidoc diff <old> <new> --fail-on breaking` for CI (files, URLs or
                  git revisions like origin/main:openapi.yaml).
packages/standalone
                  <api-docs> web component: one ES module (dist/apidoc.js) with React
                  bundled, rendered in Shadow DOM so host-page CSS can't leak in.
integrations/django
                  apidoc-django: ApiDocView serves the docs from your Django project,
                  bundle included as static files, CSRF wired for session auth.
integrations/fastapi
                  apidoc-fastapi: mount_apidoc(app) serves the docs and bundle from the app.
examples/specs    Specs used for tests and the dev host:
                  orbit.yaml (hand-written 3.1) and its previous release orbit-2.3.0.yaml,
                  django-spectacular.yaml, django-yasg.json, fastapi.json
examples/django   DRF example app exposing both drf-spectacular (3.0) and drf-yasg (2.0).
examples/fastapi  FastAPI example app (3.1, Pydantic models) with apidoc at /docs.
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
corepack pnpm build:integrations       # bundle -> integrations/django static files
cd examples/django
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python manage.py migrate
.venv/bin/python manage.py seed_demo_user   # staff login: demo / orbit-demo-password
.venv/bin/python manage.py runserver 8000
```

- http://localhost:8000/docs/ — docs served by Django through `apidoc-django`.
  Log in at `/admin/` first and playground requests use your session (CSRF handled).
  "Retrieve a customer" deliberately returns an undocumented `tax_ids` field so
  the contract check has something to report.
- Or pick **Django · drf-spectacular (live)** in the UI dev host's switcher
  (bottom-right) to load the same API cross-origin.

### FastAPI example

```bash
corepack pnpm build:integrations
cd examples/fastapi
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --port 8001
```

http://localhost:8001/docs is apidoc; FastAPI's Swagger UI is at `/swagger`.
Regenerate the fixture with
`.venv/bin/python -c "import json, main; json.dump(main.app.openapi(), open('../specs/fastapi.json', 'w'), indent=2)"`.

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

| Backend | Package | Docs |
|---|---|---|
| Django (DRF, drf-spectacular, drf-yasg, django-ninja) | `apidoc-django` | [integrations/django](integrations/django/README.md) |
| FastAPI | `apidoc-fastapi` | [integrations/fastapi](integrations/fastapi/README.md) |
| Anything else | `<api-docs>` + the bundle | see "Embedding anywhere" above |

Session-cookie APIs get CSRF support from the element's `csrf-header`,
`csrf-cookie` and `csrf-token` attributes (Django, Rails and Laravel all fit).
The token is only sent on unsafe, same-origin requests.

Integration tests: `python runtests.py` in `integrations/django` and `integrations/fastapi`.

## Status

Done:
- Core engine with tests against drf-spectacular, drf-yasg and a 3.1 spec
- Reference page (A01), Playground with history (A02), ⌘K palette (A03)
- Dark and light themes, mobile layout
- `packages/standalone`: `<api-docs>` web component, Shadow DOM isolated
- `apidoc-django`: docs served by Django, session auth + CSRF, CSP nonces
- `apidoc-fastapi`: `mount_apidoc(app)`, root_path aware, can replace Swagger UI
- Contract check: every playground response is validated against the spec
  (status, content type, body schema, undocumented fields) with a suggested
  YAML patch for fields the spec is missing
- Changelog: release history, any-two-versions diff with breaking-change
  rules, NEW/CHANGED badges, Markdown upgrade notes, and `apidoc diff` for CI

## Changelog and breaking changes

Give the docs your older releases and they show what changed:

```html
<api-docs spec-url="/openapi.yaml"
  versions='[{"version":"2.3.0","url":"/openapi-2.3.0.yaml","date":"2026-09-18"}]'></api-docs>
```

(`versions` on `<ApiReference>`, `APIDOC["VERSIONS"]` in Django, `versions=` in FastAPI.)
The Changelog page lists releases, compares any two, groups changes per
endpoint with before/after schema fragments, and writes Markdown upgrade notes.
Endpoints get NEW/CHANGED badges. Without configured versions you can still
compare against any spec by URL or by dropping a file.

Whether a change breaks clients depends on direction: narrowing what the API
accepts (new required fields, removed enum values, tighter limits, new
patterns) breaks requests; widening what it returns (removed fields, new enum
values, fields that may now be null or missing) breaks responses. Operations
are matched on method + full path, so renamed path parameters and a base path
moving between `servers` and `paths` are not reported as remove + add.

The same engine runs in CI:

```bash
apidoc diff origin/main:openapi.yaml openapi.yaml --fail-on breaking
apidoc diff old.json https://api.example.com/openapi.json --format markdown
```

Exit codes: 0 ok, 1 when `--fail-on` is reached, 2 for usage or load errors.
Build it with `corepack pnpm --filter @apidoc/cli build` (→ `packages/cli/dist/apidoc.mjs`).

## Contract check

After each playground request apidoc compares the live response with the spec:

- **Status** must be documented (exact, then `2XX`-style ranges, then `default`).
- **Content-Type** must match a documented media type (wildcards allowed).
- **Body** is validated against the response schema. OpenAPI 3.0 (`nullable`,
  boolean `exclusiveMinimum`) and 3.1 (`type: [x, "null"]`, `const`,
  `prefixItems`) are both understood, as are `allOf`, `anyOf`, `oneOf` with
  discriminators, and `additionalProperties`.
- **Undocumented fields** (returned but not in the spec) are warnings, with a
  suggested YAML patch for `components/schemas`.

Errors mean the API broke its documented contract; warnings mean the spec is
incomplete. The validator is interpreted (no `eval`/`new Function`), so it runs
under a strict Content-Security-Policy.

Next:
- Integrations: Express/NestJS
- Publish the bundle (npm → jsDelivr/unpkg)
- Workflows / Arazzo (A05)
- Optional proxy for cross-origin "Try it" and DNS/TLS timing
