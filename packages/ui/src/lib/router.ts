import { useCallback, useEffect, useState } from 'react'

/**
 * Hash routing so the docs work when mounted at any path inside a host app
 * (/docs/, /api/reference/, a static file on S3) without server rewrites.
 */
export type Route =
  | { view: 'intro' }
  | { view: 'operation'; id: string }
  | { view: 'schema'; name: string }
  | { view: 'playground'; id?: string }
  | { view: 'changelog'; from?: string }

export function parseHash(hash: string): Route {
  const [kind, ...rest] = hash.replace(/^#\/?/, '').split('/')
  const value = rest.map(decodeURIComponent).join('/')
  if (kind === 'operation' && value) return { view: 'operation', id: value }
  if (kind === 'schema' && value) return { view: 'schema', name: value }
  if (kind === 'playground') return { view: 'playground', id: value || undefined }
  if (kind === 'changelog') return { view: 'changelog', from: value || undefined }
  return { view: 'intro' }
}

export function routeToHash(route: Route): string {
  switch (route.view) {
    case 'operation':
      return `#/operation/${encodeURIComponent(route.id)}`
    case 'schema':
      return `#/schema/${encodeURIComponent(route.name)}`
    case 'playground':
      return route.id ? `#/playground/${encodeURIComponent(route.id)}` : '#/playground'
    case 'changelog':
      return route.from ? `#/changelog/${encodeURIComponent(route.from)}` : '#/changelog'
    default:
      return '#/'
  }
}

export function useHashRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const navigate = useCallback((next: Route) => {
    const hash = routeToHash(next)
    if (window.location.hash !== hash) window.location.hash = hash
    else setRoute(next)
  }, [])
  return [route, navigate]
}
