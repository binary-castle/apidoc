import type { IncomingHttpHeaders } from 'node:http'
import { createApidoc, type ApidocOptions, type ApidocResponse } from './core'
import type { Nonce } from './html'

/**
 * What the middleware reads from Express's request and response. Typed
 * structurally so the package needs neither express nor @types/express; annotate
 * a callback's parameters (`(req: Request) => …`) to get Express's own types.
 */
export interface ExpressRequestLike {
  method: string
  originalUrl: string
  baseUrl: string
  headers: IncomingHttpHeaders
}

export interface ExpressResponseLike {
  locals?: Record<string, any>
  statusCode: number
  setHeader(name: string, value: string): unknown
  end(body?: string | Buffer): unknown
}

export type ExpressApidocOptions<Req = ExpressRequestLike, Res = ExpressResponseLike> = Omit<ApidocOptions<Req, Res>, 'nonce'> & {
  /**
   * CSP nonce for the page. Defaults to `res.locals.cspNonce`, the usual place
   * when a nonce is generated per request for helmet's contentSecurityPolicy.
   */
  nonce?: (req: Req, res: Res) => Nonce | undefined
}

/**
 * Express (4 and 5) middleware serving the docs, the bundle and optionally the
 * spec. Mount it with `app.use`:
 *
 *     app.use('/docs', apidoc({ specUrl: '/openapi.json' }))
 */
export function apidoc<Req extends ExpressRequestLike = ExpressRequestLike, Res extends ExpressResponseLike = ExpressResponseLike>(
  options: ExpressApidocOptions<Req, Res>,
): (req: Req, res: Res, next: (error?: unknown) => void) => void {
  const handle = createApidoc<Req, Res>({
    ...options,
    nonce: options.nonce ?? ((_req, res) => (typeof res.locals?.cspNonce === 'string' ? res.locals.cspNonce : undefined)),
  })
  return (req, res, next) => {
    handle({ method: req.method, url: req.originalUrl, mount: req.baseUrl, ifNoneMatch: req.headers['if-none-match'], req, res })
      .then(response => (response ? send(res, response) : next()))
      .catch(next)
  }
}

/** Write a core response to a Node (http.ServerResponse) or Express response. */
export function send(res: Pick<ExpressResponseLike, 'statusCode' | 'setHeader' | 'end'>, { status, headers, body }: ApidocResponse) {
  res.statusCode = status
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
  // `end`, not `send`: our ETag handling is authoritative and body types are final.
  if (status === 304) res.end()
  else res.end(body)
}
