import MiniSearch from 'minisearch'
import { Resolver } from './refs'
import { objectProperties, schemaTypes, typeLabel } from './schema'
import type { ApiModel, HttpMethod, SchemaObject } from './types'

export type SearchKind = 'operation' | 'schema' | 'field'

export interface SearchHit {
  id: string
  kind: SearchKind
  title: string
  /** Secondary line: path for operations, type for fields. */
  subtitle: string
  method?: HttpMethod
  operationId?: string
  schemaName?: string
  score: number
}

interface SearchDocument {
  id: string
  kind: SearchKind
  title: string
  subtitle: string
  path: string
  text: string
  method?: HttpMethod
  operationId?: string
  schemaName?: string
}

export interface SearchIndex {
  search(query: string, options?: { kinds?: SearchKind[]; limit?: number }): SearchHit[]
  size: number
}

/** Collect "Schema.field" and "Schema.nested.field" entries, two levels deep. */
function collectFields(resolver: Resolver, schemaName: string, schema: SchemaObject, prefix: string, depth: number, out: SearchDocument[]) {
  for (const property of objectProperties(schema, resolver)) {
    const path = `${prefix}.${property.name}`
    const resolved = resolver.schema(property.schema)
    out.push({
      id: `field:${schemaName}:${path}`,
      kind: 'field',
      title: path,
      subtitle: typeLabel(property.schema, resolver).label,
      path: property.name,
      text: resolved.value?.description ?? '',
      schemaName,
    })
    // Recurse into inline objects (and arrays of them) only; referenced
    // schemas are indexed under their own name.
    let nested = resolved.ref ? undefined : resolved.value
    if (nested && schemaTypes(nested).includes('array')) {
      const items = resolver.schema(nested.items)
      nested = items.ref ? undefined : items.value
    }
    if (depth < 2 && nested && schemaTypes(nested).includes('object')) {
      collectFields(resolver, schemaName, nested, path, depth + 1, out)
    }
  }
}

export function buildSearchIndex(model: ApiModel): SearchIndex {
  const resolver = new Resolver(model.document)
  const documents: SearchDocument[] = []

  for (const operation of model.operations) {
    documents.push({
      id: `operation:${operation.id}`,
      kind: 'operation',
      title: operation.summary ?? operation.operationId ?? `${operation.method.toUpperCase()} ${operation.path}`,
      subtitle: operation.path,
      path: `${operation.path} ${operation.operationId ?? ''} ${operation.tags.join(' ')}`,
      text: operation.description ?? '',
      method: operation.method,
      operationId: operation.id,
    })
  }
  for (const entry of model.schemas) {
    documents.push({
      id: `schema:${entry.name}`,
      kind: 'schema',
      title: entry.name,
      subtitle: typeLabel(entry.schema, resolver).label,
      path: entry.name,
      text: entry.schema.description ?? '',
      schemaName: entry.name,
    })
    collectFields(resolver, entry.name, entry.schema, entry.name, 0, documents)
  }

  const index = new MiniSearch<SearchDocument>({
    fields: ['title', 'path', 'text'],
    storeFields: ['kind', 'title', 'subtitle', 'method', 'operationId', 'schemaName'],
    // Split "customer_email" and "/v2/customers/{id}" into searchable words.
    tokenize: text => text.split(/[\s/{}._\-:,]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean),
    searchOptions: {
      boost: { title: 3, path: 2 },
      prefix: true,
      fuzzy: term => (term.length > 3 ? 0.2 : 0),
      combineWith: 'AND',
    },
  })
  index.addAll(documents)

  const kindWeight: Record<SearchKind, number> = { operation: 1.4, schema: 1.1, field: 1 }

  return {
    size: documents.length,
    search(query, options = {}) {
      const trimmed = query.trim()
      if (!trimmed) return []
      const kinds = options.kinds
      return index
        .search(trimmed, kinds ? { filter: result => kinds.includes(result.kind as SearchKind) } : undefined)
        .map(result => ({
          id: result.id as string,
          kind: result.kind as SearchKind,
          title: result.title as string,
          subtitle: result.subtitle as string,
          method: result.method as HttpMethod | undefined,
          operationId: result.operationId as string | undefined,
          schemaName: result.schemaName as string | undefined,
          score: result.score * kindWeight[result.kind as SearchKind],
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, options.limit ?? 50)
    },
  }
}
