import { diffSpecs, loadSpec, type ApiModel, type OperationChangeStatus, type SpecDiff } from '@apidoc/core'
import { useEffect, useMemo, useState } from 'react'

/** An older release of the API. The loaded spec is always the newest. */
export interface ApiVersion {
  version: string
  url: string
  /** ISO date, shown in the releases list. */
  date?: string
  label?: string
}

const cache = new Map<string, Promise<ApiModel>>()

/**
 * Load (once) the spec of an older release. Relative URLs resolve against the
 * page, like any HTML attribute (document.baseURI also covers shadow roots).
 */
export function loadVersion(url: string): Promise<ApiModel> {
  let absolute = url
  try {
    absolute = new URL(url, document.baseURI).toString()
  } catch {
    // Keep the original string; loadSpec reports the problem.
  }
  let pending = cache.get(absolute)
  if (!pending) {
    pending = loadSpec({ url: absolute })
    pending.catch(() => cache.delete(absolute))
    cache.set(absolute, pending)
  }
  return pending
}

export type LoadState<T> = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error'; message: string }

/** Diff of the previous release against the current spec, for NEW/CHANGED badges. */
export function usePreviousDiff(model: ApiModel, versions: ApiVersion[]): SpecDiff | undefined {
  const previous = versions[0]
  const [diff, setDiff] = useState<SpecDiff>()
  useEffect(() => {
    if (!previous) return
    let cancelled = false
    loadVersion(previous.url)
      .then(older => {
        if (!cancelled) setDiff(diffSpecs(older, model))
      })
      .catch(() => {
        // Badges are a nicety; the changelog page shows the load error.
      })
    return () => {
      cancelled = true
    }
  }, [previous, model])
  return diff
}

/** Operation id → how it changed in the latest release. */
export function useOperationChanges(diff: SpecDiff | undefined) {
  return useMemo(() => {
    const map = new Map<string, OperationChangeStatus>()
    for (const op of diff?.operations ?? []) if (op.operationId) map.set(op.operationId, op.status)
    return map
  }, [diff])
}
