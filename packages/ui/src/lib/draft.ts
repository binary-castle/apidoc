import {
  applyAuth,
  buildRequest,
  exampleForMedia,
  sampleFromSchema,
  type ApiModel,
  type Credential,
  type HttpRequestSpec,
  type MediaTypeModel,
  type OperationModel,
  type Resolver,
  type SecuritySchemeModel,
} from '@apidoc/core'

/** Editable request state for one operation (used by snippets and the playground). */
export interface Draft {
  pathParams: Record<string, string>
  query: Record<string, string>
  headers: Record<string, string>
  cookies: Record<string, string>
  contentType?: string
  body: string
}

const isJsonMedia = (mediaType: string) => /json/i.test(mediaType)
const isFormMedia = (mediaType: string) => mediaType === 'application/x-www-form-urlencoded'

const asText = (value: unknown) => (value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value))

export function bodyForMedia(media: MediaTypeModel | undefined, resolver: Resolver): string {
  if (!media) return ''
  const example = exampleForMedia(media, resolver, 'request')
  if (isJsonMedia(media.mediaType)) return JSON.stringify(example ?? {}, null, 2)
  if (isFormMedia(media.mediaType) && example && typeof example === 'object') {
    return new URLSearchParams(Object.entries(example as Record<string, unknown>).map(([k, v]) => [k, asText(v)])).toString()
  }
  return typeof example === 'string' ? example : ''
}

/** Prefill required parameters with examples so a request is sendable immediately. */
export function defaultDraft(operation: OperationModel, resolver: Resolver): Draft {
  const draft: Draft = { pathParams: {}, query: {}, headers: {}, cookies: {}, body: '' }
  for (const parameter of operation.parameters) {
    const schema = resolver.schema(parameter.schema).value
    const explicit = parameter.example ?? schema?.example ?? schema?.examples?.[0] ?? schema?.default
    const value = asText(explicit ?? (parameter.required ? sampleFromSchema(parameter.schema, resolver, 'request') : ''))
    const target = { path: draft.pathParams, query: draft.query, header: draft.headers, cookie: draft.cookies }[parameter.in]
    target[parameter.name] = parameter.in === 'path' && !explicit ? '' : value
  }
  const media = operation.requestBody?.content[0]
  if (media) {
    draft.contentType = media.mediaType
    draft.body = bodyForMedia(media, resolver)
  }
  return draft
}

/** The first security requirement whose schemes all have credentials, else the first one. */
export function pickSecurity(operation: OperationModel, model: ApiModel, credentials: Record<string, Credential>) {
  const has = (name: string) => {
    const c = credentials[name]
    return Boolean(c?.token || c?.username || c?.password)
  }
  const satisfied = operation.security.find(req => req.schemes.length && req.schemes.every(s => has(s.name)))
  const requirement = satisfied ?? operation.security.find(req => req.schemes.length)
  return (requirement?.schemes ?? []).map(s => model.securitySchemes[s.name]).filter((s): s is SecuritySchemeModel => Boolean(s))
}

const PLACEHOLDER: Credential = { token: 'YOUR_TOKEN', username: 'USERNAME', password: 'PASSWORD' }

interface ToRequestOptions {
  baseUrl: string
  model: ApiModel
  credentials: Record<string, Credential>
  /** Show "YOUR_TOKEN"-style placeholders when no credential is set (code samples). */
  placeholders?: boolean
}

export function draftToRequest(operation: OperationModel, draft: Draft, options: ToRequestOptions): HttpRequestSpec {
  const query: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(draft.query)) {
    const parameter = operation.parameters.find(p => p.in === 'query' && p.name === name)
    const isArray = parameter?.schema && /array/.test(JSON.stringify(parameter.schema.type ?? ''))
    query[name] = isArray ? value.split(',').map(v => v.trim()).filter(Boolean) : value
  }
  let request = buildRequest(operation, {
    baseUrl: options.baseUrl,
    pathParams: draft.pathParams,
    query,
    headers: draft.headers,
    cookies: draft.cookies,
    body: draft.body,
    contentType: draft.contentType,
  })
  for (const scheme of pickSecurity(operation, options.model, options.credentials)) {
    const credential = options.credentials[scheme.name]
    const usable = credential && (credential.token || credential.username || credential.password)
    if (usable) request = applyAuth(request, scheme, credential)
    else if (options.placeholders) request = applyAuth(request, scheme, PLACEHOLDER)
  }
  return request
}
