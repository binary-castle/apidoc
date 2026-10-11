import type { ParameterLocation, ParameterModel } from '@apidoc/core'
import { FieldRow } from './SchemaTree'
import { Tag } from './ui'

const TITLES: Record<ParameterLocation, string> = {
  path: 'Path parameters',
  query: 'Query parameters',
  header: 'Headers',
  cookie: 'Cookies',
}

export function Parameters({ parameters }: { parameters: ParameterModel[] }) {
  const groups = (['path', 'query', 'header', 'cookie'] as const)
    .map(location => ({ location, items: parameters.filter(p => p.in === location) }))
    .filter(group => group.items.length)
  return (
    <>
      {groups.map(group => (
        <section key={group.location} className="flex flex-col gap-2.5">
          <h2 className="text-[13px] font-semibold text-fg">{TITLES[group.location]}</h2>
          <div className="flex flex-col rounded-[10px] border border-line">
            {group.items.map((parameter, index) => (
              <div key={parameter.name} className={`px-3.5 py-3 ${index ? 'border-t border-line' : ''}`}>
                <FieldRow
                  name={parameter.name}
                  schema={parameter.description ? { ...parameter.schema, description: parameter.description } : parameter.schema}
                  required={parameter.required}
                  depth={0}
                  options={{ mode: 'request', requiredOnly: false }}
                  extraTags={parameter.deprecated ? <Tag tone="err">deprecated</Tag> : undefined}
                />
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
