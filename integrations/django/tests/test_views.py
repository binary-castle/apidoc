import html
import json
import re
from unittest import mock

from django.core.exceptions import ImproperlyConfigured
from django.test import RequestFactory, SimpleTestCase, override_settings

from apidoc_django.checks import check_bundle
from apidoc_django.views import ApiDocView


def element(html):
    """The <api-docs ...> tag's attributes as a dict."""
    tag = re.search(r"<api-docs([^>]*)>", html).group(1)
    return dict(re.findall(r'([\w-]+)="([^"]*)"', tag))


class ApiDocViewTests(SimpleTestCase):
    def test_resolves_url_name_and_loads_static_bundle(self):
        response = self.client.get("/docs/")
        self.assertEqual(response.status_code, 200)
        html = response.content.decode()
        self.assertEqual(element(html)["spec-url"], "/api/schema/")
        self.assertIn('<script type="module" src="/static/apidoc_django/apidoc.js">', html)
        self.assertIn("<title>API Reference</title>", html)
        self.assertNotIn("theme=", html)

    def test_versions_become_an_escaped_json_attribute(self):
        attrs = element(self.client.get("/docs-versions/").content.decode())
        self.assertEqual(json.loads(html.unescape(attrs["versions"])), [{"version": "1.2.0", "url": "/specs/1.2.0.yaml", "date": "2026-09-18"}])
        self.assertNotIn("versions", element(self.client.get("/docs/").content.decode()))

    def test_workflows_url_accepts_a_url_name(self):
        attrs = element(self.client.get("/docs-workflows/").content.decode())
        self.assertEqual(attrs["workflows-url"], "/workflows.arazzo.yaml")
        self.assertNotIn("workflows-url", element(self.client.get("/docs/").content.decode()))

    def test_never_cached(self):
        response = self.client.get("/docs/")
        self.assertIn("no-cache", response["Cache-Control"])

    def test_passes_csrf_header_cookie_and_token(self):
        response = self.client.get("/docs/")
        attrs = element(response.content.decode())
        self.assertEqual(attrs["csrf-header"], "X-CSRFTOKEN")
        self.assertEqual(attrs["csrf-cookie"], "csrftoken")
        self.assertTrue(attrs["csrf-token"])
        # The middleware sets the cookie because the view used the token.
        self.assertIn("csrftoken", response.cookies)

    @override_settings(CSRF_COOKIE_HTTPONLY=True, CSRF_HEADER_NAME="HTTP_X_XSRF_TOKEN")
    def test_httponly_cookie_falls_back_to_embedded_token(self):
        attrs = element(self.client.get("/docs/").content.decode())
        self.assertEqual(attrs["csrf-header"], "X-XSRF-TOKEN")
        self.assertNotIn("csrf-cookie", attrs)
        self.assertTrue(attrs["csrf-token"])

    def test_view_options_and_escaping(self):
        html = self.client.get("/docs-custom/").content.decode()
        attrs = element(html)
        self.assertEqual(attrs["spec-url"], "/openapi.yaml")
        self.assertEqual(attrs["theme"], "light")
        self.assertNotIn("csrf-header", attrs)
        self.assertIn('src="https://cdn.example/apidoc.js"', html)
        self.assertIn("<title>&lt;b&gt;Orbit&lt;/b&gt;</title>", html)

    @override_settings(APIDOC={"SCHEMA_URL": "/schema.json", "THEME": "dark", "TITLE": "Orbit API", "CSRF": False})
    def test_settings_driven_urlconf(self):
        html = self.client.get("/docs-from-settings/").content.decode()
        attrs = element(html)
        self.assertEqual(attrs["spec-url"], "/schema.json")
        self.assertEqual(attrs["theme"], "dark")
        self.assertNotIn("csrf-token", attrs)
        self.assertIn("<title>Orbit API</title>", html)

    def test_misconfiguration_is_explicit(self):
        with self.assertRaisesMessage(ImproperlyConfigured, "no-such-url-name"):
            self.client.get("/docs-unresolvable/")
        with self.assertRaisesMessage(ImproperlyConfigured, "needs the URL of your OpenAPI schema"):
            self.client.get("/docs-from-settings/")

    @override_settings(APIDOC={"SCHEMA_URL": "schema", "THEME": "blue"})
    def test_rejects_unknown_theme(self):
        with self.assertRaisesMessage(ImproperlyConfigured, "theme"):
            self.client.get("/docs-from-settings/")

    def test_csp_nonce_is_applied_everywhere(self):
        # django-csp and Django 6's CSP middleware put the nonce on the request.
        request = RequestFactory().get("/docs/")
        request.csp_nonce = "n0nce"
        html = ApiDocView.as_view(schema_url="schema")(request).render().content.decode()
        self.assertEqual(element(html)["nonce"], "n0nce")
        # <style>, <api-docs> and <script>.
        self.assertEqual(html.count('nonce="n0nce"'), 3)


class BundleCheckTests(SimpleTestCase):
    def test_warns_when_bundle_missing(self):
        with mock.patch("django.contrib.staticfiles.finders.find", return_value=None):
            self.assertEqual([w.id for w in check_bundle(None)], ["apidoc_django.W001"])

    @override_settings(APIDOC={"BUNDLE_URL": "https://cdn.example/apidoc.js"})
    def test_cdn_bundle_skips_check(self):
        with mock.patch("django.contrib.staticfiles.finders.find", return_value=None):
            self.assertEqual(check_bundle(None), [])
