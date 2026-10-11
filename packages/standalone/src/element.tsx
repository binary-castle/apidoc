import { ApiReference, type ApiReferenceProps, type ApiVersion, type Logo, type OAuthConfig, type Theme } from '@apidoc/ui'
import themeCss from '@apidoc/ui/theme.css?inline'
import { createRoot, type Root } from 'react-dom/client'

type SpecInput = ApiReferenceProps['spec']

/**
 * `all: initial` stops the host page's inherited styles (font, colour,
 * line-height, letter-spacing…) from leaking in; nothing else crosses the
 * shadow boundary. Height defaults to the viewport and is overridable.
 */
const HOST_CSS = `
:host { all: initial; display: block; height: var(--apidoc-height, 100vh); contain: layout paint; }
:host([hidden]) { display: none; }
.apidoc-mount { height: 100%; }
`

/**
 * Parsed once and shared by every <api-docs> on the page (adoptedStyleSheets),
 * so the CSS text is referenced in exactly one place in the bundle.
 */
let sheets: CSSStyleSheet[] | undefined
function sharedSheets(nonce: string): CSSStyleSheet[] {
  if (!sheets) {
    const host = new CSSStyleSheet()
    host.replaceSync(HOST_CSS)
    const theme = new CSSStyleSheet()
    theme.replaceSync(themeCss)
    sheets = [host, theme]
    installDocumentGlobals(theme, nonce)
  }
  return sheets
}

/** @property rules anywhere in the sheet, including inside @layer blocks. */
function propertyRules(rules: CSSRuleList): string[] {
  return [...rules].flatMap(rule =>
    rule.cssText.startsWith('@property') ? [rule.cssText] : 'cssRules' in rule ? propertyRules((rule as CSSGroupingRule).cssRules) : [],
  )
}

/**
 * Two kinds of rules are ignored inside shadow roots and must live on the
 * document: @font-face (fonts) and @property (Tailwind registers its utility
 * variables with it; without them shadows/rings/transforms silently break).
 */
function installDocumentGlobals(theme: CSSStyleSheet, nonce: string) {
  const style = document.createElement('style')
  // Under a strict Content-Security-Policy the injected <style> needs the page's nonce.
  if (nonce) style.nonce = nonce
  style.dataset.apidoc = 'globals'
  style.textContent = propertyRules(theme.cssRules).join('\n')
  document.head.append(style)
  void import('./fonts').then(({ fontFaces }) => {
    style.textContent += `\n${fontFaces}`
  })
}

/** Inline spec from a child <script type="application/json|yaml"> element. */
function inlineSpec(element: HTMLElement): string | undefined {
  const script = element.querySelector('script[type="application/json"], script[type="application/yaml"], script[type="text/yaml"]')
  return script?.textContent?.trim() || undefined
}

/**
 * <api-docs spec-url="/openapi.json" theme="dark"></api-docs>
 *
 * Attributes: `spec-url`, `theme` ("dark" | "light"; omit to follow the viewer),
 * and `csrf-header` + `csrf-cookie` / `csrf-token` for session-authenticated
 * same-origin APIs (the Django integration sets these). A `nonce` attribute is
 * applied to the one <style> added to the document, for strict CSP setups.
 * `versions` takes JSON: older releases, newest first, e.g.
 * '[{"version":"2.3.0","url":"/openapi-2.3.0.yaml","date":"2026-09-18"}]'.
 * `workflows-url` points at an Arazzo 1.x document with runnable multi-step workflows.
 * Relative URLs in all three resolve against the page.
 *
 * Branding: `accent` (any CSS colour; the palette for both themes is derived
 * from it), `logo` / `logo-dark` / `logo-href`, and `css-url`, a stylesheet
 * applied inside the shadow root after the built-in theme, so it can
 * override any `--ad-*` token or style `.apidoc` directly.
 *
 * OAuth sign-in defaults: `oauth-client-id`, `oauth-scopes` (space-separated,
 * preselected) and `oauth-redirect-url` (same-origin; defaults to this page).
 *
 * Properties: `spec` accepts a URL string, `{ url }`, or `{ content }` (text or
 * object); `customCss` takes CSS text, applied like `css-url`.
 */
export class ApiDocsElement extends HTMLElement {
  static observedAttributes = ['spec-url', 'theme', 'csrf-header', 'csrf-cookie', 'csrf-token', 'versions', 'workflows-url', 'accent', 'logo', 'logo-dark', 'logo-href', 'css-url', 'oauth-client-id', 'oauth-scopes', 'oauth-redirect-url']

  #root?: Root
  #spec?: SpecInput
  #customCss = ''
  /** This element's own stylesheet (css-url + customCss), adopted after the shared theme. */
  #customSheet?: CSSStyleSheet
  #cssUrl?: string
  #cssUrlText = ''

  get customCss(): string {
    return this.#customCss
  }

  set customCss(value: string) {
    this.#customCss = value ?? ''
    this.#applyCustomCss()
  }

  get spec(): SpecInput | undefined {
    return this.#spec
  }

  set spec(value: SpecInput | undefined) {
    this.#spec = value
    this.#render()
  }

  connectedCallback() {
    if (this.#root) return
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
    shadow.adoptedStyleSheets = sharedSheets(this.nonce ?? '')
    this.#applyCustomCss()
    this.#loadCssUrl()
    const mount = document.createElement('div')
    mount.className = 'apidoc-mount'
    shadow.replaceChildren(mount)
    this.#root = createRoot(mount)
    this.#render()
  }

  disconnectedCallback() {
    // Moving the element fires disconnect + connect; only tear down if it's really gone.
    queueMicrotask(() => {
      if (this.isConnected || !this.#root) return
      this.#root.unmount()
      this.#root = undefined
      this.shadowRoot?.replaceChildren()
    })
  }

  attributeChangedCallback(name: string) {
    if (name === 'css-url') this.#loadCssUrl()
    else this.#render()
  }

  /** Fetch `css-url` (relative to the page) once per value; failures are reported, not fatal. */
  #loadCssUrl() {
    const raw = this.getAttribute('css-url') ?? undefined
    if (raw === this.#cssUrl || !this.shadowRoot) return
    this.#cssUrl = raw
    this.#cssUrlText = ''
    this.#applyCustomCss()
    if (!raw) return
    const url = new URL(raw, document.baseURI).toString()
    fetch(url)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.text()
      })
      .then(text => {
        if (this.#cssUrl !== raw) return
        // Relative url()s inside the stylesheet resolve against the stylesheet itself.
        this.#cssUrlText = text
        this.#applyCustomCss(url)
      })
      .catch((error: Error) => console.warn(`<api-docs>: could not load css-url ${url}: ${error.message}`))
  }

  #applyCustomCss(baseURL?: string) {
    const shadow = this.shadowRoot
    if (!shadow) return
    const text = `${this.#cssUrlText}\n${this.#customCss}`.trim()
    const shared = sharedSheets(this.nonce ?? '')
    if (!text) {
      this.#customSheet = undefined
      shadow.adoptedStyleSheets = shared
      return
    }
    // A new sheet when the base URL changes (it can only be set at construction).
    if (!this.#customSheet || baseURL) this.#customSheet = new CSSStyleSheet(baseURL ? { baseURL } : undefined)
    this.#customSheet.replaceSync(text)
    shadow.adoptedStyleSheets = [...shared, this.#customSheet]
  }

  #render() {
    if (!this.#root) return
    const spec = this.#spec ?? this.getAttribute('spec-url') ?? (inlineSpec(this) ? { content: inlineSpec(this)! } : undefined)
    const themeAttr = this.getAttribute('theme')
    const theme: Theme | undefined = themeAttr === 'dark' || themeAttr === 'light' ? themeAttr : undefined
    if (!spec) {
      this.#root.render(<p style={{ font: '14px system-ui', padding: 24, color: '#b02a2a' }}>&lt;api-docs&gt; needs a <code>spec-url</code> attribute, a <code>spec</code> property, or an inline &lt;script type="application/json"&gt;.</p>)
      return
    }
    const csrfHeader = this.getAttribute('csrf-header')
    const csrf = csrfHeader
      ? { headerName: csrfHeader, cookieName: this.getAttribute('csrf-cookie') ?? undefined, token: this.getAttribute('csrf-token') ?? undefined }
      : undefined
    this.#root.render(
      <ApiReference
        spec={spec}
        theme={theme}
        csrf={csrf}
        versions={this.#versions()}
        workflows={this.getAttribute('workflows-url') ?? undefined}
        accent={this.getAttribute('accent') ?? undefined}
        logo={this.#logo()}
        oauth={this.#oauth()}
      />,
    )
  }

  #oauthCache?: { key: string; value: OAuthConfig | undefined }

  /** `oauth-*` attributes as one stable value. */
  #oauth(): OAuthConfig | undefined {
    const [clientId, scopes, redirectUrl] = [this.getAttribute('oauth-client-id'), this.getAttribute('oauth-scopes'), this.getAttribute('oauth-redirect-url')]
    const key = `${clientId}|${scopes}|${redirectUrl}`
    if (this.#oauthCache?.key !== key) {
      const value =
        clientId || scopes || redirectUrl
          ? { clientId: clientId ?? undefined, scopes: scopes?.split(/\s+/).filter(Boolean), redirectUrl: redirectUrl ? new URL(redirectUrl, document.baseURI).toString() : undefined }
          : undefined
      this.#oauthCache = { key, value }
    }
    return this.#oauthCache.value
  }

  #logoCache?: { key: string; value: Logo | undefined }

  /** `logo`, `logo-dark` and `logo-href` as one stable value. */
  #logo(): Logo | undefined {
    const [light, dark, href] = [this.getAttribute('logo'), this.getAttribute('logo-dark'), this.getAttribute('logo-href')]
    const key = `${light}|${dark}|${href}`
    if (this.#logoCache?.key !== key) {
      const value = light || dark ? { light: light ?? undefined, dark: dark ?? undefined, href: href ?? undefined } : undefined
      this.#logoCache = { key, value }
    }
    return this.#logoCache.value
  }

  #versionsCache?: { raw: string; value: ApiVersion[] | undefined }

  /** Parsed `versions` attribute; parsed once per value so React sees a stable array. */
  #versions(): ApiVersion[] | undefined {
    const raw = this.getAttribute('versions')
    if (!raw) return undefined
    if (this.#versionsCache?.raw === raw) return this.#versionsCache.value
    let value: ApiVersion[] | undefined
    try {
      const parsed: unknown = JSON.parse(raw)
      value = Array.isArray(parsed) ? parsed.filter((v): v is ApiVersion => typeof v?.version === 'string' && typeof v?.url === 'string') : undefined
    } catch {
      console.warn('<api-docs>: the versions attribute is not valid JSON and was ignored.')
    }
    this.#versionsCache = { raw, value }
    return value
  }
}
