import html
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from apidoc_fastapi import get_apidoc_html, mount_apidoc


def element(html: str) -> dict[str, str]:
    """The <api-docs ...> tag's attributes as a dict."""
    tag = re.search(r"<api-docs([^>]*)>", html).group(1)
    return dict(re.findall(r'([\w-]+)="([^"]*)"', tag))


def make_app(**kwargs) -> FastAPI:
    app = FastAPI(title="Orbit Payments API", **kwargs)

    @app.get("/customers")
    def list_customers() -> list[str]:
        return []

    return app


class MountTests(unittest.TestCase):
    def test_defaults_follow_the_app(self):
        app = make_app()
        mount_apidoc(app)
        response = TestClient(app).get("/reference")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-cache")
        attrs = element(response.text)
        self.assertEqual(attrs, {"spec-url": "/openapi.json"})
        self.assertIn('<script type="module" src="/reference/_static/apidoc.js">', response.text)
        self.assertIn("<title>Orbit Payments API</title>", response.text)

    def test_serves_bundle_and_chunks(self):
        app = make_app()
        mount_apidoc(app)
        client = TestClient(app)
        entry = client.get("/reference/_static/apidoc.js")
        self.assertEqual(entry.status_code, 200)
        self.assertIn("javascript", entry.headers["content-type"])
        chunk = re.search(r'"\./chunks/([\w.-]+\.js)"', entry.text).group(1)
        self.assertEqual(client.get(f"/reference/_static/chunks/{chunk}").status_code, 200)

    def test_respects_root_path_behind_a_proxy(self):
        app = make_app(root_path="/api")
        mount_apidoc(app, "/docs-v2/")
        html = TestClient(app).get("/docs-v2").text
        self.assertEqual(element(html)["spec-url"], "/api/openapi.json")
        self.assertIn('src="/api/docs-v2/_static/apidoc.js"', html)

    def test_options_and_escaping(self):
        app = make_app()
        mount_apidoc(
            app,
            title='Orbit <script>alert("x")</script>',
            theme="light",
            openapi_url="https://specs.example/orbit.yaml",
            bundle_url="https://cdn.example/apidoc.js",
            csrf_header="X-CSRF-Token",
            csrf_cookie="fastapi-csrf-token",
        )
        client = TestClient(app)
        html = client.get("/reference").text
        self.assertEqual(
            element(html),
            {"spec-url": "https://specs.example/orbit.yaml", "theme": "light", "csrf-header": "X-CSRF-Token", "csrf-cookie": "fastapi-csrf-token"},
        )
        self.assertIn('src="https://cdn.example/apidoc.js"', html)
        self.assertIn("<title>Orbit &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</title>", html)
        # With a CDN bundle nothing is mounted locally.
        self.assertEqual(client.get("/reference/_static/apidoc.js").status_code, 404)

    def test_versions_become_an_escaped_json_attribute(self):
        app = make_app()
        releases = [{"version": "1.2.0", "url": "/specs/1.2.0.yaml", "date": "2026-09-18"}]
        mount_apidoc(app, versions=releases)
        attrs = element(TestClient(app).get("/reference").text)
        self.assertEqual(json.loads(html.unescape(attrs["versions"])), releases)

    def test_workflows_url_respects_root_path(self):
        app = make_app(root_path="/api")
        mount_apidoc(app, workflows_url="/workflows.arazzo.yaml")
        self.assertEqual(element(TestClient(app).get("/reference").text)["workflows-url"], "/api/workflows.arazzo.yaml")

    def test_branding_options(self):
        app = make_app()
        mount_apidoc(
            app,
            accent="#14b8a6",
            logo="/static/logo.svg",
            logo_dark="https://cdn.example.com/logo-dark.svg",
            css_url="brand.css",
            favicon_url="data:image/svg+xml,%3Csvg%3E",
        )
        page = TestClient(app, root_path="/api").get("/reference").text
        attrs = element(page)
        self.assertEqual(attrs["accent"], "#14b8a6")
        self.assertEqual(attrs["logo"], "/api/static/logo.svg")
        self.assertEqual(attrs["logo-dark"], "https://cdn.example.com/logo-dark.svg")
        self.assertEqual(attrs["css-url"], "brand.css")
        self.assertIn('<link rel="icon" href="data:image/svg+xml,%3Csvg%3E">', page)

    def test_no_branding_by_default(self):
        page = TestClient(self._app_with_docs()).get("/reference").text
        for name in ("accent", "logo", "logo-dark", "css-url"):
            self.assertNotIn(name, element(page))
        self.assertNotIn('rel="icon"', page)

    def _app_with_docs(self) -> FastAPI:
        app = make_app()
        mount_apidoc(app)
        return app

    def test_not_listed_in_the_openapi_schema(self):
        app = make_app()
        mount_apidoc(app)
        self.assertEqual(list(TestClient(app).get("/openapi.json").json()["paths"]), ["/customers"])

    def test_can_replace_swagger_ui(self):
        with self.assertRaisesRegex(ValueError, "docs_url=None"):
            mount_apidoc(make_app(), "/docs")
        app = make_app(docs_url=None)
        mount_apidoc(app, "/docs")
        self.assertIn("<api-docs", TestClient(app).get("/docs").text)

    def test_misconfiguration_is_explicit(self):
        with self.assertRaisesRegex(ValueError, "openapi_url"):
            mount_apidoc(make_app(openapi_url=None))
        with self.assertRaisesRegex(ValueError, "sub-path"):
            mount_apidoc(make_app(), "/")
        with self.assertRaisesRegex(ValueError, "theme"):
            mount_apidoc(make_app(), theme="blue")
        with tempfile.TemporaryDirectory() as empty, mock.patch("apidoc_fastapi.docs.STATIC_DIR", Path(empty)):
            with self.assertRaisesRegex(RuntimeError, "build:integrations"):
                mount_apidoc(make_app())


class HtmlTests(unittest.TestCase):
    def test_nonce_on_style_element_and_script(self):
        html = get_apidoc_html(openapi_url="/openapi.json", bundle_url="/b.js", nonce="n0nce").body.decode()
        self.assertEqual(element(html)["nonce"], "n0nce")
        self.assertEqual(html.count('nonce="n0nce"'), 3)
