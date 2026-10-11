import { accentTokens, parseColor, type ApiModel, type Rgb } from '@apidoc/core'
import type { CSSProperties } from 'react'
import type { Theme } from '../state'

/** A logo URL, or one per theme. Relative URLs resolve against the page. */
export type Logo = string | { light?: string; dark?: string; href?: string; alt?: string }

export interface ResolvedLogo {
  src: string
  alt: string
  href?: string
  background?: string
}

/** The logo to show: the `logo` prop for this theme, else the spec's `info.x-logo`. */
export function resolveLogo(logo: Logo | undefined, theme: Theme, model: ApiModel, specUrl?: string): ResolvedLogo | undefined {
  if (logo) {
    const src = typeof logo === 'string' ? logo : theme === 'dark' ? (logo.dark ?? logo.light) : (logo.light ?? logo.dark)
    if (src) return { src, alt: (typeof logo === 'object' && logo.alt) || model.info.title, href: typeof logo === 'object' ? logo.href : undefined }
  }
  const fromSpec = model.info.logo
  if (!fromSpec) return undefined
  let src = fromSpec.url
  try {
    // Paths in the spec are relative to the spec, not the page.
    src = new URL(fromSpec.url, specUrl ? new URL(specUrl, document.baseURI) : document.baseURI).toString()
  } catch {
    // Keep it as written.
  }
  return { src, alt: fromSpec.altText ?? model.info.title, href: fromSpec.href, background: fromSpec.backgroundColor }
}

/** Any CSS colour → sRGB, using the browser to understand names and other syntaxes. */
function toRgb(color: string): Rgb | undefined {
  const parsed = parseColor(color)
  if (parsed) return parsed
  try {
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return undefined
    // Two sentinels: an invalid colour leaves fillStyle unchanged, so they would differ.
    const read = (sentinel: string) => {
      context.fillStyle = sentinel
      context.fillStyle = color
      return String(context.fillStyle)
    }
    const a = read('#000000')
    return a === read('#ffffff') ? parseColor(a) : undefined
  } catch {
    return undefined
  }
}

/** Inline custom properties overriding the accent tokens for this theme. */
export function accentStyle(accent: string | undefined, theme: Theme): CSSProperties | undefined {
  if (!accent) return undefined
  const rgb = toRgb(accent)
  const tokens = rgb && accentTokens(rgb, theme)
  if (!tokens) {
    console.warn(`apidoc: "${accent}" is not a colour apidoc understands; using the default accent.`)
    return undefined
  }
  return tokens as CSSProperties
}
