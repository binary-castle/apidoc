from __future__ import annotations

from html import escape
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

STATIC_DIR = Path(__file__).parent / "static"

Theme = Literal["dark", "light"]


def get_apidoc_html(
    *,
    openapi_url: str,
    title: str = "API Reference",
    bundle_url: str,
    theme: Theme | None = None,
    csrf_header: str | None = None,
    csrf_cookie: str | None = None,
    nonce: str | None = None,
) -> HTMLResponse:
    """
    The docs page as an HTMLResponse, like FastAPI's ``get_swagger_ui_html``.
    Use it to build your own route; ``mount_apidoc`` covers the usual case.
    """
    if theme not in (None, "dark", "light"):
        raise ValueError(f"theme must be 'dark', 'light' or None, not {theme!r}")
    attrs = {"spec-url": openapi_url, "theme": theme, "csrf-header": csrf_header, "csrf-cookie": csrf_cookie, "nonce": nonce}
    element_attrs = "".join(f' {name}="{escape(value)}"' for name, value in attrs.items() if value)
    nonce_attr = f' nonce="{escape(nonce)}"' if nonce else ""
    background = "#fff" if theme == "light" else "#0b0b0f"
    follow_os = "" if theme else "@media (prefers-color-scheme: light) { html, body { background: #fff; } }"
    html = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{escape(title)}</title>
    <style{nonce_attr}>
      html, body {{ margin: 0; height: 100%; background: {background}; }}
      {follow_os}
    </style>
  </head>
  <body>
    <api-docs{element_attrs}></api-docs>
    <script type="module" src="{escape(bundle_url)}"{nonce_attr}></script>
  </body>
</html>
"""
    # Same as FastAPI's own docs: the page must not be cached by shared caches.
    return HTMLResponse(html, headers={"Cache-Control": "no-cache"})


def mount_apidoc(
    app: FastAPI,
    path: str = "/reference",
    *,
    openapi_url: str | None = None,
    title: str | None = None,
    theme: Theme | None = None,
    bundle_url: str | None = None,
    csrf_header: str | None = None,
    csrf_cookie: str | None = None,
) -> None:
    """
    Serve the apidoc reference at ``path`` and the JS bundle under ``{path}/_static``.

        app = FastAPI()
        mount_apidoc(app)                       # -> /reference

    ``openapi_url`` and ``title`` default to the app's own. URLs respect
    ``root_path``, so apps behind a path-prefixing proxy work unchanged.
    Pass ``csrf_header``/``csrf_cookie`` if your API uses cookie sessions with
    double-submit CSRF (e.g. fastapi-csrf-protect).
    """
    path = "/" + path.strip("/")
    if path == "/":
        raise ValueError("mount_apidoc needs a sub-path such as '/reference', not '/'.")
    if app.docs_url and app.docs_url.rstrip("/") == path:
        raise ValueError(
            f"{path} is already FastAPI's Swagger UI. Pass a different path, or create the app "
            f"with FastAPI(docs_url=None) to replace Swagger UI with apidoc."
        )
    spec_path = openapi_url or app.openapi_url
    if not spec_path:
        raise ValueError("The app has openapi_url=None; pass mount_apidoc(openapi_url=...) explicitly.")
    if theme not in (None, "dark", "light"):
        raise ValueError(f"theme must be 'dark', 'light' or None, not {theme!r}")
    if not bundle_url and not (STATIC_DIR / "apidoc.js").is_file():
        raise RuntimeError(
            "The apidoc JS bundle is missing. Wheels from PyPI include it; in a source checkout "
            "run `pnpm build:integrations` in the apidoc repo, or pass bundle_url= to load it from a CDN."
        )

    static_path = f"{path}/_static"
    if not bundle_url:
        app.mount(static_path, StaticFiles(directory=STATIC_DIR), name="apidoc-static")

    def prefixed(request: Request, url: str) -> str:
        # Absolute URLs pass through; paths get the proxy prefix (root_path).
        if url.startswith(("http://", "https://", "//")):
            return url
        return request.scope.get("root_path", "").rstrip("/") + url

    async def apidoc_page(request: Request) -> HTMLResponse:
        return get_apidoc_html(
            openapi_url=prefixed(request, spec_path),
            title=title or app.title,
            bundle_url=prefixed(request, bundle_url or f"{static_path}/apidoc.js"),
            theme=theme,
            csrf_header=csrf_header,
            csrf_cookie=csrf_cookie,
        )

    app.add_api_route(path, apidoc_page, methods=["GET"], include_in_schema=False, response_class=HTMLResponse)
