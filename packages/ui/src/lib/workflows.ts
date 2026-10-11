import { parseArazzo, type ArazzoDocument, type SpecSource } from '@apidoc/core'
import { useEffect, useState } from 'react'
import type { LoadState } from './versions'

export interface LoadedArazzo {
  doc: ArazzoDocument
  /** Source text, shown in the "Arazzo" export tab. */
  text: string
  url?: string
}

/** Load the Arazzo document once per source (URL resolved against the spec's URL). */
export function useArazzo(source: string | SpecSource | undefined, specUrl?: string): LoadState<LoadedArazzo> {
  const key = typeof source === 'string' ? source : source && 'url' in source ? source.url : source ? 'inline' : ''
  const [state, setState] = useState<LoadState<LoadedArazzo>>({ status: 'idle' })
  useEffect(() => {
    if (!source) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    const load = async (): Promise<LoadedArazzo> => {
      if (typeof source === 'object' && 'content' in source) {
        const text = typeof source.content === 'string' ? source.content : JSON.stringify(source.content, null, 2)
        return { doc: parseArazzo(source.content), text }
      }
      const raw = typeof source === 'string' ? source : source.url
      const url = new URL(raw, specUrl ? new URL(specUrl, window.location.href) : window.location.href).toString()
      const response = await fetch(url, { headers: { Accept: 'application/yaml, application/json;q=0.9, */*;q=0.5' } })
      if (!response.ok) throw new Error(`Could not fetch ${url}: HTTP ${response.status}`)
      const text = await response.text()
      return { doc: parseArazzo(text), text, url }
    }
    load()
      .then(value => !cancelled && setState({ status: 'ready', value }))
      .catch((error: Error) => !cancelled && setState({ status: 'error', message: error.message }))
    return () => {
      cancelled = true
    }
    // `key` identifies the source; the object itself may be recreated each render.
  }, [key, specUrl])
  return state
}
