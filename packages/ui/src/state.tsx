import {
  buildSearchIndex,
  resolveServerUrl,
  Resolver,
  type ApiModel,
  type Credential,
  type CsrfConfig,
  type OperationModel,
  type SearchIndex,
} from '@apidoc/core'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { readStored, writeStored } from './lib/storage'
import type { Route } from './lib/router'

export type Theme = 'dark' | 'light'

export interface DocsState {
  model: ApiModel
  resolver: Resolver
  search: SearchIndex
  /** Where the spec was loaded from; relative server URLs resolve against it. */
  specUrl?: string
  /** CSRF header for same-origin playground requests (e.g. Django session auth). */
  csrf?: CsrfConfig
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
  route: Route
  navigate: (route: Route) => void
  theme: Theme
  setTheme: (theme: Theme) => void
  children: ReactNode
}

export function DocsProvider({ model, specUrl, csrf, route, navigate, theme, setTheme, children }: ProviderProps) {
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

  const server = model.servers[serverIndex] ?? model.servers[0]!
  const baseUrl = absolutize(resolveServerUrl(server, serverVariables), specUrl)

  const value = useMemo<DocsState>(() => ({
    model,
    resolver,
    search,
    specUrl,
    csrf,
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
  }), [model, resolver, search, specUrl, csrf, route, navigate, operations, theme, setTheme, serverIndex, setServerIndex, serverVariables, setServerVariable, baseUrl, credentials, setCredential, paletteOpen])

  return <DocsContext.Provider value={value}>{children}</DocsContext.Provider>
}
