import { loadSpec, type ApiModel, type SpecSource } from '@apidoc/core'
import { useCallback, useEffect, useState } from 'react'
import { CommandPalette } from './components/CommandPalette'
import { IntroPage } from './components/IntroPage'
import { OperationPage } from './components/OperationPage'
import { Playground } from './components/Playground'
import { SchemaPage } from './components/SchemaPage'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { useHashRoute } from './lib/router'
import { readStored, writeStored } from './lib/storage'
import { DocsProvider, useDocs, type Theme } from './state'

export interface ApiReferenceProps {
  /** A URL to the spec, or `{ content }` with JSON/YAML text or a parsed object. */
  spec: string | SpecSource
  /** Force a theme; by default follows the viewer's choice, then their OS. */
  theme?: Theme
  className?: string
}

function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function Main() {
  const { route, model, operationById } = useDocs()
  if (route.view === 'playground') return <Playground operationId={route.id} />
  if (route.view === 'operation') {
    const operation = operationById(route.id)
    if (operation) return <OperationPage key={operation.id} operation={operation} />
  }
  if (route.view === 'schema') {
    const entry = model.schemas.find(s => s.name === route.name)
    if (entry) return <SchemaPage key={entry.name} entry={entry} />
  }
  return <IntroPage />
}

function Shell() {
  const [navOpen, setNavOpen] = useState(false)
  return (
    <>
      <Topbar onToggleSidebar={() => setNavOpen(open => !open)} />
      <div className="relative flex min-h-0 flex-1">
        <div className="hidden lg:flex">
          <Sidebar />
        </div>
        {navOpen && (
          <div className="absolute inset-0 z-30 flex lg:hidden">
            <Sidebar onNavigate={() => setNavOpen(false)} />
            <button type="button" aria-label="Close navigation" className="flex-1 bg-black/40" onClick={() => setNavOpen(false)} />
          </div>
        )}
        <main className="flex min-w-0 flex-1">
          <Main />
        </main>
      </div>
      <CommandPalette />
    </>
  )
}

export function ApiReference({ spec, theme: forcedTheme, className = '' }: ApiReferenceProps) {
  const source: SpecSource = typeof spec === 'string' ? { url: spec } : spec
  const sourceKey = 'url' in source ? source.url : typeof source.content === 'string' ? source.content : JSON.stringify(source.content).slice(0, 2000)
  const [state, setState] = useState<{ model?: ApiModel; error?: string; key?: string }>({})
  const [route, navigate] = useHashRoute()
  const [storedTheme, setStoredTheme] = useState<Theme | undefined>(() => readStored<Theme | undefined>('theme', undefined))
  const theme = forcedTheme ?? storedTheme ?? systemTheme()
  const setTheme = useCallback((next: Theme) => {
    setStoredTheme(next)
    writeStored('theme', next)
  }, [])

  useEffect(() => {
    let cancelled = false
    loadSpec(source)
      .then(model => {
        if (!cancelled) setState({ model, key: sourceKey })
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ error: error.message, key: sourceKey })
      })
    return () => {
      cancelled = true
    }
    // sourceKey captures the source identity; `source` itself is a fresh object each render.
  }, [sourceKey])

  const ready = state.key === sourceKey
  return (
    <div className={`apidoc flex h-full min-h-0 flex-col ${className}`} data-theme={theme}>
      {ready && state.model ? (
        <DocsProvider model={state.model} specUrl={'url' in source ? source.url : undefined} route={route} navigate={navigate} theme={theme} setTheme={setTheme}>
          <Shell />
        </DocsProvider>
      ) : ready && state.error ? (
        <div className="m-auto flex max-w-[520px] flex-col gap-3 rounded-xl border border-err-line bg-err-bg p-5">
          <span className="text-sm font-semibold text-err-text">Could not load the API description</span>
          <p className="text-[13px] leading-5 text-fg-2">{state.error}</p>
          {'url' in source && <code className="break-all font-mono text-xs text-muted">{source.url}</code>}
        </div>
      ) : (
        <div className="m-auto flex items-center gap-2.5 text-sm text-muted">
          <span className="size-2 animate-pulse rounded-full bg-accent" />
          Loading API reference…
        </div>
      )}
    </div>
  )
}
