import type { Resolver } from './refs'
import { isNullable, mergeAllOf, schemaTypes } from './schema'
import type { SampleMode } from './sample'
import type { SchemaObject } from './types'

/**
 * A small JSON Schema validator for OpenAPI 3.0 and 3.1 schemas.
 *
 * Interpreted, not compiled: no `new Function`, so it runs under a strict
 * Content-Security-Policy. It also reports what plain JSON Schema allows
 * silently but a contract check cares about: fields the API returns that
 * the spec never documents.
 */

export type IssueSeverity = 'error' | 'warning'

export type IssueKind =
  | 'type'
  | 'null'
  | 'required'
  | 'enum'
  | 'const'
  | 'format'
  | 'range'
  | 'length'
  | 'pattern'
  | 'items'
  | 'additional-property'
  | 'undocumented-field'
  | 'no-match'
  | 'not'
  | 'undocumented-status'
  | 'content-type'
  | 'unexpected-body'
  | 'missing-body'
  | 'invalid-json'

export interface ContractIssue {
  severity: IssueSeverity
  kind: IssueKind
  /** JSONPath of the offending value, e.g. "$.address.country". */
  path: string
  message: string
  /** Named schema that owns the field, for undocumented fields (e.g. "Customer"). */
  schemaName?: string
  /** The offending value (undocumented fields keep it to suggest a schema). */
  value?: unknown
}

export interface ValidationResult {
  issues: ContractIssue[]
  /** How many values were checked against a schema. */
  checked: number
}

interface Context {
  resolver: Resolver
  mode: SampleMode
  issues: ContractIssue[]
  checked: number
}

const MAX_DEPTH = 64

const jsonType = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

const childPath = (path: string, key: string | number) =>
  typeof key === 'number' ? `${path}[${key}]` : /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`

const preview = (value: unknown) => {
  const text = JSON.stringify(value)
  return text === undefined ? String(value) : text.length > 40 ? `${text.slice(0, 37)}…` : text
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((v, i) => deepEqual(v, (b as unknown[])[i]))
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  return ka.length === kb.length && ka.every(k => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

const FORMATS: Record<string, (value: string) => boolean> = {
  'date-time': v => /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:?\d{2})$/.test(v) && !Number.isNaN(Date.parse(v)),
  date: v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)),
  time: v => /^\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:?\d{2})?$/.test(v),
  email: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  uuid: v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  uri: v => {
    try {
      new URL(v)
      return true
    } catch {
      return false
    }
  },
  ipv4: v => /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(v),
  ipv6: v => v.includes(':') && /^[0-9a-f:.]+$/i.test(v),
  byte: v => /^[A-Za-z0-9+/]*={0,2}$/.test(v) && v.length % 4 === 0,
}

function report(ctx: Context, issue: ContractIssue) {
  ctx.issues.push(issue)
}

/** Validate in a scratch context (for anyOf/oneOf branches). */
function trial(value: unknown, schema: SchemaObject, path: string, ctx: Context, owner: string | undefined, depth: number) {
  const scratch: Context = { ...ctx, issues: [], checked: 0 }
  walk(value, schema, path, scratch, owner, depth, false)
  return { issues: scratch.issues, checked: scratch.checked, errors: scratch.issues.filter(i => i.severity === 'error').length }
}

function walk(value: unknown, schemaOrRef: SchemaObject | boolean | undefined, path: string, ctx: Context, owner: string | undefined, depth: number, skipExtra: boolean) {
  if (schemaOrRef === undefined || schemaOrRef === true || depth > MAX_DEPTH) return
  if (schemaOrRef === false) {
    report(ctx, { severity: 'error', kind: 'type', path, message: 'No value is allowed here' })
    return
  }
  const { value: schema, name } = ctx.resolver.schema(schemaOrRef)
  if (!schema) return
  ctx.checked++
  const schemaName = name ?? owner

  // allOf: every part applies; the "undocumented field" check runs once on the merged object below.
  if (schema.allOf) {
    for (const part of schema.allOf) walk(value, part, path, ctx, schemaName, depth + 1, true)
  }

  // anyOf / oneOf (with discriminator support).
  const variants = schema.oneOf ?? schema.anyOf
  if (variants?.length) {
    const discriminator = schema.discriminator?.propertyName
    const tag = discriminator && value && typeof value === 'object' ? (value as Record<string, unknown>)[discriminator] : undefined
    let candidates = variants
    if (typeof tag === 'string') {
      const mapped = schema.discriminator?.mapping?.[tag]
      const byTag = variants.filter(v => (mapped ? v.$ref === mapped : v.$ref?.endsWith(`/${tag}`)))
      if (byTag.length) candidates = byTag
    }
    const results = candidates.map(variant => trial(value, variant, path, ctx, schemaName, depth + 1))
    const passing = results.filter(r => r.errors === 0)
    if (passing.length) {
      // Keep warnings (e.g. undocumented fields) from the best passing branch.
      const best = passing.reduce((a, b) => (b.checked > a.checked ? b : a))
      ctx.issues.push(...best.issues)
      ctx.checked += best.checked
    } else {
      const best = results.reduce((a, b) => (b.errors < a.errors ? b : a))
      report(ctx, { severity: 'error', kind: 'no-match', path, message: `Matches none of the ${candidates.length} allowed shapes; closest one fails ${best.errors} check${best.errors === 1 ? '' : 's'}` })
      ctx.issues.push(...best.issues)
    }
  }

  if (schema.not && trial(value, schema.not, path, ctx, schemaName, depth + 1).errors === 0) {
    report(ctx, { severity: 'error', kind: 'not', path, message: 'Matches a shape the spec forbids (`not`)' })
  }

  // Type (with 3.0 `nullable` and 3.1 `type: [..., "null"]`).
  const types = schemaTypes(schema)
  const actual = jsonType(value)
  if (value === null) {
    const nullOk = isNullable(schema) || (types.length === 0 && !variants) || schema.enum?.includes(null) || schema.const === null
    if (!nullOk && !variants) report(ctx, { severity: 'error', kind: 'null', path, message: 'Is null, but the spec does not allow null' })
    return
  }
  // schemaTypes() drops "null" (it's for display); a null-only schema accepts nothing else.
  const declared = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (declared.length && declared.every(t => t === 'null')) {
    report(ctx, { severity: 'error', kind: 'type', path, message: `Expected null, got ${actual} ${preview(value)}` })
    return
  }
  if (types.length && !types.includes(actual) && !(actual === 'integer' && types.includes('number'))) {
    report(ctx, { severity: 'error', kind: 'type', path, message: `Expected ${types.join(' or ')}, got ${actual} ${preview(value)}` })
    return
  }

  if (schema.enum && !schema.enum.some(option => deepEqual(option, value))) {
    const options = schema.enum.slice(0, 5).map(preview).join(', ')
    report(ctx, { severity: 'error', kind: 'enum', path, message: `${preview(value)} is not one of ${options}${schema.enum.length > 5 ? ', …' : ''}` })
  }
  if (schema.const !== undefined && !deepEqual(schema.const, value)) {
    report(ctx, { severity: 'error', kind: 'const', path, message: `Expected ${preview(schema.const)}, got ${preview(value)}` })
  }

  if (typeof value === 'string') {
    const length = [...value].length
    if (schema.minLength !== undefined && length < schema.minLength) report(ctx, { severity: 'error', kind: 'length', path, message: `Is ${length} characters, minimum is ${schema.minLength}` })
    if (schema.maxLength !== undefined && length > schema.maxLength) report(ctx, { severity: 'error', kind: 'length', path, message: `Is ${length} characters, maximum is ${schema.maxLength}` })
    if (schema.pattern) {
      let regex: RegExp | undefined
      try {
        regex = new RegExp(schema.pattern, 'u')
      } catch {
        // Patterns using syntax JS doesn't support are skipped rather than failing everything.
      }
      if (regex && !regex.test(value)) report(ctx, { severity: 'error', kind: 'pattern', path, message: `${preview(value)} does not match /${schema.pattern}/` })
    }
    const check = schema.format ? FORMATS[schema.format] : undefined
    // Formats are annotations by default in JSON Schema, so mismatches are warnings.
    if (check && !check(value)) report(ctx, { severity: 'warning', kind: 'format', path, message: `${preview(value)} is not a valid ${schema.format}` })
  }

  if (typeof value === 'number') {
    const exclusiveMin = typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum : schema.exclusiveMinimum === true ? schema.minimum : undefined
    const exclusiveMax = typeof schema.exclusiveMaximum === 'number' ? schema.exclusiveMaximum : schema.exclusiveMaximum === true ? schema.maximum : undefined
    if (exclusiveMin !== undefined && value <= exclusiveMin) report(ctx, { severity: 'error', kind: 'range', path, message: `${value} must be greater than ${exclusiveMin}` })
    else if (schema.minimum !== undefined && schema.exclusiveMinimum !== true && value < schema.minimum) report(ctx, { severity: 'error', kind: 'range', path, message: `${value} is below the minimum ${schema.minimum}` })
    if (exclusiveMax !== undefined && value >= exclusiveMax) report(ctx, { severity: 'error', kind: 'range', path, message: `${value} must be less than ${exclusiveMax}` })
    else if (schema.maximum !== undefined && schema.exclusiveMaximum !== true && value > schema.maximum) report(ctx, { severity: 'error', kind: 'range', path, message: `${value} is above the maximum ${schema.maximum}` })
    const multipleOf = (schema as { multipleOf?: number }).multipleOf
    if (multipleOf && Math.abs(value / multipleOf - Math.round(value / multipleOf)) > 1e-9) report(ctx, { severity: 'error', kind: 'range', path, message: `${value} is not a multiple of ${multipleOf}` })
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) report(ctx, { severity: 'error', kind: 'items', path, message: `Has ${value.length} items, minimum is ${schema.minItems}` })
    if (schema.maxItems !== undefined && value.length > schema.maxItems) report(ctx, { severity: 'error', kind: 'items', path, message: `Has ${value.length} items, maximum is ${schema.maxItems}` })
    if (schema.uniqueItems && value.some((item, i) => value.findIndex(other => deepEqual(other, item)) !== i)) report(ctx, { severity: 'error', kind: 'items', path, message: 'Items must be unique' })
    const prefix = (schema as { prefixItems?: SchemaObject[] }).prefixItems ?? []
    value.forEach((item, index) => walk(item, prefix[index] ?? schema.items, childPath(path, index), ctx, undefined, depth + 1, false))
  }

  if (actual === 'object') {
    const record = value as Record<string, unknown>
    // allOf parts checked their own required/properties above; here only this schema's own.
    const own = schema.properties ?? {}
    for (const field of schema.required ?? []) {
      if (field in record) continue
      const property = ctx.resolver.schema(own[field]).value
      // Response bodies omit writeOnly fields; requests omit readOnly ones.
      if ((ctx.mode === 'response' && property?.writeOnly) || (ctx.mode === 'request' && property?.readOnly)) continue
      report(ctx, { severity: 'error', kind: 'required', path: childPath(path, field), message: `Missing required field "${field}"`, schemaName })
    }
    for (const [key, propertySchema] of Object.entries(own)) {
      if (key in record) walk(record[key], propertySchema, childPath(path, key), ctx, undefined, depth + 1, false)
    }
    if (!skipExtra) {
      // Which fields are documented is decided on the merged (allOf) view.
      const merged = schema.allOf ? mergeAllOf(schema, ctx.resolver) ?? schema : schema
      const properties = merged.properties ?? {}
      const patterns = Object.keys((merged as { patternProperties?: Record<string, unknown> }).patternProperties ?? {}).flatMap(p => {
        try {
          return [new RegExp(p, 'u')]
        } catch {
          return []
        }
      })
      const additional = merged.additionalProperties
      for (const key of Object.keys(record)) {
        if (key in properties || patterns.some(p => p.test(key))) continue
        const keyPath = childPath(path, key)
        if (additional === false) {
          report(ctx, { severity: 'error', kind: 'additional-property', path: keyPath, message: `Field "${key}" is not allowed (additionalProperties: false)`, schemaName })
        } else if (additional && typeof additional === 'object') {
          walk(record[key], additional, keyPath, ctx, undefined, depth + 1, false)
        } else if (additional === undefined && merged.properties && !variants) {
          // Documented object with an unlisted field: the spec is behind the API.
          report(ctx, { severity: 'warning', kind: 'undocumented-field', path: keyPath, message: `Field "${key}" is returned but not in the spec`, schemaName, value: record[key] })
        }
      }
    }
  }
}

export function validateValue(value: unknown, schema: SchemaObject | undefined, resolver: Resolver, mode: SampleMode = 'response'): ValidationResult {
  const ctx: Context = { resolver, mode, issues: [], checked: 0 }
  walk(value, schema, '$', ctx, undefined, 0, false)
  return { issues: ctx.issues, checked: ctx.checked }
}
