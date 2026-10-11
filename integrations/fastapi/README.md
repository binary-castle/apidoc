# apidoc-fastapi

Serve the apidoc API reference, playground and ⌘K search from your FastAPI
app, next to (or instead of) Swagger UI.

**[Live demo](https://binary-castle.github.io/apidoc/)** · [Documentation](https://github.com/binary-castle/apidoc#readme)

```bash
pip install apidoc-fastapi
```

```python
from fastapi import FastAPI
from apidoc_fastapi import mount_apidoc

app = FastAPI(title="Orbit Payments API")
mount_apidoc(app)                  # -> /reference
```

The spec URL and title come from the app (`app.openapi_url`, `app.title`).
URLs respect `root_path`, so apps behind a path-prefixing proxy work unchanged.

### Replace Swagger UI

```python
app = FastAPI(docs_url=None)       # free up /docs
mount_apidoc(app, "/docs")
```

## Why serve docs from the app

- **"Try it" just works.** Docs and API share an origin: no CORS setup, no proxy.
- **No CDN.** The JS bundle ships inside the wheel and is served by
  `StaticFiles` under `{path}/_static`, so docs work offline and on intranets.

## Options

```python
mount_apidoc(
    app,
    "/reference",
    openapi_url=None,   # default: app.openapi_url
    title=None,         # default: app.title
    theme=None,         # "dark" | "light" | None (viewer's choice, then OS)
    bundle_url=None,    # e.g. "https://cdn.jsdelivr.net/npm/@binarycastle/apidoc@0.1/dist/apidoc.js"
    csrf_header=None,   # e.g. "X-CSRF-Token" for cookie sessions with
    csrf_cookie=None,   # double-submit CSRF, e.g. "fastapi-csrf-token"
    versions=None,      # older releases for the changelog, newest first:
                        # [{"version": "1.2.0", "url": "/specs/1.2.0.json", "date": "2026-09-18"}]
    workflows_url=None, # Arazzo document with runnable multi-step workflows
    accent=None,        # brand colour (any CSS colour); both themes derive from it
    logo=None,          # top-bar logo URL; logo_dark= for a dark-theme variant
    css_url=None,       # stylesheet that can override any --ad-* token
    favicon_url=None,
    oauth_client_id=None,  # prefill OAuth sign-in; register the docs URL as a redirect URI
    oauth_scopes=None,     # scopes to preselect, e.g. ["profile"]
)
```

The CSRF header is only sent on `POST`/`PUT`/`PATCH`/`DELETE` to the same
origin, never cross-origin.

### Your own route

`get_apidoc_html()` returns the page as an `HTMLResponse`, like FastAPI's
`get_swagger_ui_html()`, e.g. to add auth or a CSP nonce:

```python
from apidoc_fastapi import get_apidoc_html

@app.get("/docs", include_in_schema=False)
async def docs(request: Request, user=Depends(require_staff)):
    return get_apidoc_html(
        openapi_url=app.openapi_url,
        bundle_url="https://cdn.example/apidoc/apidoc.js",
        nonce=request.state.csp_nonce,
    )
```

## Development

From the apidoc repository:

```bash
corepack pnpm build:integrations   # build the JS bundle into src/apidoc_fastapi/static/
python runtests.py                  # needs fastapi + httpx2 (httpx on Starlette < 1.7)
```
