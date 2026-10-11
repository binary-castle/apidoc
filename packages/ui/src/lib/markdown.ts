import DOMPurify from 'dompurify'
import { marked } from 'marked'

const cache = new Map<string, string>()

/**
 * Spec descriptions are CommonMark and come from whoever wrote the spec, so
 * the HTML is always sanitized before it reaches the DOM.
 */
export function renderMarkdown(source: string): string {
  const cached = cache.get(source)
  if (cached !== undefined) return cached
  const html = DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true, breaks: false }), {
    ADD_ATTR: ['target', 'rel'],
  })
  if (cache.size > 500) cache.clear()
  cache.set(source, html)
  return html
}
