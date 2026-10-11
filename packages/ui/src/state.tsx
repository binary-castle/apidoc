import {
  buildSearchIndex,
  resolveServerUrl,
  Resolver,
  type ApiModel,
  type Credential,
  type CsrfConfig,
  type OperationChangeStatus,
  type OperationModel,
  type SearchIndex,
  type SpecDiff,
  type SpecSource,
} from '@apidoc/core'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { completeRedirectSignIn, refreshIfExpired, type OAuthConfig } from './lib/oauth'
import { readStored, writeStored } from './lib/storage'
import type { Route } from './lib/router'
import { useOperationChanges, usePreviousDiff, type ApiVersion, type LoadState } from './lib/versions'
import { useArazzo, type LoadedArazzo } from './lib/workflows'

export type Theme = 'dark' | 'light'

export interface DocsState {
  /** Host defaults for OAuth sign-in (client id, scopes, redirect URL). */
  oauth?: OAuthConfig
  /**
   * The credentials to send now: expired OAuth tokens with a refresh token are
   * refreshed first (and stored). Call it right before sending a request.
   */
  freshCredentials: () => Promise<Record<string, Credential>>
  /** Errors from a same-tab sign-in that finished on page load, by scheme. */
  signInErrors: Record<string, string>
  model: ApiModel
  resolver: Resolver
  search: SearchIndex
  /** Where the spec was loaded from; relative server URLs resolve against it. */
  specUrl?: string
  /** CSRF header for same-origin playground requests (e.g. Django session auth). */
  csrf?: CsrfConfig
  /** Older releases (newest first); the loaded spec is the current one. */
  versions: ApiVersion[]
  /** Previous release → current, once loaded. */
  previousDiff?: SpecDiff
  operationChange: (id: string) => OperationChangeStatus | undefined
  /** Arazzo workflows for this API, if configured. */
  arazzo: LoadState<LoadedArazzo>
  route: Route
  navigate: (route: Route) => void
  operationById: (id: string) => OperationModel | undefined

  theme: Theme
  setTheme: (theme: Theme) => void

  serverIndex: number
  setServerIndex: (index: number) => void
  serverVariables: Record<string, string>
  setServerVariable: (name: string, value: string) => void
  /** Absolute base URL for requests, from the selected server + variables. */
  baseUrl: string

  credentials: Record<string, Credential>
  setCredential: (scheme: string, credential: Credential) => void

  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void
}

const DocsContext = createContext<DocsState | null>(null)
const NO_VERSIONS: ApiVersion[] = []

export function useDocs(): DocsState {
  const state = useContext(DocsContext)
  if (!state) throw new Error('useDocs must be used inside <ApiReference>')
  return state
}

function absolutize(url: string, specUrl?: string) {
  try {
    return new URL(url, specUrl ? new URL(specUrl, window.location.href) : window.location.href).toString().replace(/\/$/, '')
  } catch {
    return url
  }
}

interface ProviderProps {
  model: ApiModel
  specUrl?: string
  csrf?: CsrfConfig
  versions?: ApiVersion[]
  workflows?: string | SpecSource
  oauth?: OAuthConfig
  route: Route
  navigate: (route: Route) => void
  theme: Theme
  setTheme: (theme: Theme) => void
  children: ReactNode
}

export function DocsProvider({ model, specUrl, csrf, versions = NO_VERSIONS, workflows, oauth, route, navigate, theme, setTheme, children }: ProviderProps) {
  const storageKey = model.info.title
  const resolver = useMemo(() => new Resolver(model.document), [model])
  const search = useMemo(() => buildSearchIndex(model), [model])
  const operations = useMemo(() => new Map(model.operations.map(op => [op.id, op])), [model])

  const [serverIndex, setServerIndexState] = useState(() =>
    Math.min(readStored(`${storageKey}:server`, 0), model.servers.length - 1),
  )
  const [serverVariables, setServerVariables] = useState<Record<string, string>>(() =>
    readStored(`${storageKey}:server-vars`, {}),
  )
  // Secrets live in sessionStorage only: they survive reloads but not the tab.
  const [credentials, setCredentials] = useState<Record<string, Credential>>(() =>
    readStored(`${storageKey}:credentials`, {}, 'session'),
  )
  const [paletteOpen, setPaletteOpen] = useState(false)
  const previousDiff = usePreviousDiff(model, versions)
  const changes = useOperationChanges(previousDiff)
  const arazzo = useArazzo(workflows)

  const setServerIndex = useCallback((index: number) => {
    setServerIndexState(index)
    writeStored(`${storageKey}:server`, index)
  }, [storageKey])

  const setServerVariable = useCallback((name: string, value: string) => {
    setServerVariables(current => {
      const next = { ...current, [name]: value }
      writeStored(`${storageKey}:server-vars`, next)
      return next
    })
  }, [storageKey])

  const setCredential = useCallback((scheme: string, credential: Credential) => {
    setCredentials(current => {
      const next = { ...current, [scheme]: credential }
      writeStored(`${storageKey}:credentials`, next, 'session')
      return next
    })
  }, [storageKey])

  // Read inside freshCredentials without making it change on every credential edit.
  const credentialsRef = useRef(credentials)
  credentialsRef.current = credentials
  const freshCredentials = useCallback(async () => {
    const current = credentialsRef.current
    let changed = false
    const next: Record<string, Credential> = {}
    for (const [name, credential] of Object.entries(current)) {
      try {
        next[name] = await refreshIfExpired(credential)
      } catch {
        // Keep the expired token: the API's 401 is a clearer signal than a refresh error here.
        next[name] = credential
      }
      if (next[name] !== credential) {
        changed = true
        setCredential(name, next[name]!)
      }
    }
    return changed ? next : current
  }, [setCredential])

  // Back from the provider after a same-tab sign-in: finish it.
  const [signInErrors, setSignInErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    const pending = completeRedirectSignIn()
    if (!pending) return
    pending.credential.then(
      credential => setCredential(pending.scheme, credential),
      (error: Error) => setSignInErrors(current => ({ ...current, [pending.scheme]: error.message })),
    )
  }, [setCredential])

  const server = model.servers[serverIndex] ?? model.servers[0]!
  const baseUrl = absolutize(resolveServerUrl(server, serverVariables), specUrl)

  const value = useMemo<DocsState>(() => ({
    oauth,
    freshCredentials,
    signInErrors,
    model,
    resolver,
    search,
    specUrl,
    csrf,
    versions,
    previousDiff,
    operationChange: id => changes.get(id),
    arazzo,
    route,
    navigate,
    operationById: id => operations.get(id),
    theme,
    setTheme,
    serverIndex,
    setServerIndex,
    serverVariables,
    setServerVariable,
    baseUrl,
    credentials,
    setCredential,
    paletteOpen,
    setPaletteOpen,
  }), [oauth, freshCredentials, signInErrors, model, resolver, search, specUrl, csrf, versions, previousDiff, changes, arazzo, route, navigate, operations, theme, setTheme, serverIndex, setServerIndex, serverVariables, setServerVariable, baseUrl, credentials, setCredential, paletteOpen])

  return <DocsContext.Provider value={value}>{children}</DocsContext.Provider>
}
