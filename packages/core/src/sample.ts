import type { Resolver } from './refs'
import { mergeAllOf, schemaTypes } from './schema'
import type { MediaTypeModel, SchemaObject } from './types'

export type SampleMode = 'request' | 'response'

const STRING_FORMATS: Record<string, string> = {
  email: 'ada@example.com',
  uuid: '3f2b8c1e-7d4a-4f0e-9b6a-2c5d8e1f4a7b',
  'date-time': '2026-01-15T09:30:00Z',
  date: '2026-01-15',
  time: '09:30:00',
  uri: 'https://example.com',
  url: 'https://example.com',
  hostname: 'example.com',
  ipv4: '192.168.0.1',
  ipv6: '2001:db8::1',
  byte: 'aGVsbG8=',
  binary: '<binary>',
  password: '••••••••',
  duration: 'P1D',
}

/** Realistic values for common property names when the schema gives no hints. */
const NAME_HINTS: [RegExp, unknown][] = [
  [/^e?mail$|_email$|email_address/i, 'ada@example.com'],
  [/^(first_?name)$/i, 'Ada'],
  [/^(last_?name|surname)$/i, 'Lovelace'],
  [/^(full_?)?name$|username/i, 'Ada Lovelace'],
  [/phone/i, '+44 20 7946 0958'],
  [/^(country|country_code)$/i, 'GB'],
  [/currency/i, 'gbp'],
  [/city/i, 'London'],
  [/^(line1|address_?line_?1|street)$/i, "12 St James's Sq"],
  [/postal|zip/i, 'SW1Y 4LB'],
  [/url|website|link/i, 'https://example.com'],
  [/slug/i, 'my-item'],
  [/title/i, 'Example title'],
  [/description|summary|notes?$/i, 'A short description.'],
]

interface Context {
  resolver: Resolver
  mode: SampleMode
  seen: string[]
  depth: number
}

function pick(schema: SchemaObject): { found: boolean; value?: unknown } {
  if (schema.example !== undefined) return { found: true, value: schema.example }
  if (Array.isArray(schema.examples) && schema.examples.length) return { found: true, value: schema.examples[0] }
  if (schema.const !== undefined) return { found: true, value: schema.const }
  if (schema.default !== undefined) return { found: true, value: schema.default }
  if (Array.isArray(schema.enum) && schema.enum.length) return { found: true, value: schema.enum.find(v => v !== null) ?? schema.enum[0] }
  return { found: false }
}

function sample(schemaOrRef: SchemaObject | undefined, ctx: Context, propertyName?: string): unknown {
  const { value: resolved, ref } = ctx.resolver.schema(schemaOrRef)
  if (!resolved) return null
  // Recursive schemas (e.g. Category.children: Category[]) stop at the first repeat:
  // the property is dropped and arrays come out empty.
  if ((ref && ctx.seen.includes(ref)) || ctx.depth > 8) return undefined
  const next: Context = { ...ctx, depth: ctx.depth + 1, seen: ref ? [...ctx.seen, ref] : ctx.seen }

  const direct = pick(resolved)
  if (direct.found) return direct.value

  if (resolved.allOf) return sample(mergeAllOf(resolved, ctx.resolver), next, propertyName)
  const variant = (resolved.oneOf ?? resolved.anyOf)?.find(v => v.type !== 'null')
  if (variant) return sample(variant, next, propertyName)

  const type = schemaTypes(resolved)[0]
  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {}
      for (const [name, property] of Object.entries(resolved.properties ?? {})) {
        const prop = ctx.resolver.schema(property).value
        if (ctx.mode === 'request' && prop?.readOnly) continue
        if (ctx.mode === 'response' && prop?.writeOnly) continue
        const value = sample(property, next, name)
        if (value !== undefined) out[name] = value
      }
      if (!resolved.properties && resolved.additionalProperties) {
        const value = typeof resolved.additionalProperties === 'object' ? sample(resolved.additionalProperties, next) : 'string'
        out.key = value
      }
      return out
    }
    case 'array': {
      const item = sample(resolved.items, next, propertyName)
      return item === undefined ? [] : [item]
    }
    case 'integer':
    case 'number': {
      if (typeof resolved.minimum === 'number') return resolved.minimum
      if (typeof resolved.exclusiveMinimum === 'number') return resolved.exclusiveMinimum + 1
      if (propertyName && /^id$|_id$/i.test(propertyName)) return 1
      return type === 'integer' ? 0 : 0.0
    }
    case 'boolean':
      return true
    case 'string': {
      if (resolved.format && resolved.format in STRING_FORMATS) return STRING_FORMATS[resolved.format]
      if (propertyName) {
        const hint = NAME_HINTS.find(([pattern]) => pattern.test(propertyName))
        if (hint) return hint[1]
      }
      const min = resolved.minLength ?? 0
      return min > 6 ? 'x'.repeat(min) : 'string'
    }
    case 'null':
      return null
    default:
      return resolved.properties ? sample({ ...resolved, type: 'object' }, next, propertyName) : null
  }
}

/** Generate an example value for a schema. Request mode skips readOnly fields; response mode skips writeOnly. */
export function sampleFromSchema(schema: SchemaObject | undefined, resolver: Resolver, mode: SampleMode = 'response'): unknown {
  return sample(schema, { resolver, mode, seen: [], depth: 0 })
}

/** Prefer explicit examples from the spec; fall back to a generated one. */
export function exampleForMedia(media: MediaTypeModel | undefined, resolver: Resolver, mode: SampleMode): unknown {
  if (!media) return undefined
  if (media.example !== undefined) return media.example
  if (media.examples[0]) return media.examples[0].value
  return sampleFromSchema(media.schema, resolver, mode)
}
