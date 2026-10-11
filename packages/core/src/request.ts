import type { OperationModel, SecuritySchemeModel, ServerModel } from './types'

export interface HttpRequestSpec {
  method: string
  url: string
  headers: [string, string][]
  body?: string
}

export interface RequestInput {
  /** Absolute or relative base URL, already resolved from server variables. */
  baseUrl: string
  pathParams?: Record<string, string>
  query?: Record<string, string | string[]>
  headers?: Record<string, string>
  cookies?: Record<string, string>
  body?: string
  contentType?: string
}

export function resolveServerUrl(server: ServerModel, values: Record<string, string> = {}): string {
  return server.url.replace(/\{([^}]+)\}/g, (_, name: string) => values[name] ?? server.variables[name]?.default ?? `{${name}}`)
}

export function joinUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, '')
  const trimmedPath = path.startsWith('/') ? path : `/${path}`
  return `${trimmedBase}${trimmedPath}`
}

/** Fill path params, append query params (respecting `explode`), and set headers/cookies/body. */
export function buildRequest(operation: OperationModel, input: RequestInput): HttpRequestSpec {
  const pathParams = input.pathParams ?? {}
  const path = operation.path.replace(/\{([^}]+)\}/g, (match, name: string) => {
    const value = pathParams[name]
    return value === undefined || value === '' ? match : encodeURIComponent(value)
  })

  const search = new URLSearchParams()
  for (const [name, raw] of Object.entries(input.query ?? {})) {
    const values = (Array.isArray(raw) ? raw : [raw]).filter(v => v !== '')
    if (!values.length) continue
    const parameter = operation.parameters.find(p => p.in === 'query' && p.name === name)
    const explode = parameter?.explode ?? (parameter?.style ? parameter.style === 'form' : true)
    if (explode) values.forEach(v => search.append(name, v))
    else search.append(name, values.join(parameter?.style === 'pipeDelimited' ? '|' : parameter?.style === 'spaceDelimited' ? ' ' : ','))
  }
  const query = search.toString()

  const headers: [string, string][] = []
  for (const [name, value] of Object.entries(input.headers ?? {})) if (value !== '') headers.push([name, value])
  const cookies = Object.entries(input.cookies ?? {}).filter(([, v]) => v !== '')
  if (cookies.length) headers.push(['Cookie', cookies.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ')])
  const hasBody = input.body !== undefined && input.body !== ''
  if (hasBody && input.contentType && !headers.some(([k]) => k.toLowerCase() === 'content-type')) {
    headers.unshift(['Content-Type', input.contentType])
  }

  return {
    method: operation.method.toUpperCase(),
    url: joinUrl(input.baseUrl, path) + (query ? `?${query}` : ''),
    headers,
    body: hasBody ? input.body : undefined,
  }
}

/** Credentials entered by the user for one security scheme. */
export interface Credential {
  token?: string
  username?: string
  password?: string
}

/** Add credentials for a security scheme to a request (returns a new spec). */
export function applyAuth(request: HttpRequestSpec, scheme: SecuritySchemeModel, credential: Credential): HttpRequestSpec {
  const headers = [...request.headers]
  let url = request.url
  switch (scheme.kind) {
    case 'http':
      if (scheme.scheme === 'basic' && (credential.username || credential.password)) {
        headers.push(['Authorization', `Basic ${btoa(`${credential.username ?? ''}:${credential.password ?? ''}`)}`])
      } else if (credential.token) {
        const prefix = scheme.scheme === 'bearer' ? 'Bearer' : scheme.scheme.charAt(0).toUpperCase() + scheme.scheme.slice(1)
        headers.push(['Authorization', `${prefix} ${credential.token}`])
      }
      break
    case 'apiKey':
      if (!credential.token) break
      if (scheme.in === 'header') headers.push([scheme.paramName, credential.token])
      else if (scheme.in === 'cookie') headers.push(['Cookie', `${scheme.paramName}=${encodeURIComponent(credential.token)}`])
      else url += `${url.includes('?') ? '&' : '?'}${encodeURIComponent(scheme.paramName)}=${encodeURIComponent(credential.token)}`
      break
    case 'oauth2':
    case 'openIdConnect':
      if (credential.token) headers.push(['Authorization', `Bearer ${credential.token}`])
      break
  }
  return { ...request, url, headers }
}
