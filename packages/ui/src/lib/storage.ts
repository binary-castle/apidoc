/**
 * Browser storage can throw (private mode, blocked site data, sandboxed
 * iframes), so every access is guarded and falls back to the default.
 */
type Area = 'local' | 'session'

const area = (which: Area): Storage | undefined => {
  try {
    return which === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return undefined
  }
}

export function readStored<T>(key: string, fallback: T, which: Area = 'local'): T {
  try {
    const raw = area(which)?.getItem(`apidoc:${key}`)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function writeStored(key: string, value: unknown, which: Area = 'local') {
  try {
    area(which)?.setItem(`apidoc:${key}`, JSON.stringify(value))
  } catch {
    // Quota exceeded or storage disabled: the feature just won't persist.
  }
}
