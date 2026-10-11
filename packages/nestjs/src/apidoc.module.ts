import { createApidoc, send, type ApidocOptions, type ApidocResponse, type Nonce, type SpecDocument } from '@binarycastle/apidoc-express'

/**
 * The parts of INestApplication used here, typed structurally so the package
 * works with every NestJS major (CommonJS ≤ 11, ESM 12+) without importing it.
 */
export interface NestApplicationLike {
  getHttpAdapter(): HttpAdapterLike
}

interface HttpAdapterLike {
  get(path: string, handler: (req: any, res: any, next?: any) => any): any
  getType?(): string
}

export interface ApidocModuleOptions extends Omit<ApidocOptions<any, any>, 'spec'> {
  /**
   * Prefix the docs path with the app's global prefix (`app.setGlobalPrefix`).
   * Off by default, like `SwaggerModule.setup`.
   */
  useGlobalPrefix?: boolean
}

/** An OpenAPI document (e.g. from `SwaggerModule.createDocument`), or a factory called once on first use. */
export type DocumentOrFactory = SpecDocument | (() => SpecDocument | Promise<SpecDocument>)

export class ApidocModule {
  /**
   * Serve apidoc at `path`, the counterpart of `SwaggerModule.setup`:
   *
   *     const document = SwaggerModule.createDocument(app, config)
   *     ApidocModule.setup('docs', app, document)
   *
   * Pass `null` as the document and `{ specUrl }` in options to point at a
   * spec served elsewhere. Works with the Express and Fastify adapters.
   */
  static setup(path: string, app: NestApplicationLike, document: DocumentOrFactory | null | undefined, options: ApidocModuleOptions = {}): void {
    const { useGlobalPrefix, ...rest } = options
    const httpAdapter = app.getHttpAdapter()
    const fastify = httpAdapter.getType?.() === 'fastify'
    const handle = createApidoc<any, any>({
      ...rest,
      spec: document == null ? undefined : once(document),
      nonce: rest.nonce ?? defaultNonce,
    })

    const prefix = useGlobalPrefix ? globalPrefix(app) : ''
    const base = '/' + [prefix, path].map(part => part.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')
    if (base === '/') throw new TypeError("ApidocModule.setup needs a path such as 'docs', not the root.")

    const route = (req: any, res: any, next?: () => void) => {
      handle({ method: req.method, url: req.originalUrl ?? req.url, mount: base, ifNoneMatch: req.headers['if-none-match'], req, res })
        .then(response => {
          if (response) reply(res, response)
          else notFound(res, next)
        })
        .catch((error: unknown) => {
          console.error('[apidoc]', error)
          reply(res, { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'apidoc: could not render the docs.' })
        })
    }

    httpAdapter.get(base, route)
    try {
      // Fastify treats `/docs` and `/docs/` as different routes unless ignoreTrailingSlash is on,
      // in which case registering both throws; the first route already covers it then.
      httpAdapter.get(`${base}/`, route)
    } catch (error) {
      if (!fastify) throw error
    }
    if (document != null) {
      httpAdapter.get(`${base}/openapi.json`, route)
      httpAdapter.get(`${base}/openapi.yaml`, route)
    }
    if (!options.bundleUrl) {
      httpAdapter.get(`${base}/_static/apidoc.js`, route)
      httpAdapter.get(`${base}/_static/chunks/:file`, route)
    }
  }
}

/** Calls a document factory once, on first use, like SwaggerModule's lazy documentFactory. */
function once(document: DocumentOrFactory): SpecDocument | (() => Promise<SpecDocument>) {
  if (typeof document !== 'function') return document
  const factory = document as () => SpecDocument | Promise<SpecDocument>
  let pending: Promise<SpecDocument> | undefined
  return () => {
    pending ??= Promise.resolve().then(factory)
    // A failed factory is retried on the next request instead of being cached.
    pending.catch(() => (pending = undefined))
    return pending
  }
}

/** helmet on Express: `res.locals.cspNonce` by convention; @fastify/helmet: `reply.cspNonce`. */
function defaultNonce(_req: unknown, res: any): Nonce | undefined {
  const nonce = res?.locals?.cspNonce ?? res?.cspNonce
  if (typeof nonce === 'string') return nonce
  if (nonce && typeof nonce === 'object') return { script: nonce.script, style: nonce.style }
  return undefined
}

function globalPrefix(app: NestApplicationLike): string {
  // Not on the public interface; SwaggerModule reads it the same way.
  const config = (app as { config?: { getGlobalPrefix?(): string } }).config
  return config?.getGlobalPrefix?.() ?? ''
}

function isFastifyReply(res: any): boolean {
  return typeof res?.code === 'function' && typeof res?.headers === 'function' && 'raw' in res
}

function reply(res: any, response: ApidocResponse) {
  if (isFastifyReply(res)) {
    res.code(response.status).headers(response.headers).send(response.status === 304 ? undefined : response.body)
  } else {
    send(res, response)
  }
}

function notFound(res: any, next?: () => void) {
  if (typeof next === 'function') next()
  else if (typeof res?.callNotFound === 'function') res.callNotFound()
  else reply(res, { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Not Found' })
}
