import { ApiDocsElement } from './element'

export { ApiDocsElement }

/** Register the element under a tag name (default "api-docs"). Safe to call twice. */
export function define(tagName = 'api-docs') {
  if (!customElements.get(tagName)) customElements.define(tagName, class extends ApiDocsElement {})
}

define()
