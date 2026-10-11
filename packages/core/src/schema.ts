import type { Resolver } from './refs'
import type { SchemaObject } from './types'

/** Non-null types of a schema across OpenAPI 3.0 (`nullable`) and 3.1 (`type: [..., "null"]`). */
export function schemaTypes(schema: SchemaObject | undefined): string[] {
  if (!schema) return []
  if (Array.isArray(schema.type)) return schema.type.filter(t => t !== 'null')
  if (typeof schema.type === 'string') return schema.type === 'null' ? [] : [schema.type]
  if (schema.properties || schema.additionalProperties) return ['object']
  if (schema.items) return ['array']
  return []
}

export function isNullable(schema: SchemaObject | undefined): boolean {
  if (!schema) return false
  if (schema.nullable) return true
  if (Array.isArray(schema.type) && schema.type.includes('null')) return true
  return [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])].some(s => s.type === 'null')
}

/** Flatten allOf (recursively) into one schema so properties and `required` merge. */
export function mergeAllOf(schema: SchemaObject | undefined, resolver: Resolver, depth = 0): SchemaObject | undefined {
  const resolved = resolver.schema(schema).value
  if (!resolved?.allOf || depth > 10) return resolved
  const { allOf, ...base } = resolved
  const merged: SchemaObject = { ...base, properties: { ...(base.properties ?? {}) }, required: [...(base.required ?? [])] }
  for (const part of allOf) {
    const flat = mergeAllOf(part, resolver, depth + 1)
    if (!flat) continue
    const { properties, required, ...rest } = flat
    for (const [key, value] of Object.entries(rest)) {
      if (!(key in merged) || merged[key as keyof SchemaObject] === undefined) (merged as Record<string, unknown>)[key] = value
    }
    Object.assign(merged.properties!, properties)
    merged.required!.push(...(required ?? []))
  }
  if (!Object.keys(merged.properties!).length) delete merged.properties
  if (!merged.required!.length) delete merged.required
  return merged
}

export interface PropertyInfo {
  name: string
  schema: SchemaObject | undefined
  required: boolean
}

/** Properties of an object schema, with allOf merged and `required` applied. */
export function objectProperties(schema: SchemaObject | undefined, resolver: Resolver): PropertyInfo[] {
  const merged = mergeAllOf(schema, resolver)
  if (!merged?.properties) return []
  const required = new Set(merged.required ?? [])
  return Object.entries(merged.properties).map(([name, propertySchema]) => ({ name, schema: propertySchema, required: required.has(name) }))
}

export interface TypeLabel {
  /** e.g. "string", "array", "object", "integer" */
  base: string
  /** e.g. "email", "uuid", "int64" */
  format?: string
  /** Name of the referenced component for objects/arrays of objects. */
  refName?: string
  nullable: boolean
  /** Human label, e.g. "array<Address>", "string · email", "map<string, integer>" */
  label: string
}

export function typeLabel(schema: SchemaObject | undefined, resolver: Resolver): TypeLabel {
  const { value: resolved, name: refName } = resolver.schema(schema)
  const nullable = isNullable(resolved)
  if (!resolved) return { base: 'any', nullable, refName, label: refName ?? 'any' }

  const variants = resolved.oneOf ?? resolved.anyOf
  if (variants?.length) {
    const nonNull = variants.filter(v => v.type !== 'null')
    if (nonNull.length === 1) {
      const inner = typeLabel(nonNull[0], resolver)
      return { ...inner, nullable: true }
    }
    const kind = resolved.oneOf ? 'oneOf' : 'anyOf'
    return { base: kind, nullable, refName, label: refName ?? nonNull.map(v => typeLabel(v, resolver).label).join(' | ') }
  }

  const merged = resolved.allOf ? mergeAllOf(resolved, resolver) ?? resolved : resolved
  const types = schemaTypes(merged)
  const inferred = merged.const !== undefined ? merged.const : merged.enum?.find(v => v !== null)
  const base = types.length > 1 ? types.join(' | ') : types[0] ?? (inferred !== undefined ? (inferred === null ? 'null' : typeof inferred) : 'any')
  if (base === 'array') {
    const item = typeLabel(merged.items, resolver)
    return { base, nullable, refName, label: `array<${item.refName ?? item.label}>` }
  }
  if (base === 'object' && !merged.properties && merged.additionalProperties && typeof merged.additionalProperties === 'object') {
    const value = typeLabel(merged.additionalProperties, resolver)
    return { base, nullable, refName, label: `map<string, ${value.refName ?? value.label}>` }
  }
  const format = merged.format
  return { base, format, nullable, refName, label: format ? `${base} · ${format}` : base }
}

/** Short constraint hints shown next to a field, e.g. ["≤ 256 chars", "≥ 1"]. */
export function constraintHints(schema: SchemaObject | undefined): string[] {
  if (!schema) return []
  const hints: string[] = []
  if (schema.minLength !== undefined && schema.maxLength !== undefined) hints.push(`${schema.minLength}–${schema.maxLength} chars`)
  else if (schema.maxLength !== undefined) hints.push(`≤ ${schema.maxLength} chars`)
  else if (schema.minLength) hints.push(`≥ ${schema.minLength} chars`)
  const min = typeof schema.exclusiveMinimum === 'number' ? `> ${schema.exclusiveMinimum}` : schema.minimum !== undefined ? `${schema.exclusiveMinimum === true ? '>' : '≥'} ${schema.minimum}` : undefined
  const max = typeof schema.exclusiveMaximum === 'number' ? `< ${schema.exclusiveMaximum}` : schema.maximum !== undefined ? `${schema.exclusiveMaximum === true ? '<' : '≤'} ${schema.maximum}` : undefined
  if (min) hints.push(min)
  if (max) hints.push(max)
  if (schema.minItems !== undefined) hints.push(`≥ ${schema.minItems} items`)
  if (schema.maxItems !== undefined) hints.push(`≤ ${schema.maxItems} items`)
  if (schema.uniqueItems) hints.push('unique')
  if (schema.pattern) hints.push(`/${schema.pattern}/`)
  return hints
}
