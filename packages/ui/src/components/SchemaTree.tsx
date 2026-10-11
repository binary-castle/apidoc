import { constraintHints, isNullable, mergeAllOf, objectProperties, schemaTypes, typeLabel, unwrapNullable, type SampleMode, type SchemaObject } from '@apidoc/core'
import { useState, type ReactNode } from 'react'
import { renderMarkdown } from '../lib/markdown'
import { useDocs } from '../state'
import { Icon, Tag } from './ui'

interface Options {
  mode: SampleMode
  requiredOnly: boolean
}

type Expansion =
  | { kind: 'object'; schema: SchemaObject; viaArray: boolean }
  | { kind: 'variants'; variants: SchemaObject[] }

/** What a property expands into, if anything. */
function childrenOf(schema: SchemaObject | undefined, resolver: ReturnType<typeof useDocs>['resolver']): Expansion | undefined {
  const resolved = mergeAllOf(schema, resolver)
  if (!resolved) return undefined
  const variants = resolved.oneOf ?? resolved.anyOf
  if (variants && variants.filter(v => v.type !== 'null').length > 1) return { kind: 'variants' as const, variants: variants.filter(v => v.type !== 'null') }
  if (variants) return childrenOf(variants.find(v => v.type !== 'null'), resolver)
  const types = schemaTypes(resolved)
  if (types.includes('array')) {
    const items = childrenOf(resolved.items, resolver)
    return items?.kind === 'object' ? { ...items, viaArray: true } : items
  }
  if (resolved.properties) return { kind: 'object' as const, schema: resolved, viaArray: false }
  if (resolved.additionalProperties && typeof resolved.additionalProperties === 'object') {
    const values = childrenOf(resolved.additionalProperties, resolver)
    return values?.kind === 'object' ? values : undefined
  }
  return undefined
}

function EnumValues({ values }: { values: unknown[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? values : values.slice(0, 6)
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map(value => (
        <code key={String(value)} className="rounded bg-raised px-1.5 py-px font-mono text-[11px] text-sx-string">
          {JSON.stringify(value)}
        </code>
      ))}
      {values.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="font-mono text-[11px] text-subtle hover:text-fg-2">
          +{values.length - shown.length} more
        </button>
      )}
    </span>
  )
}

export function FieldRow({ name, schema, required, depth, options, extraTags }: { name: string; schema: SchemaObject | undefined; required: boolean; depth: number; options: Options; extraTags?: ReactNode }) {
  const { resolver } = useDocs()
  // Optional fields are often anyOf [X, null]; constraints and enums live on X.
  const resolved = unwrapNullable(schema, resolver)
  const nested = childrenOf(schema, resolver)
  const [open, setOpen] = useState(depth === 0 && nested?.kind === 'object' && (resolver.schema(schema).ref === undefined))
  const label = typeLabel(schema, resolver)
  const enumValues = resolved?.enum ?? (resolved?.const !== undefined ? [resolved.const] : resolved?.items ? resolver.schema(resolved.items).value?.enum : undefined)
  const hints = constraintHints(resolved)
  const description = resolved?.description
  const fieldCount = nested?.kind === 'object' ? objectProperties(nested.schema, resolver).length : 0

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {nested ? (
          <button type="button" onClick={() => setOpen(o => !o)} className="-ml-0.5 flex items-center gap-1.5 text-left" aria-expanded={open}>
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} strokeWidth={2.4} className="text-muted" />
            <span className="font-mono text-[13px] font-medium text-fg">{name}</span>
          </button>
        ) : (
          <span className="font-mono text-[13px] font-medium text-fg">{name}</span>
        )}
        {label.refName && <span className="font-mono text-[11px] text-accent-text">{label.refName}</span>}
        <span className="font-mono text-[11px] text-subtle">
          {label.label}
          {label.nullable && ' | null'}
          {nested?.kind === 'object' && fieldCount > 0 && ` · ${fieldCount} field${fieldCount === 1 ? '' : 's'}`}
        </span>
        {hints.map(hint => <span key={hint} className="font-mono text-[11px] text-subtle">{hint}</span>)}
        {required ? <Tag tone="err">required</Tag> : depth === 0 && <span className="text-[11px] text-subtle">optional</span>}
        {resolved?.readOnly && <Tag tone="neutral">read-only</Tag>}
        {resolved?.writeOnly && <Tag tone="neutral">write-only</Tag>}
        {resolved?.deprecated && <Tag tone="err">deprecated</Tag>}
        {extraTags}
      </div>
      {description && <div className="ad-prose !text-[13px] !leading-5" dangerouslySetInnerHTML={{ __html: renderMarkdown(description) }} />}
      {enumValues && enumValues.length > 0 && <EnumValues values={enumValues} />}
      {resolved?.default !== undefined && (
        <span className="text-[11px] text-subtle">
          Default <code className="font-mono text-sx-number">{JSON.stringify(resolved.default)}</code>
        </span>
      )}
      {open && nested && (
        <div className="mt-1 flex gap-3.5 pl-[5px]">
          <div className="w-px shrink-0 bg-selected-line" />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {nested.kind === 'object' ? (
              <PropertyList schema={nested.schema} depth={depth + 1} options={options} />
            ) : (
              <Variants variants={nested.variants} depth={depth + 1} options={options} discriminator={resolved?.discriminator?.propertyName} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Variants({ variants, depth, options, discriminator }: { variants: SchemaObject[]; depth: number; options: Options; discriminator?: string }) {
  const { resolver } = useDocs()
  const [active, setActive] = useState(0)
  const current = variants[active]
  const nested = childrenOf(current, resolver)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-subtle">{discriminator ? `One of, by ${discriminator}:` : 'One of:'}</span>
        {variants.map((variant, index) => (
          <button
            key={index}
            type="button"
            onClick={() => setActive(index)}
            className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${index === active ? 'border-accent-line bg-accent-soft text-accent-text' : 'border-border text-muted hover:text-fg-2'}`}
          >
            {typeLabel(variant, resolver).refName ?? typeLabel(variant, resolver).label}
          </button>
        ))}
      </div>
      {nested?.kind === 'object' ? (
        <PropertyList schema={nested.schema} depth={depth} options={options} />
      ) : (
        <span className="font-mono text-xs text-subtle">{typeLabel(current, resolver).label}</span>
      )}
    </div>
  )
}

function PropertyList({ schema, depth, options }: { schema: SchemaObject; depth: number; options: Options }) {
  const { resolver } = useDocs()
  const properties = objectProperties(schema, resolver).filter(property => {
    const resolved = resolver.schema(property.schema).value
    if (options.mode === 'request' && resolved?.readOnly) return false
    if (options.mode === 'response' && resolved?.writeOnly) return false
    return !options.requiredOnly || property.required
  })
  if (!properties.length) return <span className="text-xs text-subtle">{options.requiredOnly ? 'No required fields.' : 'No fields.'}</span>
  return (
    <>
      {properties.map(property => (
        <FieldRow key={property.name} name={property.name} schema={property.schema} required={property.required} depth={depth} options={options} />
      ))}
    </>
  )
}

/**
 * Top-level schema view: a bordered list of fields for objects, or a single
 * row for primitives/arrays of primitives.
 */
export function SchemaTree({ schema, mode, requiredOnly = false }: { schema: SchemaObject | undefined; mode: SampleMode; requiredOnly?: boolean }) {
  const { resolver } = useDocs()
  const options = { mode, requiredOnly }
  const resolved = mergeAllOf(schema, resolver)
  const nested = childrenOf(schema, resolver)
  const label = typeLabel(schema, resolver)

  if (!resolved) return <p className="text-sm text-subtle">No schema.</p>

  if (nested?.kind === 'object') {
    const properties = objectProperties(nested.schema, resolver).filter(p => {
      const r = resolver.schema(p.schema).value
      return !(mode === 'request' && r?.readOnly) && !(mode === 'response' && r?.writeOnly) && (!requiredOnly || p.required)
    })
    return (
      <div className="flex flex-col">
        {(nested.viaArray || label.refName) && (
          <p className="mb-2 font-mono text-[11px] text-subtle">
            {nested.viaArray ? 'array of ' : ''}
            <span className="text-accent-text">{label.refName ?? typeLabel(resolved.items, resolver).refName ?? 'object'}</span>
            {isNullable(resolved) && ' | null'}
          </p>
        )}
        <div className="flex flex-col rounded-[10px] border border-line">
          {properties.length ? (
            properties.map((property, index) => (
              <div key={property.name} className={`px-3.5 py-3 ${index ? 'border-t border-line' : ''}`}>
                <FieldRow name={property.name} schema={property.schema} required={property.required} depth={0} options={options} />
              </div>
            ))
          ) : (
            <p className="px-3.5 py-3 text-xs text-subtle">{requiredOnly ? 'No required fields.' : 'No fields.'}</p>
          )}
        </div>
      </div>
    )
  }

  if (nested?.kind === 'variants') {
    return (
      <div className="rounded-[10px] border border-line px-3.5 py-3">
        <Variants variants={nested.variants} depth={0} options={options} discriminator={resolved.discriminator?.propertyName} />
      </div>
    )
  }

  return (
    <div className="rounded-[10px] border border-line px-3.5 py-3">
      <FieldRow name={label.refName ?? 'value'} schema={schema} required={false} depth={1} options={options} />
    </div>
  )
}
