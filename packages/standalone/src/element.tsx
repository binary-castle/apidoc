import { ApiReference, type ApiReferenceProps, type ApiVersion, type Theme } from '@apidoc/ui'
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
 * Properties: `spec` accepts a URL string, `{ url }`, or `{ content }` (text or object).
 */
export class ApiDocsElement extends HTMLElement {
  static observedAttributes = ['spec-url', 'theme', 'csrf-header', 'csrf-cookie', 'csrf-token', 'versions']

  #root?: Root
  #spec?: SpecInput

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

  attributeChangedCallback() {
    this.#render()
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
    this.#root.render(<ApiReference spec={spec} theme={theme} csrf={csrf} versions={this.#versions()} />)
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
