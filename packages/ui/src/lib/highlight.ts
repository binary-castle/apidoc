import type { HighlighterCore, ThemeRegistration } from 'shiki/core'
import { useEffect, useState } from 'react'

/**
 * Colours are CSS variables, so one highlighted result serves both themes and
 * hosts can restyle code without re-highlighting.
 */
const theme: ThemeRegistration = {
  name: 'ad-syntax',
  type: 'dark',
  colors: { 'editor.foreground': 'var(--ad-sx-text)', 'editor.background': 'transparent' },
  tokenColors: [
    { settings: { foreground: 'var(--ad-sx-text)' } },
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: 'var(--ad-sx-comment)' } },
    { scope: ['punctuation', 'meta.brace', 'keyword.operator'], settings: { foreground: 'var(--ad-sx-punct)' } },
    { scope: ['string', 'string.quoted', 'string.unquoted', 'string.interpolated', 'punctuation.definition.string'], settings: { foreground: 'var(--ad-sx-string)' } },
    { scope: ['support.type.property-name', 'support.type.property-name.json', 'punctuation.support.type.property-name', 'entity.name.tag', 'meta.object-literal.key', 'variable.other.property', 'entity.other.attribute-name'], settings: { foreground: 'var(--ad-sx-key)' } },
    { scope: ['constant.numeric', 'constant.other.color'], settings: { foreground: 'var(--ad-sx-number)' } },
    { scope: ['constant.language', 'keyword', 'storage', 'storage.type', 'storage.modifier', 'keyword.control', 'variable.language'], settings: { foreground: 'var(--ad-sx-keyword)' } },
    { scope: ['entity.name.function', 'support.function', 'meta.function-call', 'constant.other.option', 'entity.name.command', 'support.function.builtin'], settings: { foreground: 'var(--ad-sx-function)' } },
  ],
}

/** 'text' (and raw HTTP) render without highlighting; the HTTP grammar alone is ~590 KB. */
export type CodeLanguage = 'json' | 'shellscript' | 'javascript' | 'python' | 'go' | 'yaml' | 'text'

const PLAIN: ReadonlySet<string> = new Set(['text', 'http'])

let highlighter: Promise<HighlighterCore> | undefined

/** Load the highlighter on first use; it stays out of the initial bundle. */
function getHighlighter() {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ])
    return createHighlighterCore({
      themes: [theme],
      langs: [
        import('shiki/langs/json.mjs'),
        import('shiki/langs/shellscript.mjs'),
        import('shiki/langs/javascript.mjs'),
        import('shiki/langs/python.mjs'),
        import('shiki/langs/go.mjs'),
        import('shiki/langs/yaml.mjs'),
      ],
      engine: createJavaScriptRegexEngine(),
    })
  })()
  return highlighter
}

/** Returns highlighted HTML, or undefined until the highlighter is ready (render plain text meanwhile). */
export function useHighlighted(code: string, language: CodeLanguage | 'http'): string | undefined {
  const [html, setHtml] = useState<{ key: string; html: string }>()
  const key = `${language}\u0000${code}`
  useEffect(() => {
    if (PLAIN.has(language)) return
    let cancelled = false
    getHighlighter()
      .then(h => {
        if (!cancelled) setHtml({ key, html: h.codeToHtml(code, { lang: language, theme: 'ad-syntax' }) })
      })
      .catch(() => {
        // Unknown grammar or load failure: keep showing plain text.
      })
    return () => {
      cancelled = true
    }
  }, [key, code, language])
  return html?.key === key ? html.html : undefined
}
