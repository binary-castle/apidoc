# Changelog

All packages are released together with the same version.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.1.0 — unreleased

First release.

### Docs UI (`@binarycastle/apidoc`)

- `<api-docs>` web component: one ES module with React bundled, rendered in
  Shadow DOM so the host page's CSS can't leak in. Syntax highlighting and
  fonts load on demand; no third-party CDNs.
- Reads OpenAPI 3.1, 3.0 and Swagger 2.0, as JSON or YAML, from a URL or inline.
- Reference pages with schema trees, examples and code snippets (cURL,
  JavaScript, Python, Go, HTTP); dark and light themes; mobile layout.
- Playground with request history, auth (bearer, basic, API keys, and pasted
  OAuth2/OpenID Connect tokens) and CSRF handling for cookie-session APIs.
- ⌘K search across endpoints, models and fields.
- Contract check: every playground response is validated against the spec
  (status, content type, body schema, undocumented fields), with a suggested
  YAML patch for fields the spec is missing.
- Changelog: release history, any-two-versions diff with direction-aware
  breaking-change rules, NEW/CHANGED badges and Markdown upgrade notes.
- Workflows: runs Arazzo 1.0 workflows (run all or step through) with a live
  timeline and per-step contract check; exports them to TypeScript, Python
  or a `.http` file.
- Works under a strict Content-Security-Policy (no `eval`, nonce support).

### CLI (`@binarycastle/apidoc-cli`)

- `apidoc diff <old> <new>`: compares files, URLs or git revisions, with
  text, Markdown and JSON output and `--fail-on breaking|warning` for CI.
- `apidoc run <arazzo>`: runs Arazzo workflows as smoke tests.

### Backend integrations

- `apidoc-django`: `ApiDocView` for DRF, drf-spectacular, drf-yasg and
  django-ninja; the bundle ships as static files; session auth with CSRF; CSP nonces.
- `apidoc-fastapi`: `mount_apidoc(app)`; respects `root_path`; can replace Swagger UI.
- `@binarycastle/apidoc-express`: Express 4/5 middleware, plus `createApidoc()`
  for any Node server.
- `@binarycastle/apidoc-nestjs`: `ApidocModule.setup()` for NestJS 10–12 on
  the Express or Fastify adapter.
