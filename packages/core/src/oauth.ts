/**
 * OAuth 2.0 and OpenID Connect for the playground: flows from the spec, PKCE,
 * authorization URLs, callback parsing and token requests. Network calls go
 * through an injected `fetch`, so this runs in browsers, Node and tests alike.
 */
import type { SecuritySchemeModel } from './types'

export type OAuthFlowType = 'authorizationCode' | 'clientCredentials' | 'password' | 'implicit'

export interface OAuthFlow {
  type: OAuthFlowType
  authorizationUrl?: string
  tokenUrl?: string
  refreshUrl?: string
  /** Scope name → description. */
  scopes: Record<string, string>
}

export interface TokenSet {
  accessToken: string
  tokenType: string
  /** Epoch milliseconds. */
  expiresAt?: number
  refreshToken?: string
  /** Granted scopes, when the server says. */
  scope?: string
  idToken?: string
}

export class OAuthError extends Error {
  constructor(
    message: string,
    /** The `error` code from the server or callback, e.g. "invalid_grant". */
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'OAuthError'
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

const FLOW_ORDER: OAuthFlowType[] = ['authorizationCode', 'clientCredentials', 'password', 'implicit']

/**
 * The flows an oauth2 scheme declares, with URLs resolved against the API
 * server (OpenAPI says relative URLs are relative to it: FastAPI emits `token`).
 */
export function oauthFlows(scheme: SecuritySchemeModel, baseUrl: string): OAuthFlow[] {
  if (scheme.kind !== 'oauth2') return []
  const flows = scheme.flows as Record<string, Record<string, unknown> | undefined>
  const resolve = (url: unknown) => (typeof url === 'string' && url ? resolveUrl(url, baseUrl) : undefined)
  return FLOW_ORDER.flatMap(type => {
    const flow = flows[type]
    if (!flow || typeof flow !== 'object') return []
    const scopes = flow.scopes && typeof flow.scopes === 'object' ? (flow.scopes as Record<string, string>) : {}
    return [{ type, authorizationUrl: resolve(flow.authorizationUrl), tokenUrl: resolve(flow.tokenUrl), refreshUrl: resolve(flow.refreshUrl), scopes }]
  })
}

/** OpenID Connect discovery: an authorization-code flow from `/.well-known/openid-configuration`. */
export async function discoverOpenIdConnect(url: string, fetchImpl: Fetch): Promise<OAuthFlow[]> {
  let response: Response
  try {
    response = await fetchImpl(url, { headers: { Accept: 'application/json' } })
  } catch (error) {
    throw new OAuthError(`Could not reach ${url} (${(error as Error).message}). The provider may not allow cross-origin requests.`)
  }
  if (!response.ok) throw new OAuthError(`OpenID discovery failed: HTTP ${response.status} from ${url}`, undefined, response.status)
  const config = (await response.json()) as Record<string, unknown>
  const scopes = Object.fromEntries((Array.isArray(config.scopes_supported) ? config.scopes_supported : ['openid', 'profile', 'email']).map(s => [String(s), '']))
  const grants = Array.isArray(config.grant_types_supported) ? config.grant_types_supported.map(String) : ['authorization_code']
  const flows: OAuthFlow[] = []
  if (grants.includes('authorization_code') && typeof config.authorization_endpoint === 'string') {
    flows.push({ type: 'authorizationCode', authorizationUrl: config.authorization_endpoint, tokenUrl: String(config.token_endpoint ?? ''), scopes })
  }
  if (grants.includes('client_credentials') && typeof config.token_endpoint === 'string') {
    flows.push({ type: 'clientCredentials', tokenUrl: config.token_endpoint, scopes })
  }
  if (!flows.length) throw new OAuthError(`${url} lists no authorization endpoint this playground can use.`)
  return flows
}

// --- PKCE and the authorization request -------------------------------------

const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'

export function randomString(length = 64): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, b => UNRESERVED[b % UNRESERVED.length]).join('')
}

/** RFC 7636 S256: code_challenge = BASE64URL(SHA-256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface AuthorizeOptions {
  clientId: string
  redirectUri: string
  scopes: string[]
  state: string
  /** Authorization code flow: the S256 challenge. Omit only for servers that reject PKCE. */
  codeChallenge?: string
  /** OpenID Connect replay protection. */
  nonce?: string
}

export function authorizationUrl(flow: OAuthFlow, options: AuthorizeOptions): string {
  if (!flow.authorizationUrl) throw new OAuthError('This flow has no authorizationUrl.')
  const url = new URL(flow.authorizationUrl)
  const params: Record<string, string | undefined> = {
    response_type: flow.type === 'implicit' ? 'token' : 'code',
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    scope: options.scopes.length ? options.scopes.join(' ') : undefined,
    state: options.state,
    code_challenge: flow.type === 'authorizationCode' ? options.codeChallenge : undefined,
    code_challenge_method: flow.type === 'authorizationCode' && options.codeChallenge ? 'S256' : undefined,
    nonce: options.nonce,
  }
  for (const [name, value] of Object.entries(params)) if (value) url.searchParams.set(name, value)
  return url.toString()
}

export interface CallbackResult {
  state?: string
  code?: string
  /** Implicit flow: the token arrives in the fragment. */
  token?: TokenSet
  error?: OAuthError
}

/** Read the redirect URL the provider sent the browser back to (query or fragment). */
export function parseCallback(url: string, now = Date.now()): CallbackResult | undefined {
  const parsed = new URL(url)
  const params = new URLSearchParams(parsed.search)
  // Implicit flow (and response_mode=fragment) put everything after the '#'.
  for (const [name, value] of new URLSearchParams(parsed.hash.replace(/^#/, ''))) if (!params.has(name)) params.set(name, value)
  const state = params.get('state') ?? undefined
  const error = params.get('error')
  if (error) {
    const description = params.get('error_description')
    return { state, error: new OAuthError(description ? `${error}: ${description}` : error, error) }
  }
  const code = params.get('code')
  if (code) return { state, code }
  const accessToken = params.get('access_token')
  if (accessToken) return { state, token: tokenSet({ access_token: accessToken, token_type: params.get('token_type'), expires_in: params.get('expires_in'), scope: params.get('scope') }, now) }
  return undefined
}

// --- Token endpoint ----------------------------------------------------------

export interface ClientAuth {
  clientId: string
  clientSecret?: string
  /** How to send a secret: HTTP Basic (the default, RFC 6749 §2.3.1) or in the body. */
  method?: 'basic' | 'body'
}

export async function requestToken(tokenUrl: string, grant: Record<string, string | undefined>, client: ClientAuth, fetchImpl: Fetch, now = () => Date.now()): Promise<TokenSet> {
  const body = new URLSearchParams()
  for (const [name, value] of Object.entries(grant)) if (value !== undefined && value !== '') body.set(name, value)
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
  if (client.clientSecret && client.method !== 'body') {
    // RFC 6749 §2.3.1: form-encode both parts before Basic-encoding them.
    headers.Authorization = `Basic ${btoa(`${formEncode(client.clientId)}:${formEncode(client.clientSecret)}`)}`
  } else {
    if (client.clientId) body.set('client_id', client.clientId)
    if (client.clientSecret) body.set('client_secret', client.clientSecret)
  }

  let response: Response
  try {
    response = await fetchImpl(tokenUrl, { method: 'POST', headers, body: body.toString() })
  } catch (error) {
    throw new OAuthError(`Could not reach the token endpoint ${tokenUrl} (${(error as Error).message}). If it is on another origin, it must allow cross-origin requests from this page.`)
  }
  const text = await response.text()
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    // Some providers (GitHub without Accept) answer form-encoded.
    data = Object.fromEntries(new URLSearchParams(text))
  }
  if (!response.ok || typeof data.error === 'string') {
    const code = typeof data.error === 'string' ? data.error : undefined
    const description = typeof data.error_description === 'string' ? data.error_description : typeof data.detail === 'string' ? data.detail : undefined
    throw new OAuthError(`${code ?? `HTTP ${response.status}`}${description ? `: ${description}` : ''}`, code, response.status)
  }
  if (typeof data.access_token !== 'string') throw new OAuthError('The token response has no access_token.', undefined, response.status)
  return tokenSet(data, now())
}

export const exchangeCode = (flow: OAuthFlow, code: string, redirectUri: string, codeVerifier: string | undefined, client: ClientAuth, fetchImpl: Fetch) =>
  requestToken(requireTokenUrl(flow), { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier }, client, fetchImpl)

export const clientCredentialsGrant = (flow: OAuthFlow, scopes: string[], client: ClientAuth, fetchImpl: Fetch) =>
  requestToken(requireTokenUrl(flow), { grant_type: 'client_credentials', scope: scopes.join(' ') }, client, fetchImpl)

export const passwordGrant = (flow: OAuthFlow, username: string, password: string, scopes: string[], client: ClientAuth, fetchImpl: Fetch) =>
  requestToken(requireTokenUrl(flow), { grant_type: 'password', username, password, scope: scopes.join(' ') }, client, fetchImpl)

export function refreshGrant(flow: OAuthFlow, refreshToken: string, client: ClientAuth, fetchImpl: Fetch, previous?: TokenSet): Promise<TokenSet> {
  return requestToken(flow.refreshUrl ?? requireTokenUrl(flow), { grant_type: 'refresh_token', refresh_token: refreshToken }, client, fetchImpl).then(token => ({
    ...token,
    // Servers that don't rotate refresh tokens leave it out of the response.
    refreshToken: token.refreshToken ?? refreshToken,
    idToken: token.idToken ?? previous?.idToken,
  }))
}

/** True when the token has expired or will within `skewMs`. */
export function isExpired(token: Pick<TokenSet, 'expiresAt'>, now = Date.now(), skewMs = 30_000): boolean {
  return token.expiresAt !== undefined && token.expiresAt - skewMs <= now
}

function requireTokenUrl(flow: OAuthFlow): string {
  if (!flow.tokenUrl) throw new OAuthError('This flow has no tokenUrl.')
  return flow.tokenUrl
}

function tokenSet(data: Record<string, unknown>, now: number): TokenSet {
  const expiresIn = Number(data.expires_in)
  return {
    accessToken: String(data.access_token),
    tokenType: typeof data.token_type === 'string' && data.token_type ? data.token_type : 'Bearer',
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : undefined,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    scope: typeof data.scope === 'string' ? data.scope : undefined,
    idToken: typeof data.id_token === 'string' ? data.id_token : undefined,
  }
}

function resolveUrl(url: string, base: string): string {
  try {
    // Core runs outside browsers too (CLI, tests): only use the page URL when there is one.
    const page = (globalThis as { document?: { baseURI?: string } }).document?.baseURI ?? 'http://localhost/'
    return new URL(url, new URL(base.endsWith('/') ? base : `${base}/`, page)).toString()
  } catch {
    return url
  }
}

const formEncode = (value: string) => encodeURIComponent(value).replace(/%20/g, '+')
