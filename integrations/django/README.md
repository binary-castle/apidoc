# apidoc-django

Serve the apidoc API reference, playground and ⌘K search from your Django
project. Works with any OpenAPI source: drf-spectacular, drf-yasg, django-ninja,
or a static file.

```bash
pip install apidoc-django
```

```python
# settings.py
INSTALLED_APPS = [..., "django.contrib.staticfiles", "apidoc_django"]

# urls.py
from apidoc_django.views import ApiDocView

urlpatterns = [
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),  # drf-spectacular
    path("docs/", ApiDocView.as_view(schema_url="schema")),
]
```

`schema_url` takes a URL name (`"schema"`), a path (`"/api/swagger.json"` for
drf-yasg, `"/api/openapi.json"` for django-ninja) or an absolute URL.

## Why serve docs from Django

- **"Try it" just works.** Docs and API share an origin, so there is no CORS
  setup and no proxy.
- **Session auth works.** If you're logged in (e.g. via the admin), playground
  requests carry your session cookie, and the page passes Django's CSRF token
  so `POST`/`PUT`/`PATCH`/`DELETE` pass `SessionAuthentication`. The token is
  only ever sent to the same origin.
- **No CDN.** The JS bundle ships inside the wheel as static files, so the docs
  work offline and on intranets. `collectstatic` picks it up as usual.

## Options

Pass them to `ApiDocView.as_view(...)` or set them project-wide:

```python
APIDOC = {
    "SCHEMA_URL": "schema",  # URL name, path or absolute URL
    "TITLE": "Orbit API",    # page <title>, default "API Reference"
    "THEME": None,           # "dark" | "light" | None (viewer's choice, then OS)
    "BUNDLE_URL": None,      # e.g. "https://cdn.jsdelivr.net/npm/@binarycastle/apidoc@0.1/dist/apidoc.js"
    "CSRF": True,            # pass the CSRF token to the playground
    "VERSIONS": [],          # older releases for the changelog, newest first
}
```

`VERSIONS` turns on the changelog and NEW/CHANGED badges:

```python
"VERSIONS": [
    {"version": "1.2.0", "url": "/static/openapi/1.2.0.yaml", "date": "2026-09-18"},
    {"version": "1.1.0", "url": "/static/openapi/1.1.0.yaml", "date": "2026-07-02"},
]
```

Export each release with `manage.py spectacular --file openapi-<version>.yaml`
when you tag it.

With settings in place you can also use the bundled URLconf:

```python
path("docs/", include("apidoc_django.urls"))
```

## Restricting access

`ApiDocView` is a regular class-based view, so wrap it like any other:

```python
from django.contrib.admin.views.decorators import staff_member_required

path("docs/", staff_member_required(ApiDocView.as_view(schema_url="schema")))
```

Protect the schema endpoint too: drf-spectacular takes `permission_classes`
on `SpectacularAPIView`.

## Content-Security-Policy

If your site sends a CSP, the page uses the per-request nonce from django-csp
or Django 6's built-in CSP (`request.csp_nonce`) for its `<script>` and the one
`<style>` it adds to the document. The bundled fonts are `data:` URLs, so
allow `font-src 'self' data:`.

## Development

From the apidoc repository:

```bash
corepack pnpm build:integrations   # build the JS bundle into src/apidoc_django/static/
python runtests.py                  # needs Django installed
```

`python manage.py check` warns (`apidoc_django.W001`) when the bundle is
missing from a source checkout.
