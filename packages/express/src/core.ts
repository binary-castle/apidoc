import { BundleAssets } from './assets'
import { renderApidocHtml, type ApiVersion, type Nonce, type Theme } from './html'

/** An OpenAPI document as an object, or its JSON/YAML text. */
export type SpecDocument = object | string

export interface ApidocOptions<Req = unknown, Res = unknown> {
  /**
   * URL of the OpenAPI/Swagger document, e.g. `/openapi.json`. Relative URLs
   * (`../openapi.yaml`) resolve against the docs page, so they survive a proxy
   * that mounts the app under a prefix. Use this or `spec`.
   */
  specUrl?: string
  /**
   * The document itself (object or JSON/YAML text), or a function returning
   * it per request. It is served next to the docs as `openapi.json`
   * (`openapi.yaml` for YAML text).
   */
  spec?: SpecDocument | ((req: Req) => SpecDocument | Promise<SpecDocument>)
  /** Page title; defaults to the spec's `info.title` when `spec` is an object. */
  title?: string
  /** `dark` or `light`; omit to follow the viewer's choice, then their OS. */
  theme?: Theme
  /** Load the bundle from here (e.g. jsDelivr) instead of serving it from the app. */
  bundleUrl?: string
  /**
   * For APIs authenticated with session cookies: the header the playground
   * sends the CSRF token in, and where the token comes from (a readable
   * cookie, or `token(req, res)` such as csrf-csrf's `generateCsrfToken`).
   * The token is only sent on unsafe, same-origin requests.
   */
  csrf?: {
    header: string
    cookie?: string
    token?: (req: Req, res: Res) => string | undefined | Promise<string | undefined>
  }
  /** CSP nonce for the page's inline style and script (one for both, or one each). */
  nonce?: (req: Req, res: Res) => Nonce | undefined
  /** Older releases, newest first, for the changelog. */
  versions?: ApiVersion[]
  /** Arazzo 1.x document with runnable multi-step workflows (URL, relative to the docs page). */
  workflowsUrl?: string
}

export interface ApidocRequest<Req = unknown, Res = unknown> {
  method: string
  /** Path and query as the client sent it, e.g. `/docs/?x=1`. */
  url: string
  /** The part of the path the docs are mounted at, e.g. `/docs`. */
  mount: string
  ifNoneMatch?: string
  req: Req
  res: Res
}

export interface ApidocResponse {
  status: number
  headers: Record<string, string>
  body: string | Buffer
}

export type ApidocHandler<Req = unknown, Res = unknown> = (request: ApidocRequest<Req, Res>) => Promise<ApidocResponse | undefined>

const STATIC_PREFIX = '/_static/'

/**
 * Framework-agnostic core used by the Express middleware and the NestJS
 * module: maps a request under the docs mount to a response, or undefined to
 * pass it on. Routes, relative to the mount:
 *
 *   (none)                → redirect to `<mount>/` so relative URLs resolve
 *   /                     → the docs page
 *   /openapi.json|yaml    → the document, when `spec` is given
 *   /_static/apidoc.js    → the bundle (and /_static/chunks/*), unless `bundleUrl`
 */
export function createApidoc<Req = unknown, Res = unknown>(options: ApidocOptions<Req, Res>): ApidocHandler<Req, Res> {
  const { spec } = options
  if (!options.specUrl && spec === undefined) {
    throw new TypeError('apidoc needs `specUrl` (the URL of your OpenAPI document) or `spec` (the document itself).')
  }
  if (options.specUrl && spec !== undefined) {
    throw new TypeError('Pass either `specUrl` or `spec` to apidoc, not both.')
  }
  if (options.theme !== undefined && options.theme !== 'dark' && options.theme !== 'light') {
    throw new TypeError(`theme must be 'dark', 'light' or undefined, not ${JSON.stringify(options.theme)}`)
  }
  const assets = options.bundleUrl ? undefined : new BundleAssets()
  const specFile = typeof spec === 'string' && !looksLikeJson(spec) ? 'openapi.yaml' : 'openapi.json'
  const specUrl = options.specUrl ?? specFile
  const bundleUrl = options.bundleUrl ?? `${STATIC_PREFIX.slice(1)}apidoc.js`

  const loadSpec = async (req: Req) => (typeof spec === 'function' ? spec(req) : spec)

  return async ({ method, url, mount, ifNoneMatch, req, res }): Promise<ApidocResponse | undefined> => {
    if (method !== 'GET' && method !== 'HEAD') return undefined
    const queryAt = url.indexOf('?')
    const pathname = queryAt === -1 ? url : url.slice(0, queryAt)
    const search = queryAt === -1 ? '' : url.slice(queryAt)
    const mountPath = mount.replace(/\/+$/, '')
    // Case-insensitive: Express matches mounts that way by default. Routers have usually
    // matched already, but plain `http` servers rely on this check.
    if (pathname.slice(0, mountPath.length).toLowerCase() !== mountPath.toLowerCase()) return undefined
    const rest = pathname.slice(mountPath.length)
    if (rest !== '' && !rest.startsWith('/')) return undefined

    if (rest === '') {
      // `/docs` → `docs/` (relative), so a proxy prefix in front of the app is kept.
      const last = pathname.slice(pathname.lastIndexOf('/') + 1)
      return { status: 302, headers: { Location: `${last}/${search}`, 'Cache-Control': 'no-cache' }, body: '' }
    }

    if (rest === '/' || rest === '/index.html') {
      const document = options.title ? undefined : await loadSpec(req)
      const html = renderApidocHtml({
        specUrl,
        bundleUrl,
        title: options.title ?? specTitle(document),
        theme: options.theme,
        csrfHeader: options.csrf?.header,
        csrfCookie: options.csrf?.cookie,
        csrfToken: await options.csrf?.token?.(req, res),
        nonce: options.nonce?.(req, res),
        versions: options.versions,
        workflowsUrl: options.workflowsUrl,
      })
      return { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }, body: html }
    }

    if (spec !== undefined && rest === `/${specFile}`) {
      const document = await loadSpec(req)
      const text = typeof document === 'string' ? document : JSON.stringify(document)
      const type = typeof document === 'string' && !looksLikeJson(document) ? 'application/yaml' : 'application/json'
      return { status: 200, headers: { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' }, body: text }
    }

    if (assets && rest.startsWith(STATIC_PREFIX)) {
      const asset = assets.get(rest.slice(STATIC_PREFIX.length))
      if (!asset) return undefined
      const headers = {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': asset.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        ETag: asset.etag,
        'X-Content-Type-Options': 'nosniff',
      }
      if (ifNoneMatch && ifNoneMatch.split(',').some(tag => tag.trim().replace(/^W\//, '') === asset.etag)) {
        return { status: 304, headers, body: '' }
      }
      return { status: 200, headers, body: asset.body }
    }

    return undefined
  }
}

function looksLikeJson(text: string): boolean {
  return /^\s*[{[]/.test(text)
}

function specTitle(document: SpecDocument | undefined): string | undefined {
  let value: unknown = document
  if (typeof value === 'string' && looksLikeJson(value)) {
    try {
      value = JSON.parse(value)
    } catch {
      return undefined
    }
  }
  if (!value || typeof value !== 'object') return undefined
  const title = (value as { info?: { title?: unknown } }).info?.title
  return typeof title === 'string' ? title : undefined
}
