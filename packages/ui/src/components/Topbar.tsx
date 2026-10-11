import type { SecuritySchemeModel } from '@apidoc/core'
import { useDocs } from '../state'
import { Popover } from './Popover'
import { Icon, Kbd } from './ui'

const inputClass =
  'w-full rounded-lg border border-border bg-raised px-2.5 py-1.5 font-mono text-xs text-fg outline-none placeholder:text-faint focus:border-accent-line'

function ServerPicker() {
  const { model, serverIndex, setServerIndex, serverVariables, setServerVariable, baseUrl } = useDocs()
  const server = model.servers[serverIndex] ?? model.servers[0]!
  const variables = Object.entries(server.variables)
  return (
    <Popover
      width={360}
      trigger={open => (
        <button type="button" className={`flex max-w-[340px] items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${open ? 'border-accent-line bg-accent-soft' : 'border-border bg-raised hover:border-border-strong'}`}>
          <Icon name="globe" size={13} className="text-muted" />
          <span className="text-fg">{server.description ?? 'Server'}</span>
          <span className="truncate font-mono text-[11px] text-subtle">{baseUrl.replace(/^https?:\/\//, '')}</span>
          <Icon name="chevronDown" size={12} className="text-subtle" />
        </button>
      )}
    >
      {close => (
        <div className="flex flex-col gap-1">
          <p className="px-1 pb-1 text-[11px] font-semibold tracking-wide text-subtle">SERVERS</p>
          {model.servers.map((option, index) => (
            <button
              key={option.url + index}
              type="button"
              onClick={() => {
                setServerIndex(index)
                if (!Object.keys(option.variables).length) close()
              }}
              className={`flex flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors ${index === serverIndex ? 'bg-selected' : 'hover:bg-hover'}`}
            >
              <span className="text-xs text-fg">{option.description ?? option.url}</span>
              <span className="font-mono text-[11px] text-subtle">{option.url}</span>
            </button>
          ))}
          {variables.length > 0 && (
            <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3">
              {variables.map(([name, variable]) => (
                <label key={name} className="flex flex-col gap-1">
                  <span className="font-mono text-[11px] text-muted">{name}</span>
                  {variable.enum ? (
                    <select className={inputClass} value={serverVariables[name] ?? variable.default} onChange={e => setServerVariable(name, e.target.value)}>
                      {variable.enum.map(v => <option key={v}>{v}</option>)}
                    </select>
                  ) : (
                    <input className={inputClass} value={serverVariables[name] ?? variable.default} onChange={e => setServerVariable(name, e.target.value)} />
                  )}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </Popover>
  )
}

function schemeHint(scheme: SecuritySchemeModel) {
  switch (scheme.kind) {
    case 'http':
      return scheme.scheme === 'basic' ? 'HTTP Basic' : `HTTP ${scheme.scheme}${scheme.bearerFormat ? ` · ${scheme.bearerFormat}` : ''}`
    case 'apiKey':
      return `API key in ${scheme.in} · ${scheme.paramName}`
    case 'oauth2':
      return 'OAuth 2 · paste an access token'
    case 'openIdConnect':
      return 'OpenID Connect · paste an access token'
    default:
      return 'Unsupported scheme'
  }
}

export function AuthPanel() {
  const { model, credentials, setCredential } = useDocs()
  const schemes = Object.values(model.securitySchemes)
  if (!schemes.length) return <p className="text-xs text-subtle">This API does not declare any security schemes.</p>
  return (
    <div className="flex flex-col gap-4">
      {schemes.map(scheme => {
        const credential = credentials[scheme.name] ?? {}
        return (
          <div key={scheme.name} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-xs font-medium text-fg">{scheme.name}</span>
              <span className="text-[11px] text-subtle">{schemeHint(scheme)}</span>
            </div>
            {scheme.kind === 'http' && scheme.scheme === 'basic' ? (
              <div className="flex gap-2">
                <input className={inputClass} placeholder="username" autoComplete="off" value={credential.username ?? ''} onChange={e => setCredential(scheme.name, { ...credential, username: e.target.value })} />
                <input className={inputClass} placeholder="password" type="password" autoComplete="off" value={credential.password ?? ''} onChange={e => setCredential(scheme.name, { ...credential, password: e.target.value })} />
              </div>
            ) : scheme.kind !== 'unknown' ? (
              <input className={inputClass} placeholder={scheme.kind === 'apiKey' ? 'API key' : 'token'} type="password" autoComplete="off" value={credential.token ?? ''} onChange={e => setCredential(scheme.name, { ...credential, token: e.target.value })} />
            ) : null}
          </div>
        )
      })}
      <p className="text-[11px] leading-4 text-subtle">Kept in this tab only (sessionStorage). Never sent anywhere except the API you call.</p>
    </div>
  )
}

export function Topbar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { model, theme, setTheme, setPaletteOpen, route, navigate, credentials, arazzo } = useDocs()
  const authorized = Object.values(credentials).some(c => c.token || c.username || c.password)
  const inPlayground = route.view === 'playground'
  const inWorkflows = route.view === 'workflow'
  const currentOperation = route.view === 'operation' ? route.id : route.view === 'playground' ? route.id : undefined

  const downloadSpec = () => {
    const blob = new Blob([JSON.stringify(model.document, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${model.info.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-openapi.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-bg px-4">
      <button type="button" onClick={onToggleSidebar} className="rounded-md p-1.5 text-muted hover:bg-hover lg:hidden" aria-label="Toggle navigation">
        <Icon name="menu" size={16} />
      </button>
      <a href="#/" className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent font-mono text-[13px] font-bold text-on-accent">{'{}'}</span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-fg">{model.info.title}</span>
          <span className="hidden text-[11px] text-subtle sm:block">Reference · Playground</span>
        </span>
      </a>
      {model.info.version && (
        <span className="hidden items-center gap-1.5 rounded-lg border border-border bg-raised px-2.5 py-1.5 md:flex">
          <span className="size-1.5 rounded-full bg-ok" />
          <span className="font-mono text-xs text-fg">v{model.info.version.replace(/^v/, '')}</span>
          <span className="text-[11px] text-subtle">{model.sourceFormat === 'swagger2' ? 'Swagger 2.0' : `OpenAPI ${model.specVersion}`}</span>
        </span>
      )}
      <div className="hidden xl:block">
        <ServerPicker />
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="hidden w-[340px] items-center gap-2.5 rounded-[10px] border border-border bg-raised px-3 py-2 text-left text-[13px] text-subtle transition-colors hover:border-border-strong md:flex"
      >
        <Icon name="search" size={15} />
        <span className="flex-1">Search endpoints, schemas, fields…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <button type="button" onClick={() => setPaletteOpen(true)} className="rounded-md p-1.5 text-muted hover:bg-hover md:hidden" aria-label="Search">
        <Icon name="search" size={16} />
      </button>
      <div className="flex-1" />
      <div className="hidden gap-0.5 rounded-[9px] border border-line bg-card p-[3px] sm:flex">
        <button type="button" onClick={() => navigate(currentOperation ? { view: 'operation', id: currentOperation } : { view: 'intro' })} className={`rounded-md px-3 py-1 text-xs ${!inPlayground && !inWorkflows ? 'bg-active font-medium text-fg' : 'text-subtle hover:text-fg-2'}`}>
          Reference
        </button>
        <button type="button" onClick={() => navigate({ view: 'playground', id: currentOperation })} className={`rounded-md px-3 py-1 text-xs ${inPlayground ? 'bg-active font-medium text-fg' : 'text-subtle hover:text-fg-2'}`}>
          Playground
        </button>
        {arazzo.status === 'ready' && (
          <button type="button" onClick={() => navigate({ view: 'workflow' })} className={`rounded-md px-3 py-1 text-xs ${inWorkflows ? 'bg-active font-medium text-fg' : 'text-subtle hover:text-fg-2'}`}>
            Workflows
          </button>
        )}
      </div>
      <Popover
        align="right"
        width={340}
        trigger={open => (
          <button type="button" className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${open ? 'border-accent-line bg-accent-soft text-accent-text' : 'border-border text-fg-2 hover:border-border-strong'}`}>
            <Icon name="lock" size={13} className={authorized ? 'text-ok' : 'text-muted'} />
            <span className="hidden sm:inline">{authorized ? 'Authorized' : 'Authorize'}</span>
          </button>
        )}
      >
        {() => <AuthPanel />}
      </Popover>
      <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="flex size-8 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:text-fg" aria-label="Toggle theme">
        <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={15} />
      </button>
      <button type="button" onClick={downloadSpec} className="hidden size-8 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:text-fg sm:flex" aria-label="Download OpenAPI document" title="Download OpenAPI JSON">
        <Icon name="download" size={15} />
      </button>
    </header>
  )
}
