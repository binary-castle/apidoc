import type { JsonObject, OpenAPIDocument, SchemaObject } from './types'

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Decode one JSON Pointer segment (RFC 6901), e.g. "a~1b" -> "a/b". */
const decodeSegment = (segment: string) => decodeURIComponent(segment).replace(/~1/g, '/').replace(/~0/g, '~')

export const refName = (ref: string) => decodeSegment(ref.slice(ref.lastIndexOf('/') + 1))

/** Look up a local "#/..." pointer. External refs are not supported and return undefined. */
export function lookupPointer(document: unknown, ref: string): unknown {
  if (!ref.startsWith('#')) return undefined
  const segments = ref.slice(1).split('/').filter(Boolean).map(decodeSegment)
  let current: unknown = document
  for (const segment of segments) {
    if (!isObject(current) && !Array.isArray(current)) return undefined
    current = (current as JsonObject)[segment]
  }
  return current
}

export interface Resolved<T> {
  value: T
  /** The last $ref followed, if any. */
  ref?: string
  /** Name of the referenced component, e.g. "Customer". */
  name?: string
}

/**
 * Follow $ref chains lazily. We never fully dereference a document: recursive
 * schemas stay finite and the UI can still show "Customer" instead of an
 * anonymous inlined object.
 */
export class Resolver {
  constructor(readonly document: OpenAPIDocument) {}

  resolve<T = JsonObject>(value: T | { $ref: string } | undefined): Resolved<T | undefined> {
    let current: unknown = value
    let ref: string | undefined
    const seen = new Set<string>()
    while (isObject(current) && typeof current.$ref === 'string') {
      if (seen.has(current.$ref)) break
      seen.add(current.$ref)
      ref = current.$ref
      const target = lookupPointer(this.document, ref)
      if (target === undefined) return { value: undefined, ref, name: refName(ref) }
      // OpenAPI 3.1 allows siblings next to $ref (description, etc.); keep them on top.
      const { $ref: _ignored, ...siblings } = current
      current = Object.keys(siblings).length && isObject(target) ? { ...target, ...siblings } : target
    }
    return { value: current as T | undefined, ref, name: ref ? refName(ref) : undefined }
  }

  schema(schema: SchemaObject | undefined): Resolved<SchemaObject | undefined> {
    return this.resolve<SchemaObject>(schema)
  }
}
