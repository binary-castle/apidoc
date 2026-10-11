export type Theme = 'dark' | 'light'

/** An older release of the API, for the changelog. */
export interface ApiVersion {
  version: string
  url: string
  date?: string
}

export type Nonce = string | { script?: string; style?: string }

export interface ApidocHtmlOptions {
  /** URL of the OpenAPI/Swagger document. Relative URLs resolve against the docs page. */
  specUrl: string
  /** URL of the `@binarycastle/apidoc` bundle (`apidoc.js`). */
  bundleUrl: string
  title?: string
  /** Omit to follow the viewer's choice, then their OS. */
  theme?: Theme
  /** Header that carries the CSRF token on unsafe same-origin requests. */
  csrfHeader?: string
  /** Cookie the token is read from (double-submit). */
  csrfCookie?: string
  /** The token itself, when it isn't readable from a cookie. */
  csrfToken?: string
  /**
   * CSP nonce for the page's inline style and module script, or separate
   * nonces for each (as @fastify/helmet generates).
   */
  nonce?: Nonce
  /** Older releases, newest first, for the changelog. */
  versions?: ApiVersion[]
  /** Arazzo 1.x document with runnable multi-step workflows. */
  workflowsUrl?: string
  /** Brand colour (any CSS colour); the accent palette for both themes is derived from it. */
  accent?: string
  /** Logo for the top bar, and an optional variant for the dark theme. */
  logo?: string
  logoDark?: string
  /** Stylesheet applied inside the docs after the built-in theme; can override any `--ad-*` token. */
  cssUrl?: string
  faviconUrl?: string
  /** OAuth sign-in defaults for the playground: the docs' client id and scopes to preselect. */
  oauthClientId?: string
  oauthScopes?: string[]
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ESCAPES[c]!)
}

/**
 * The docs page: one <api-docs> element plus the bundle. Same markup as the
 * Django and FastAPI integrations, so every backend renders identically.
 */
export function renderApidocHtml(options: ApidocHtmlOptions): string {
  const { theme } = options
  const scriptNonce = typeof options.nonce === 'string' ? options.nonce : options.nonce?.script
  const styleNonce = typeof options.nonce === 'string' ? options.nonce : options.nonce?.style
  if (theme !== undefined && theme !== 'dark' && theme !== 'light') {
    throw new TypeError(`theme must be 'dark', 'light' or undefined, not ${JSON.stringify(theme)}`)
  }
  const attrs: [string, string | undefined][] = [
    ['spec-url', options.specUrl],
    ['theme', theme],
    ['csrf-header', options.csrfHeader],
    ['csrf-cookie', options.csrfHeader ? options.csrfCookie : undefined],
    ['csrf-token', options.csrfHeader ? options.csrfToken : undefined],
    ['versions', options.versions?.length ? JSON.stringify(options.versions) : undefined],
    ['workflows-url', options.workflowsUrl],
    ['accent', options.accent],
    ['logo', options.logo],
    ['logo-dark', options.logoDark],
    ['css-url', options.cssUrl],
    ['oauth-client-id', options.oauthClientId],
    ['oauth-scopes', options.oauthScopes?.length ? options.oauthScopes.join(' ') : undefined],
    // The element adds one <style> to the document head.
    ['nonce', styleNonce],
  ]
  const elementAttrs = attrs
    .filter((attr): attr is [string, string] => !!attr[1])
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join('')
  const nonceAttr = (nonce: string | undefined) => (nonce ? ` nonce="${escapeHtml(nonce)}"` : '')
  const background = theme === 'light' ? '#fff' : '#0b0b0f'
  const followOs = theme ? '' : '@media (prefers-color-scheme: light) { html, body { background: #fff; } }'
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(options.title || 'API Reference')}</title>${options.faviconUrl ? `\n    <link rel="icon" href="${escapeHtml(options.faviconUrl)}">` : ''}
    <style${nonceAttr(styleNonce)}>
      html, body { margin: 0; height: 100%; background: ${background}; }
      ${followOs}
    </style>
  </head>
  <body>
    <api-docs${elementAttrs}></api-docs>
    <script type="module" src="${escapeHtml(options.bundleUrl)}"${nonceAttr(scriptNonce)}></script>
  </body>
</html>
`
}
