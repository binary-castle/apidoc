import { describe, expect, it } from 'vitest'
import {
  authorizationUrl,
  clientCredentialsGrant,
  discoverOpenIdConnect,
  exchangeCode,
  isExpired,
  loadSpec,
  OAuthError,
  oauthFlows,
  parseCallback,
  passwordGrant,
  pkceChallenge,
  randomString,
  refreshGrant,
  type SecuritySchemeModel,
} from '../src'

/** Records token requests and answers like a provider would. */
function fakeProvider(reply: (body: URLSearchParams, headers: Headers) => { status?: number; json?: unknown; text?: string }) {
  const calls: { url: string; body: URLSearchParams; headers: Headers }[] = []
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body ?? ''))
    const headers = new Headers(init?.headers)
    calls.push({ url, body, headers })
    const answer = reply(body, headers)
    return new Response(answer.text ?? JSON.stringify(answer.json), { status: answer.status ?? 200, headers: { 'Content-Type': answer.text ? 'application/x-www-form-urlencoded' : 'application/json' } })
  }
  return { calls, fetchImpl }
}

const scheme: SecuritySchemeModel = {
  kind: 'oauth2',
  name: 'oauth',
  flows: {
    password: { tokenUrl: 'token', scopes: { me: 'Read your profile' } },
    authorizationCode: { authorizationUrl: 'https://auth.example.com/authorize', tokenUrl: 'https://auth.example.com/token', refreshUrl: 'https://auth.example.com/refresh', scopes: { 'customers:read': 'Read customers' } },
  },
}

describe('oauthFlows', () => {
  it('lists flows in a stable order and resolves URLs against the server', () => {
    const flows = oauthFlows(scheme, 'http://localhost:8001')
    expect(flows.map(f => f.type)).toEqual(['authorizationCode', 'password'])
    expect(flows[1]!.tokenUrl).toBe('http://localhost:8001/token')
    expect(flows[0]!.refreshUrl).toBe('https://auth.example.com/refresh')
    // A server path is a directory: FastAPI's `token` under root_path /api.
    expect(oauthFlows(scheme, 'https://api.example.com/api')[1]!.tokenUrl).toBe('https://api.example.com/api/token')
  })

  it('reads the flows FastAPI generates for OAuth2PasswordBearer', async () => {
    const model = await loadSpec({ content: { openapi: '3.1.0', info: { title: 'A', version: '1' }, paths: {}, components: { securitySchemes: { OAuth2PasswordBearer: { type: 'oauth2', flows: { password: { scopes: {}, tokenUrl: 'token' } } } } } } })
    expect(oauthFlows(model.securitySchemes.OAuth2PasswordBearer!, '/')).toEqual([{ type: 'password', tokenUrl: 'http://localhost/token', authorizationUrl: undefined, refreshUrl: undefined, scopes: {} }])
  })
})

describe('PKCE and the authorization URL', () => {
  it('computes the RFC 7636 S256 challenge', async () => {
    // Appendix B of RFC 7636.
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('makes unreserved random strings', () => {
    const value = randomString(64)
    expect(value).toMatch(/^[A-Za-z0-9\-._~]{64}$/)
    expect(randomString(64)).not.toBe(value)
  })

  it('builds the authorization request', () => {
    const [flow] = oauthFlows(scheme, 'http://localhost')
    const url = new URL(authorizationUrl(flow!, { clientId: 'docs', redirectUri: 'http://localhost/docs/', scopes: ['customers:read', 'openid'], state: 's1', codeChallenge: 'c1' }))
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'docs',
      redirect_uri: 'http://localhost/docs/',
      scope: 'customers:read openid',
      state: 's1',
      code_challenge: 'c1',
      code_challenge_method: 'S256',
    })
  })

  it('asks for a token directly in the implicit flow', () => {
    const url = new URL(authorizationUrl({ type: 'implicit', authorizationUrl: 'https://auth.example.com/authorize?audience=api', scopes: {} }, { clientId: 'docs', redirectUri: 'http://localhost/', scopes: [], state: 's', codeChallenge: 'ignored' }))
    expect(url.searchParams.get('response_type')).toBe('token')
    expect(url.searchParams.get('audience')).toBe('api')
    expect(url.searchParams.has('code_challenge')).toBe(false)
    expect(url.searchParams.has('scope')).toBe(false)
  })
})

describe('parseCallback', () => {
  it('reads a code, an implicit token and errors', () => {
    expect(parseCallback('http://localhost/docs/?code=abc&state=s1')).toEqual({ state: 's1', code: 'abc' })
    expect(parseCallback('http://localhost/docs/#access_token=t&token_type=bearer&expires_in=60&state=s2', 1000)).toEqual({
      state: 's2',
      token: { accessToken: 't', tokenType: 'bearer', expiresAt: 61_000, refreshToken: undefined, scope: undefined, idToken: undefined },
    })
    const denied = parseCallback('http://localhost/docs/?error=access_denied&error_description=User+said+no&state=s3')!
    expect(denied.state).toBe('s3')
    expect(denied.error).toBeInstanceOf(OAuthError)
    expect(denied.error!.message).toBe('access_denied: User said no')
    expect(denied.error!.code).toBe('access_denied')
    expect(parseCallback('http://localhost/docs/#/operation/x')).toBeUndefined()
  })
})

describe('token requests', () => {
  const [codeFlow, passwordFlow] = oauthFlows(scheme, 'http://localhost:8001')

  it('exchanges a code with the PKCE verifier, sending a public client id in the body', async () => {
    const provider = fakeProvider(() => ({ json: { access_token: 'at', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt', scope: 'customers:read' } }))
    const token = await exchangeCode(codeFlow!, 'abc', 'http://localhost/docs/', 'verifier', { clientId: 'docs' }, provider.fetchImpl)
    expect(token).toMatchObject({ accessToken: 'at', refreshToken: 'rt', scope: 'customers:read' })
    expect(token.expiresAt).toBeGreaterThan(Date.now() + 3_500_000)
    const [call] = provider.calls
    expect(call!.url).toBe('https://auth.example.com/token')
    expect(Object.fromEntries(call!.body)).toEqual({ grant_type: 'authorization_code', code: 'abc', redirect_uri: 'http://localhost/docs/', code_verifier: 'verifier', client_id: 'docs' })
    expect(call!.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
  })

  it('sends a client secret with HTTP Basic by default, or in the body', async () => {
    const provider = fakeProvider(() => ({ json: { access_token: 'at' } }))
    await clientCredentialsGrant(codeFlow!, ['a', 'b'], { clientId: 'id:1', clientSecret: 's p' }, provider.fetchImpl)
    expect(provider.calls[0]!.headers.get('authorization')).toBe(`Basic ${btoa('id%3A1:s+p')}`)
    expect(Object.fromEntries(provider.calls[0]!.body)).toEqual({ grant_type: 'client_credentials', scope: 'a b' })

    await clientCredentialsGrant(codeFlow!, [], { clientId: 'id', clientSecret: 'secret', method: 'body' }, provider.fetchImpl)
    expect(provider.calls[1]!.headers.get('authorization')).toBeNull()
    expect(Object.fromEntries(provider.calls[1]!.body)).toEqual({ grant_type: 'client_credentials', client_id: 'id', client_secret: 'secret' })
  })

  it('does the password grant the way FastAPI expects', async () => {
    const provider = fakeProvider(body => (body.get('password') === 'secret' ? { json: { access_token: 'jwt', token_type: 'bearer' } } : { status: 400, json: { detail: 'Incorrect username or password' } }))
    expect((await passwordGrant(passwordFlow!, 'ada', 'secret', [], { clientId: '' }, provider.fetchImpl)).accessToken).toBe('jwt')
    expect(provider.calls[0]!.url).toBe('http://localhost:8001/token')
    expect(Object.fromEntries(provider.calls[0]!.body)).toEqual({ grant_type: 'password', username: 'ada', password: 'secret' })
    await expect(passwordGrant(passwordFlow!, 'ada', 'nope', [], { clientId: '' }, provider.fetchImpl)).rejects.toThrow('HTTP 400: Incorrect username or password')
  })

  it('reports OAuth errors and form-encoded answers', async () => {
    const failing = fakeProvider(() => ({ status: 400, json: { error: 'invalid_grant', error_description: 'Code expired' } }))
    const error = (await exchangeCode(codeFlow!, 'old', 'x', 'v', { clientId: 'docs' }, failing.fetchImpl).catch(e => e)) as OAuthError
    expect(error).toBeInstanceOf(OAuthError)
    expect(error.message).toBe('invalid_grant: Code expired')
    expect(error.code).toBe('invalid_grant')

    const github = fakeProvider(() => ({ text: 'access_token=gho_1&scope=repo&token_type=bearer' }))
    expect((await exchangeCode(codeFlow!, 'c', 'x', undefined, { clientId: 'docs' }, github.fetchImpl)).accessToken).toBe('gho_1')
  })

  it('explains network failures (usually CORS)', async () => {
    const fetchImpl = async () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(passwordGrant(passwordFlow!, 'a', 'b', [], { clientId: '' }, fetchImpl)).rejects.toThrow(/cross-origin/)
  })

  it('refreshes at refreshUrl and keeps a refresh token the server did not rotate', async () => {
    const provider = fakeProvider(() => ({ json: { access_token: 'at2', expires_in: 60 } }))
    const token = await refreshGrant(codeFlow!, 'rt', { clientId: 'docs' }, provider.fetchImpl, { accessToken: 'at', tokenType: 'Bearer', idToken: 'id' })
    expect(provider.calls[0]!.url).toBe('https://auth.example.com/refresh')
    expect(Object.fromEntries(provider.calls[0]!.body)).toEqual({ grant_type: 'refresh_token', refresh_token: 'rt', client_id: 'docs' })
    expect(token).toMatchObject({ accessToken: 'at2', refreshToken: 'rt', idToken: 'id' })
  })

  it('knows when a token is about to expire', () => {
    expect(isExpired({ expiresAt: 100_000 }, 50_000)).toBe(false)
    expect(isExpired({ expiresAt: 100_000 }, 80_000)).toBe(true)
    expect(isExpired({}, 1e15)).toBe(false)
  })
})

describe('discoverOpenIdConnect', () => {
  it('turns the provider configuration into flows', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ authorization_endpoint: 'https://id.example.com/auth', token_endpoint: 'https://id.example.com/token', scopes_supported: ['openid', 'email'], grant_types_supported: ['authorization_code', 'refresh_token'] }))
    const flows = await discoverOpenIdConnect('https://id.example.com/.well-known/openid-configuration', fetchImpl)
    expect(flows).toEqual([{ type: 'authorizationCode', authorizationUrl: 'https://id.example.com/auth', tokenUrl: 'https://id.example.com/token', scopes: { openid: '', email: '' } }])
  })
})
