import { describe, expect, it } from 'vitest'
import { accentTokens, contrastRatio, parseColor, toHex } from '../src'

const hex = (value: string) => toHex(parseColor(value)!)

describe('parseColor', () => {
  it('reads hex, rgb, hsl and oklch', () => {
    expect(hex('#0af')).toBe('#00aaff')
    expect(hex('#8B7CFF')).toBe('#8b7cff')
    expect(hex('rgb(139, 124, 255)')).toBe('#8b7cff')
    expect(hex('rgb(139 124 255 / 50%)')).toBe('#8b7cff')
    expect(hex('hsl(0, 100%, 50%)')).toBe('#ff0000')
    expect(hex('hsl(120 100% 25%)')).toBe('#008000')
    expect(hex('oklch(0.628 0.2577 29.23)')).toBe('#ff0000')
    expect(hex('oklch(100% 0 0)')).toBe('#ffffff')
  })

  it('rejects what it does not understand', () => {
    for (const value of ['', 'tomato', '#12', 'rgb(1,2)', 'var(--x)', 'url(x)']) expect(parseColor(value), value).toBeUndefined()
  })
})

describe('contrastRatio', () => {
  it('matches WCAG', () => {
    expect(contrastRatio(parseColor('#000')!, parseColor('#fff')!)).toBeCloseTo(21)
    expect(contrastRatio(parseColor('#777')!, parseColor('#fff')!)).toBeCloseTo(4.48, 1)
  })
})

describe('accentTokens', () => {
  const backgrounds = { dark: parseColor('#0b0b0f')!, light: parseColor('#ffffff')! }
  const brands = ['#8b7cff', '#ff5a1f', '#ffd400', '#0a1f44', '#00c2a8', '#e11d48', '#000000', '#ffffff', '#777777', 'oklch(0.7 0.4 145)']

  it('keeps text readable and buttons legible for any brand colour', () => {
    for (const brand of brands) {
      for (const theme of ['dark', 'light'] as const) {
        const tokens = accentTokens(brand, theme)!
        const at = (name: string) => parseColor(tokens[name]!)!
        const label = `${brand} ${theme}`
        expect(contrastRatio(at('--ad-accent-text'), backgrounds[theme]), label).toBeGreaterThanOrEqual(theme === 'dark' ? 7 : 5)
        expect(contrastRatio(at('--ad-on-accent'), at('--ad-accent')), label).toBeGreaterThanOrEqual(4.5)
        // Soft fills stay close to the background so text on them keeps its contrast.
        expect(contrastRatio(at('--ad-accent-soft'), backgrounds[theme]), label).toBeLessThan(1.5)
      }
    }
  })

  it('stays close to the built-in palette for the default purple', () => {
    const dark = accentTokens('#8b7cff', 'dark')!
    expect(dark['--ad-accent']).toBe('#8b7cff')
    expect(dark['--ad-on-accent']).toBe('#0b0b0f')
    const light = accentTokens('#8b7cff', 'light')!
    expect(light['--ad-on-accent']).toBe('#ffffff')
  })

  it('keeps the hue', () => {
    const orange = accentTokens('#ff5a1f', 'light')!
    const [r, g, b] = parseColor(orange['--ad-accent']!)!
    expect(r).toBeGreaterThan(g)
    expect(g).toBeGreaterThan(b)
  })

  it('returns undefined for unparseable colours', () => {
    expect(accentTokens('papayawhip', 'dark')).toBeUndefined()
  })
})
