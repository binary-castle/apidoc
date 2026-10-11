import {
  authorizationUrl,
  clientCredentialsGrant,
  exchangeCode,
  isExpired,
  OAuthError,
  parseCallback,
  passwordGrant,
  pkceChallenge,
  randomString,
  refreshGrant,
  type CallbackResult,
  type Credential,
  type OAuthFlow,
  type TokenSet,
} from '@apidoc/core'

/**
 * Sign-in for the playground. Redirect flows open the provider in a popup
 * whose redirect URI is the docs page itself: when the popup lands back here,
 * this module (loaded by the docs page) relays the result to the opener and
 * closes the popup. No separate callback page is needed; register the docs
 * URL (shown in the Authorize panel) as a redirect URI with the provider.
 */

/** Defaults a host can set: the docs' own client id, scopes to preselect, a redirect URL. */
export interface OAuthConfig {
  clientId?: string
  scopes?: string[]
  /** Must be same-origin with the docs. Defaults to the docs page URL. */
  redirectUrl?: string
}

// The opener records each pending `state` here. (Not window.name: Firefox and
// Safari clear it when the popup navigates to the provider's site.)
const PENDING_PREFIX = 'apidoc-oauth:'
const PENDING_TTL = 10 * 60_000
const CHANNEL = 'apidoc-oauth'
const MESSAGE = 'apidoc-oauth-callback'

export function defaultRedirectUrl(): string {
  return window.location.origin + window.location.pathname
}

/**
 * In the popup, after the provider redirects back: hand the URL to the opener
 * and close. True when this page is such a popup (the docs should not render).
 */
export function relayOAuthCallback(): boolean {
  if (typeof window === 'undefined') return false
  const callback = parseCallback(window.location.href)
  if (!callback?.state || !readPending(callback.state)) return false
  clearPending(callback.state)
  const message = { type: MESSAGE, url: window.location.href, state: callback.state }
  // The opener reference can be severed by the provider's COOP header; the channel still works.
  try {
    window.opener?.postMessage(message, window.location.origin)
  } catch {
    // Ignore: the channel below delivers it.
  }
  try {
    const channel = new BroadcastChannel(CHANNEL)
    channel.postMessage(message)
    channel.close()
  } catch {
    // Very old browsers: the opener message above is all we have.
  }
  // Don't leave the code in history; then close (allowed: the window was opened by script).
  history.replaceState(null, '', window.location.pathname)
  setTimeout(() => window.close(), 50)
  return true
}

function readPending(state: string): boolean {
  try {
    const at = Number(localStorage.getItem(PENDING_PREFIX + state))
    return Number.isFinite(at) && at > 0 && Date.now() - at < PENDING_TTL
  } catch {
    return false
  }
}

function writePending(state: string) {
  try {
    // Drop stale entries from abandoned sign-ins.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key?.startsWith(PENDING_PREFIX) && Date.now() - Number(localStorage.getItem(key)) > PENDING_TTL) localStorage.removeItem(key)
    }
    localStorage.setItem(PENDING_PREFIX + state, String(Date.now()))
  } catch {
    // Storage blocked: the popup can't identify itself, and sign-in will time out with a clear message.
  }
}

function clearPending(state: string) {
  try {
    localStorage.removeItem(PENDING_PREFIX + state)
  } catch {
    // Nothing to clean.
  }
}

export const isOAuthPopup = relayOAuthCallback()

/** Open the provider in a popup and wait for the redirect back to this page. */
function waitForCallback(popup: Window, url: string, state: string, signal: AbortSignal): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    let channel: BroadcastChannel | undefined
    const finish = () => {
      clearPending(state)
      window.removeEventListener('message', onMessage)
      channel?.close()
      signal.removeEventListener('abort', onAbort)
    }
    const accept = (data: unknown) => {
      const message = data as { type?: string; url?: string; state?: string } | null
      if (message?.type !== MESSAGE || message.state !== state || !message.url) return
      const result = parseCallback(message.url)
      if (!result) return
      finish()
      resolve(result)
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin) accept(event.data)
    }
    const onAbort = () => {
      finish()
      try {
        popup.close()
      } catch {
        // Already gone.
      }
      reject(new DOMException('Sign-in cancelled', 'AbortError'))
    }
    window.addEventListener('message', onMessage)
    try {
      channel = new BroadcastChannel(CHANNEL)
      channel.onmessage = event => accept(event.data)
    } catch {
      // postMessage alone.
    }
    signal.addEventListener('abort', onAbort)
    writePending(state)
    popup.location.href = url
  })
}

export interface SignInRequest {
  flow: OAuthFlow
  clientId: string
  clientSecret?: string
  scopes: string[]
  username?: string
  password?: string
  redirectUrl?: string
  signal: AbortSignal
}

/**
 * Run a flow and return the credential to store. Must be called from a click
 * handler: the popup is opened synchronously so blockers allow it.
 */
export function signIn(request: SignInRequest): Promise<Credential> {
  const { flow, clientId, clientSecret, scopes } = request
  const client = { clientId, clientSecret }
  const toCredential = (token: TokenSet): Credential => ({
    token: token.accessToken,
    oauth: {
      flow: flow.type,
      clientId,
      clientSecret: flow.type === 'clientCredentials' ? clientSecret : undefined,
      scopes,
      username: request.username,
      tokenUrl: flow.tokenUrl,
      refreshUrl: flow.refreshUrl,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      grantedScope: token.scope,
    },
  })

  if (flow.type === 'clientCredentials') return clientCredentialsGrant(flow, scopes, client, fetch).then(toCredential)
  if (flow.type === 'password') return passwordGrant(flow, request.username ?? '', request.password ?? '', scopes, client, fetch).then(toCredential)

  // Redirect flows. Open now, while the click still counts as a user gesture.
  const state = randomString(32)
  const popup = window.open('about:blank', 'apidoc-oauth', 'popup,width=520,height=680')
  if (!popup) return Promise.reject(new OAuthError('The sign-in window was blocked. Allow pop-ups for this page and try again.'))
  const redirectUri = request.redirectUrl ?? defaultRedirectUrl()
  const verifier = flow.type === 'authorizationCode' ? randomString(64) : undefined
  return (verifier ? pkceChallenge(verifier) : Promise.resolve(undefined))
    .then(codeChallenge => waitForCallback(popup, authorizationUrl(flow, { clientId, redirectUri, scopes, state, codeChallenge }), state, request.signal))
    .then(result => {
      if (result.error) throw result.error
      if (result.token) return toCredential(result.token)
      if (!result.code) throw new OAuthError('The provider sent no authorization code.')
      return exchangeCode(flow, result.code, redirectUri, verifier, client, fetch).then(toCredential)
    })
}

/** A fresh credential when the token has expired and can be refreshed; otherwise the same one. */
export async function refreshIfExpired(credential: Credential, force = false): Promise<Credential> {
  const oauth = credential.oauth
  if (!oauth?.refreshToken || !oauth.tokenUrl || (!force && !isExpired({ expiresAt: oauth.expiresAt }))) return credential
  const flow: OAuthFlow = { type: oauth.flow, tokenUrl: oauth.tokenUrl, refreshUrl: oauth.refreshUrl, scopes: {} }
  const token = await refreshGrant(flow, oauth.refreshToken, { clientId: oauth.clientId ?? '', clientSecret: oauth.clientSecret }, fetch)
  return {
    token: token.accessToken,
    oauth: { ...oauth, refreshToken: token.refreshToken, expiresAt: token.expiresAt, grantedScope: token.scope ?? oauth.grantedScope },
  }
}

export function describeExpiry(expiresAt: number | undefined, now = Date.now()): string | undefined {
  if (expiresAt === undefined) return undefined
  const seconds = Math.round((expiresAt - now) / 1000)
  if (seconds <= 0) return 'expired'
  if (seconds < 90) return `expires in ${seconds}s`
  const minutes = Math.round(seconds / 60)
  return minutes < 90 ? `expires in ${minutes} min` : `expires in ${Math.round(minutes / 60)} h`
}

// --- Same-tab sign-in, for when pop-ups are blocked --------------------------

const REDIRECT_KEY = 'apidoc-oauth-redirect'

interface PendingRedirect {
  scheme: string
  state: string
  verifier?: string
  flow: OAuthFlow
  clientId: string
  scopes: string[]
  redirectUri: string
  /** The docs URL (with its #route) to come back to. */
  returnTo: string
}

/** Leave for the provider in this tab; `completeRedirectSignIn` finishes on the way back. */
export async function startRedirectSignIn(scheme: string, request: Omit<SignInRequest, 'signal' | 'username' | 'password' | 'clientSecret'>): Promise<void> {
  const { flow, clientId, scopes } = request
  const state = randomString(32)
  const verifier = flow.type === 'authorizationCode' ? randomString(64) : undefined
  const redirectUri = request.redirectUrl ?? defaultRedirectUrl()
  const pending: PendingRedirect = { scheme, state, verifier, flow, clientId, scopes, redirectUri, returnTo: window.location.href }
  // sessionStorage: this tab only, and it survives the round trip through the provider.
  sessionStorage.setItem(REDIRECT_KEY, JSON.stringify(pending))
  const codeChallenge = verifier ? await pkceChallenge(verifier) : undefined
  window.location.assign(authorizationUrl(flow, { clientId, redirectUri, scopes, state, codeChallenge }))
}

/**
 * On load: if this page is the provider's redirect for a same-tab sign-in,
 * restore the docs URL and return the scheme with the pending credential.
 */
export function completeRedirectSignIn(): { scheme: string; credential: Promise<Credential> } | undefined {
  let pending: PendingRedirect
  try {
    const raw = sessionStorage.getItem(REDIRECT_KEY)
    if (!raw) return undefined
    pending = JSON.parse(raw) as PendingRedirect
  } catch {
    return undefined
  }
  const callback = parseCallback(window.location.href)
  if (!callback || callback.state !== pending.state) return undefined
  sessionStorage.removeItem(REDIRECT_KEY)
  // Drop ?code=… from the address bar and history, and go back to where sign-in started.
  const back = new URL(pending.returnTo)
  history.replaceState(null, '', back.pathname + back.search)
  if (back.hash) window.location.hash = back.hash

  const { flow, clientId, scopes, redirectUri, verifier } = pending
  const credential = (async (): Promise<Credential> => {
    if (callback.error) throw callback.error
    const token = callback.token ?? (callback.code ? await exchangeCode(flow, callback.code, redirectUri, verifier, { clientId }, fetch) : undefined)
    if (!token) throw new OAuthError('The provider sent no authorization code.')
    return {
      token: token.accessToken,
      oauth: { flow: flow.type, clientId, scopes, tokenUrl: flow.tokenUrl, refreshUrl: flow.refreshUrl, refreshToken: token.refreshToken, expiresAt: token.expiresAt, grantedScope: token.scope },
    }
  })()
  return { scheme: pending.scheme, credential }
}
