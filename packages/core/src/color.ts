/**
 * Brand colours: derive the UI's accent tokens for a theme from one colour.
 * Lightness is adjusted in OKLCH (perceptually even), chroma is reduced when
 * a colour falls outside sRGB, and text colours are pushed until they meet a
 * WCAG contrast floor against the page background, so any brand colour
 * produces readable links and labels in both themes.
 */

export type Rgb = [number, number, number]
type Oklch = [number, number, number]

const BACKGROUND = { dark: '#0b0b0f', light: '#ffffff' } as const

/** Parse #rgb, #rrggbb, rgb()/rgba(), hsl()/hsla() and oklch(); undefined for anything else. */
export function parseColor(input: string): Rgb | undefined {
  const value = input.trim().toLowerCase()
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (hex) {
    const digits = hex[1]!.length === 3 ? [...hex[1]!].map(d => d + d).join('') : hex[1]!
    return [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16) / 255) as Rgb
  }
  const fn = value.match(/^(rgba?|hsla?|oklch)\(\s*([^)]*)\)$/)
  if (!fn) return undefined
  const parts = fn[2]!.split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return undefined
  const num = (part: string, percentOf = 1) => (part.endsWith('%') ? (parseFloat(part) / 100) * percentOf : parseFloat(part))
  let rgb: Rgb
  if (fn[1]!.startsWith('rgb')) {
    rgb = parts.slice(0, 3).map(p => num(p, 255) / 255) as Rgb
  } else if (fn[1]!.startsWith('hsl')) {
    rgb = hslToRgb(parseFloat(parts[0]!), num(parts[1]!.endsWith('%') ? parts[1]! : `${parts[1]}%`), num(parts[2]!.endsWith('%') ? parts[2]! : `${parts[2]}%`))
  } else {
    rgb = oklchToRgb([num(parts[0]!), num(parts[1]!, 0.4), parseFloat(parts[2]!)])
  }
  return rgb.some(c => Number.isNaN(c)) ? undefined : (rgb.map(clamp01) as Rgb)
}

export function toHex(rgb: Rgb): string {
  return `#${rgb.map(c => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0')).join('')}`
}

/** WCAG 2 contrast ratio, 1–21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * The accent tokens (`--ad-accent`, `--ad-accent-text`, …) for one theme,
 * derived from a brand colour. Undefined when the colour can't be parsed.
 */
export function accentTokens(color: string | Rgb, theme: 'dark' | 'light'): Record<string, string> | undefined {
  const rgb = typeof color === 'string' ? parseColor(color) : color
  if (!rgb) return undefined
  const bg = parseColor(BACKGROUND[theme])!
  const [l, c, h] = rgbToOklch(rgb)
  // Very saturated inputs are tamed; greys stay grey (their chroma is ~0).
  const chroma = Math.min(c, 0.26)
  // Rounded to what toHex will emit, so contrast checks see the final colour.
  const at = (lightness: number, ch = chroma) => parseColor(toHex(inGamut([clamp01(lightness), ch, h])))!
  const dark = theme === 'dark'

  // Light buttons with dark labels on the dark theme, mid-tone buttons with white labels on the light one.
  const ink = parseColor(BACKGROUND.dark)!
  const white: Rgb = [1, 1, 1]
  const [preferred, other] = dark ? [ink, white] : [white, ink]
  // Some mid tones can't carry 4.5:1 with either label colour; step towards the preferred one.
  let accentL = dark ? clamp(l, 0.62, 0.84) : clamp(l, 0.4, 0.56)
  let accent = at(accentL)
  while (contrastRatio(accent, preferred) < 4.5 && contrastRatio(accent, other) < 4.5 && accentL > 0 && accentL < 1) {
    accentL += dark ? 0.01 : -0.01
    accent = at(accentL)
  }
  const hover = at(accentL + (dark ? 0.05 : -0.06))
  const onAccent = contrastRatio(accent, preferred) >= 4.5 ? preferred : other
  const text = readable(dark ? Math.max(l, 0.74) : Math.min(l, 0.56), lightness => at(lightness, Math.min(chroma, 0.2)), bg, dark ? 7 : 5, dark ? 0.01 : -0.01)
  const mix = (amount: number) => toHex(mixOklab(bg, accent, amount))

  return {
    '--ad-accent': toHex(accent),
    '--ad-accent-hover': toHex(hover),
    '--ad-on-accent': toHex(onAccent),
    '--ad-accent-text': toHex(text),
    '--ad-accent-soft': mix(dark ? 0.15 : 0.08),
    '--ad-accent-line': mix(dark ? 0.38 : 0.34),
    '--ad-selected': mix(dark ? 0.07 : 0.06),
    '--ad-selected-line': mix(dark ? 0.22 : 0.2),
    // Object keys in code samples use the accent text colour too.
    '--ad-sx-key': toHex(text),
  }
}

/** Step lightness until the colour reaches `minContrast` against `bg`. */
function readable(start: number, make: (l: number) => Rgb, bg: Rgb, minContrast: number, step: number): Rgb {
  let lightness = start
  let colour = make(lightness)
  for (let i = 0; i < 100 && contrastRatio(colour, bg) < minContrast; i++) {
    lightness += step
    if (lightness <= 0 || lightness >= 1) break
    colour = make(lightness)
  }
  return colour
}

/** The closest sRGB colour with the same lightness and hue (chroma reduced). */
function inGamut([l, c, h]: Oklch): Rgb {
  const fits = (chroma: number) => oklchToRgb([l, chroma, h]).every(v => v >= -1e-4 && v <= 1 + 1e-4)
  if (fits(c)) return oklchToRgb([l, c, h]).map(clamp01) as Rgb
  let [lo, hi] = [0, c]
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (fits(mid)) lo = mid
    else hi = mid
  }
  return oklchToRgb([l, lo, h]).map(clamp01) as Rgb
}

function mixOklab(a: Rgb, b: Rgb, amount: number): Rgb {
  const [la, aa, ba] = rgbToOklab(a)
  const [lb, ab, bb] = rgbToOklab(b)
  return oklabToRgb([la + (lb - la) * amount, aa + (ab - aa) * amount, ba + (bb - ba) * amount]).map(clamp01) as Rgb
}

// --- colour space conversions (sRGB ↔ linear ↔ OKLab ↔ OKLCH) ---------------

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLinear = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.sign(c) * Math.abs(c) ** (1 / 2.4) - 0.055)

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(toLinear) as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function rgbToOklab(rgb: Rgb): Rgb {
  const [r, g, b] = rgb.map(toLinear) as Rgb
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

function oklabToRgb([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

function rgbToOklch(rgb: Rgb): Oklch {
  const [l, a, b] = rgbToOklab(rgb)
  return [l, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360]
}

function oklchToRgb([l, c, h]: Oklch): Rgb {
  const rad = (h * Math.PI) / 180
  return oklabToRgb([l, c * Math.cos(rad), c * Math.sin(rad)])
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0), f(8), f(4)]
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const clamp01 = (value: number) => clamp(value, 0, 1)
