import type { HttpRequestSpec } from '@apidoc/core'

export interface SendResult {
  ok: true
  status: number
  statusText: string
  durationMs: number
  sizeBytes: number
  headers: [string, string][]
  contentType: string
  body: string
  /** Pretty-printed when the body parsed as JSON. */
  json?: unknown
}

export interface SendFailure {
  ok: false
  durationMs: number
  /** "network" covers CORS, DNS, refused connections and mixed content: browsers report them identically. */
  kind: 'network' | 'aborted' | 'invalid'
  message: string
}

/** Browsers refuse to let scripts set these; we drop them and tell the user. */
const FORBIDDEN_HEADERS = new Set(['cookie', 'host', 'content-length', 'connection', 'origin', 'referer', 'user-agent'])

export const blockedHeaders = (request: HttpRequestSpec) => request.headers.filter(([name]) => FORBIDDEN_HEADERS.has(name.toLowerCase())).map(([name]) => name)

export async function sendRequest(request: HttpRequestSpec, signal?: AbortSignal): Promise<SendResult | SendFailure> {
  const started = performance.now()
  let url: URL
  try {
    url = new URL(request.url, window.location.href)
  } catch {
    return { ok: false, durationMs: 0, kind: 'invalid', message: `Invalid URL: ${request.url}` }
  }
  const headers = new Headers()
  for (const [name, value] of request.headers) {
    if (!FORBIDDEN_HEADERS.has(name.toLowerCase())) headers.append(name, value)
  }
  const hasBody = request.body !== undefined && !['GET', 'HEAD'].includes(request.method)
  try {
    // Default credentials mode ("same-origin"): session cookies flow when docs are
    // served by the API itself; cross-origin APIs use explicit auth headers.
    const response = await fetch(url, { method: request.method, headers, body: hasBody ? request.body : undefined, signal })
    const buffer = await response.arrayBuffer()
    const durationMs = performance.now() - started
    const contentType = response.headers.get('content-type') ?? ''
    const isText = !contentType || /json|text|xml|javascript|yaml|html|x-www-form-urlencoded/i.test(contentType)
    const body = isText ? new TextDecoder().decode(buffer) : `<${buffer.byteLength} bytes of ${contentType}>`
    let json: unknown
    if (/json/i.test(contentType) || /^\s*[[{]/.test(body)) {
      try {
        json = JSON.parse(body)
      } catch {
        // Not JSON after all.
      }
    }
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      durationMs,
      sizeBytes: buffer.byteLength,
      headers: [...response.headers.entries()],
      contentType,
      body,
      json,
    }
  } catch (error) {
    const durationMs = performance.now() - started
    if ((error as Error).name === 'AbortError') return { ok: false, durationMs, kind: 'aborted', message: 'Request cancelled.' }
    const crossOrigin = url.origin !== window.location.origin
    const mixed = window.location.protocol === 'https:' && url.protocol === 'http:'
    return {
      ok: false,
      durationMs,
      kind: 'network',
      message: mixed
        ? 'Blocked: this page is HTTPS and the API is plain HTTP (mixed content).'
        : crossOrigin
          ? `The browser could not reach ${url.origin}. Most often the API does not allow CORS from ${window.location.origin}; it can also be down or unreachable.`
          : `Could not reach ${url.origin}: ${(error as Error).message}`,
    }
  }
}

export const formatBytes = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)
export const formatMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`)
