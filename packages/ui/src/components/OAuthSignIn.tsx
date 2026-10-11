import { discoverOpenIdConnect, oauthFlows, type Credential, type OAuthFlow, type OAuthFlowType, type SecuritySchemeModel } from '@apidoc/core'
import { useEffect, useRef, useState } from 'react'
import { defaultRedirectUrl, describeExpiry, refreshIfExpired, signIn, startRedirectSignIn } from '../lib/oauth'
import { useDocs } from '../state'
import { CopyButton } from './ui'

const inputClass =
  'w-full rounded-lg border border-border bg-raised px-2.5 py-1.5 font-mono text-xs text-fg outline-none placeholder:text-faint focus:border-accent-line'

const FLOW_LABEL: Record<OAuthFlowType, string> = {
  authorizationCode: 'Authorization code (PKCE)',
  clientCredentials: 'Client credentials',
  password: 'Password',
  implicit: 'Implicit',
}

/** OpenID Connect discovery documents, fetched once per URL. */
const discovered = new Map<string, Promise<OAuthFlow[]>>()

function useFlows(scheme: SecuritySchemeModel, baseUrl: string) {
  const [state, setState] = useState<{ flows: OAuthFlow[]; error?: string; loading?: boolean }>(() => ({ flows: oauthFlows(scheme, baseUrl), loading: scheme.kind === 'openIdConnect' }))
  useEffect(() => {
    if (scheme.kind !== 'openIdConnect') {
      setState({ flows: oauthFlows(scheme, baseUrl) })
      return
    }
    let cancelled = false
    let pending = discovered.get(scheme.url)
    if (!pending) {
      pending = discoverOpenIdConnect(new URL(scheme.url, document.baseURI).toString(), (input, init) => fetch(input, init))
      pending.catch(() => discovered.delete(scheme.url))
      discovered.set(scheme.url, pending)
    }
    pending.then(
      flows => !cancelled && setState({ flows }),
      (error: Error) => !cancelled && setState({ flows: [], error: error.message }),
    )
    return () => {
      cancelled = true
    }
  }, [scheme, baseUrl])
  return state
}

/** Sign-in for an oauth2 or openIdConnect scheme, with a manual token as the fallback. */
export function OAuthSignIn({ scheme }: { scheme: SecuritySchemeModel }) {
  const { baseUrl, credentials, setCredential, oauth: config, signInErrors } = useDocs()
  const credential: Credential = credentials[scheme.name] ?? {}
  const { flows, error: discoveryError, loading } = useFlows(scheme, baseUrl)
  const [flowType, setFlowType] = useState<OAuthFlowType | undefined>(credential.oauth?.flow)
  const flow = flows.find(f => f.type === flowType) ?? flows[0]
  const [clientId, setClientId] = useState(credential.oauth?.clientId ?? config?.clientId ?? '')
  const [clientSecret, setClientSecret] = useState(credential.oauth?.clientSecret ?? '')
  const [username, setUsername] = useState(credential.oauth?.username ?? '')
  const [password, setPassword] = useState('')
  const [scopes, setScopes] = useState<string[]>(() => credential.oauth?.scopes ?? (config?.scopes?.length ? config.scopes : []))
  const [busy, setBusy] = useState<'signin' | 'refresh'>()
  const [error, setError] = useState<string | undefined>(signInErrors[scheme.name])
  useEffect(() => {
    if (signInErrors[scheme.name]) setError(signInErrors[scheme.name])
  }, [signInErrors, scheme.name])
  const abort = useRef<AbortController>(undefined)
  const [, tick] = useState(0)

  // Re-render every 30s so "expires in" stays current.
  useEffect(() => {
    if (!credential.oauth?.expiresAt) return
    const timer = setInterval(() => tick(n => n + 1), 30_000)
    return () => clearInterval(timer)
  }, [credential.oauth?.expiresAt])
  useEffect(() => () => abort.current?.abort(), [])

  const redirectUrl = config?.redirectUrl ?? defaultRedirectUrl()
  const redirects = flow?.type === 'authorizationCode' || flow?.type === 'implicit'
  const signedIn = Boolean(credential.token && credential.oauth)

  const start = () => {
    if (!flow) return
    setError(undefined)
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setBusy('signin')
    signIn({ flow, clientId: clientId.trim(), clientSecret: clientSecret || undefined, scopes, username, password, redirectUrl: config?.redirectUrl, signal: controller.signal })
      .then(next => {
        setCredential(scheme.name, next)
        setPassword('')
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message)
      })
      .finally(() => {
        if (abort.current === controller) setBusy(undefined)
      })
  }

  const refresh = () => {
    setError(undefined)
    setBusy('refresh')
    refreshIfExpired(credential, true)
      .then(next => setCredential(scheme.name, next))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(undefined))
  }

  if (signedIn) {
    const oauth = credential.oauth!
    const expiry = describeExpiry(oauth.expiresAt)
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-ok-line bg-ok-bg px-2.5 py-2">
          <span className={`size-1.5 shrink-0 rounded-full ${expiry === 'expired' ? 'bg-warn' : 'bg-ok'}`} />
          <span className="min-w-0 flex-1 text-xs text-fg-2">
            Signed in{oauth.username ? ` as ${oauth.username}` : ''} · {FLOW_LABEL[oauth.flow].replace(' (PKCE)', '').toLowerCase()}
            {expiry && <span className={expiry === 'expired' ? 'text-warn-text' : 'text-subtle'}> · {expiry}</span>}
          </span>
        </div>
        {(oauth.grantedScope ?? oauth.scopes?.join(' ')) && <p className="break-words font-mono text-[11px] text-subtle">scope: {oauth.grantedScope ?? oauth.scopes?.join(' ')}</p>}
        <div className="flex gap-2">
          {oauth.refreshToken && (
            <button type="button" onClick={refresh} disabled={busy === 'refresh'} className="rounded-lg border border-border px-2.5 py-1 text-xs text-fg-2 hover:border-border-strong disabled:opacity-60">
              {busy === 'refresh' ? 'Refreshing…' : 'Refresh token'}
            </button>
          )}
          <button type="button" onClick={() => setCredential(scheme.name, {})} className="rounded-lg border border-border px-2.5 py-1 text-xs text-fg-2 hover:border-border-strong">
            Sign out
          </button>
        </div>
        {error && <p className="text-[11px] leading-4 text-err-text">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      {loading && <p className="text-[11px] text-subtle">Reading the OpenID configuration…</p>}
      {discoveryError && <p className="text-[11px] leading-4 text-warn-text">{discoveryError}</p>}
      {flows.length > 1 && (
        <select className={inputClass} value={flow?.type} onChange={e => setFlowType(e.target.value as OAuthFlowType)} aria-label="OAuth flow">
          {flows.map(f => <option key={f.type} value={f.type}>{FLOW_LABEL[f.type]}</option>)}
        </select>
      )}
      {flow && (
        <>
          {flow.type === 'password' && (
            <div className="flex gap-2">
              <input className={inputClass} placeholder="username" autoComplete="off" value={username} onChange={e => setUsername(e.target.value)} aria-label="Username" />
              <input className={inputClass} placeholder="password" type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} aria-label="Password" />
            </div>
          )}
          <div className="flex gap-2">
            <input className={inputClass} placeholder={flow.type === 'password' ? 'client id (optional)' : 'client id'} autoComplete="off" value={clientId} onChange={e => setClientId(e.target.value)} aria-label="Client ID" />
            {(flow.type === 'clientCredentials' || flow.type === 'password') && (
              <input className={inputClass} placeholder="client secret" type="password" autoComplete="off" value={clientSecret} onChange={e => setClientSecret(e.target.value)} aria-label="Client secret" />
            )}
          </div>
          {Object.keys(flow.scopes).length > 0 && (
            <div className="flex flex-col gap-1">
              {Object.entries(flow.scopes).map(([name, description]) => (
                <label key={name} className="flex items-start gap-2 text-xs" title={description || undefined}>
                  <input type="checkbox" className="mt-0.5 accent-[var(--ad-accent)]" checked={scopes.includes(name)} onChange={e => setScopes(current => (e.target.checked ? [...current, name] : current.filter(s => s !== name)))} />
                  <span className="font-mono text-fg-2">{name}</span>
                  {description && <span className="min-w-0 truncate text-subtle">{description}</span>}
                </label>
              ))}
            </div>
          )}
          {redirects && (
            <div className="flex items-center gap-1.5 text-[11px] text-subtle">
              <span className="shrink-0">Redirect URL</span>
              <code className="min-w-0 flex-1 truncate font-mono text-muted" title={redirectUrl}>{redirectUrl}</code>
              <CopyButton text={redirectUrl} label="" />
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={start}
              disabled={busy === 'signin' || (flow.type !== 'password' && !clientId.trim()) || (flow.type === 'password' && (!username || !password))}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
            >
              {busy === 'signin' ? (redirects ? 'Waiting for sign-in…' : 'Signing in…') : 'Sign in'}
            </button>
            {busy === 'signin' && redirects && (
              <button type="button" onClick={() => abort.current?.abort()} className="text-xs text-muted hover:text-fg">
                Cancel
              </button>
            )}
          </div>
          {error && <p className="text-[11px] leading-4 text-err-text">{error}</p>}
          {/* Pop-ups blocked (embedded browsers, some phones), or the window got lost: sign in in this tab. */}
          {redirects && (busy === 'signin' || error) && (
            <button
              type="button"
              onClick={() => {
                abort.current?.abort()
                startRedirectSignIn(scheme.name, { flow, clientId: clientId.trim(), scopes, redirectUrl: config?.redirectUrl }).catch((e: Error) => setError(e.message))
              }}
              className="self-start text-[11px] text-accent-text underline underline-offset-2"
            >
              Continue in this tab instead
            </button>
          )}
        </>
      )}
      <details className="text-[11px] text-subtle">
        <summary className="cursor-pointer select-none">Or paste an access token</summary>
        <input
          className={`${inputClass} mt-1.5`}
          placeholder="token"
          type="password"
          autoComplete="off"
          value={credential.oauth ? '' : (credential.token ?? '')}
          onChange={e => setCredential(scheme.name, { token: e.target.value })}
          aria-label="Access token"
        />
      </details>
    </div>
  )
}
