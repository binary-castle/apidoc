import { Resolver } from './refs'
import {
  HTTP_METHODS,
  type ApiModel,
  type HttpMethod,
  type JsonObject,
  type MediaTypeModel,
  type OpenAPIDocument,
  type OperationModel,
  type ParameterLocation,
  type ParameterModel,
  type RequestBodyModel,
  type ResponseModel,
  type SchemaObject,
  type SecurityRequirementModel,
  type SecuritySchemeModel,
  type ServerModel,
  type TagModel,
} from './types'

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown) => (typeof value === 'string' && value.length ? value : undefined)

export const UNTAGGED = 'Endpoints'

/** Turn "/v2/customers/{id}" + "get" into "get-v2-customers-id". */
function slug(...parts: string[]) {
  return parts
    .join('-')
    .toLowerCase()
    .replace(/[{}]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeServers(raw: unknown): ServerModel[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isObject).flatMap(server => {
    const url = asString(server.url)
    if (!url) return []
    const variables: ServerModel['variables'] = {}
    if (isObject(server.variables)) {
      for (const [name, variable] of Object.entries(server.variables)) {
        if (!isObject(variable)) continue
        variables[name] = {
          default: String(variable.default ?? ''),
          enum: Array.isArray(variable.enum) ? variable.enum.map(String) : undefined,
          description: asString(variable.description),
        }
      }
    }
    return [{ url, description: asString(server.description), variables }]
  })
}

function normalizeMediaTypes(resolver: Resolver, content: unknown): MediaTypeModel[] {
  if (!isObject(content)) return []
  return Object.entries(content).map(([mediaType, raw]) => {
    const media = resolver.resolve<JsonObject>(raw as JsonObject).value ?? {}
    const examples: MediaTypeModel['examples'] = []
    if (isObject(media.examples)) {
      for (const [name, example] of Object.entries(media.examples)) {
        const resolved = resolver.resolve<JsonObject>(example as JsonObject).value
        if (resolved && 'value' in resolved) examples.push({ name, summary: asString(resolved.summary), value: resolved.value })
      }
    }
    return {
      mediaType,
      schema: media.schema as SchemaObject | undefined,
      example: media.example,
      examples,
    }
  })
}

function normalizeParameters(resolver: Resolver, ...lists: unknown[]): ParameterModel[] {
  // Operation-level parameters override path-level ones with the same name + location.
  const byKey = new Map<string, ParameterModel>()
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const raw of list) {
      const parameter = resolver.resolve<JsonObject>(raw as JsonObject).value
      if (!parameter) continue
      const name = asString(parameter.name)
      const location = parameter.in as ParameterLocation
      if (!name || !['path', 'query', 'header', 'cookie'].includes(location)) continue
      let schema = parameter.schema as SchemaObject | undefined
      // OpenAPI 3 also allows `content` instead of `schema` on parameters.
      if (!schema && isObject(parameter.content)) {
        const first = Object.values(parameter.content)[0]
        if (isObject(first)) schema = first.schema as SchemaObject | undefined
      }
      byKey.set(`${location}:${name}`, {
        name,
        in: location,
        required: location === 'path' ? true : Boolean(parameter.required),
        deprecated: Boolean(parameter.deprecated),
        description: asString(parameter.description),
        schema,
        example: parameter.example,
        style: asString(parameter.style),
        explode: typeof parameter.explode === 'boolean' ? parameter.explode : undefined,
      })
    }
  }
  const order: ParameterLocation[] = ['path', 'query', 'header', 'cookie']
  return [...byKey.values()].sort((a, b) => order.indexOf(a.in) - order.indexOf(b.in))
}

function normalizeRequestBody(resolver: Resolver, raw: unknown): RequestBodyModel | undefined {
  const body = resolver.resolve<JsonObject>(raw as JsonObject).value
  if (!body) return undefined
  return {
    required: Boolean(body.required),
    description: asString(body.description),
    content: normalizeMediaTypes(resolver, body.content),
  }
}

function normalizeResponses(resolver: Resolver, raw: unknown): ResponseModel[] {
  if (!isObject(raw)) return []
  return Object.entries(raw)
    .flatMap(([status, value]): ResponseModel[] => {
      if (status.startsWith('x-')) return []
      const response = resolver.resolve<JsonObject>(value as JsonObject).value ?? {}
      const headers = isObject(response.headers)
        ? Object.entries(response.headers).map(([name, header]) => {
            const resolved = resolver.resolve<JsonObject>(header as JsonObject).value ?? {}
            return { name, description: asString(resolved.description), schema: resolved.schema as SchemaObject | undefined }
          })
        : []
      return [{ status, description: asString(response.description), content: normalizeMediaTypes(resolver, response.content), headers }]
    })
    .sort((a, b) => statusRank(a.status) - statusRank(b.status))
}

/** 2XX before 4XX, "default" last. */
function statusRank(status: string) {
  if (status === 'default') return 1000
  const numeric = Number(status.replace(/X/gi, '0'))
  return Number.isFinite(numeric) ? numeric : 999
}

function normalizeSecurity(raw: unknown): SecurityRequirementModel[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isObject).map(requirement => ({
    schemes: Object.entries(requirement).map(([name, scopes]) => ({ name, scopes: Array.isArray(scopes) ? scopes.map(String) : [] })),
  }))
}

function normalizeSecuritySchemes(resolver: Resolver, raw: unknown): Record<string, SecuritySchemeModel> {
  const out: Record<string, SecuritySchemeModel> = {}
  if (!isObject(raw)) return out
  for (const [name, value] of Object.entries(raw)) {
    const scheme = resolver.resolve<JsonObject>(value as JsonObject).value ?? {}
    const description = asString(scheme.description)
    switch (scheme.type) {
      case 'http':
        out[name] = { kind: 'http', name, scheme: String(scheme.scheme ?? 'bearer').toLowerCase(), bearerFormat: asString(scheme.bearerFormat), description }
        break
      case 'apiKey':
        out[name] = { kind: 'apiKey', name, in: (scheme.in as 'header' | 'query' | 'cookie') ?? 'header', paramName: String(scheme.name ?? name), description }
        break
      case 'oauth2':
        out[name] = { kind: 'oauth2', name, description, flows: isObject(scheme.flows) ? scheme.flows : {} }
        break
      case 'openIdConnect':
        out[name] = { kind: 'openIdConnect', name, description, url: String(scheme.openIdConnectUrl ?? '') }
        break
      default:
        out[name] = { kind: 'unknown', name, description }
    }
  }
  return out
}

/** Build the UI model from an OpenAPI 3.x document (already upgraded from 2.0 if needed). */
export function normalize(document: OpenAPIDocument, specVersion = document.openapi, sourceFormat: ApiModel['sourceFormat'] = 'openapi3'): ApiModel {
  const resolver = new Resolver(document)
  const servers = normalizeServers(document.servers)
  const globalSecurity = normalizeSecurity(document.security)
  const operations: OperationModel[] = []
  const usedIds = new Set<string>()

  for (const [path, rawItem] of Object.entries(document.paths ?? {})) {
    const pathItem = resolver.resolve<JsonObject>(rawItem).value
    if (!pathItem) continue
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method]
      if (!isObject(operation)) continue
      const operationId = asString(operation.operationId)
      let id = slug(operationId ?? `${method}-${path}`) || slug(method, path)
      for (let n = 2; usedIds.has(id); n++) id = `${slug(operationId ?? `${method}-${path}`)}-${n}`
      usedIds.add(id)

      const extensions = Object.fromEntries(Object.entries(operation).filter(([key]) => key.startsWith('x-')))
      operations.push({
        id,
        operationId,
        method: method as HttpMethod,
        path,
        summary: asString(operation.summary),
        description: asString(operation.description),
        tags: Array.isArray(operation.tags) && operation.tags.length ? operation.tags.map(String) : [UNTAGGED],
        deprecated: Boolean(operation.deprecated),
        parameters: normalizeParameters(resolver, pathItem.parameters, operation.parameters),
        requestBody: normalizeRequestBody(resolver, operation.requestBody),
        responses: normalizeResponses(resolver, operation.responses),
        security: 'security' in operation ? normalizeSecurity(operation.security) : globalSecurity,
        servers: normalizeServers(operation.servers ?? pathItem.servers),
        extensions,
      })
    }
  }

  // Tags keep the order declared in the spec; tags only used by operations follow.
  const declared = (document.tags ?? []).filter(tag => isObject(tag) && asString(tag.name))
  const tagMap = new Map<string, TagModel>()
  for (const tag of declared) {
    tagMap.set(tag.name, { name: tag.name, displayName: asString(tag['x-displayName']) ?? tag.name, description: asString(tag.description), operations: [] })
  }
  for (const operation of operations) {
    for (const tagName of operation.tags) {
      if (!tagMap.has(tagName)) tagMap.set(tagName, { name: tagName, displayName: tagName, operations: [] })
      tagMap.get(tagName)!.operations.push(operation)
    }
  }

  const schemas = Object.entries(document.components?.schemas ?? {}).map(([name, schema]) => ({
    name,
    ref: `#/components/schemas/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`,
    schema,
  }))

  return {
    specVersion,
    sourceFormat,
    info: {
      title: asString(document.info?.title) ?? 'API Reference',
      version: asString(document.info?.version) ?? '',
      description: asString(document.info?.description),
      summary: asString(document.info?.summary),
    },
    servers: servers.length ? servers : [{ url: '/', variables: {} }],
    tags: [...tagMap.values()].filter(tag => tag.operations.length),
    operations,
    schemas,
    securitySchemes: normalizeSecuritySchemes(resolver, document.components?.securitySchemes),
    document,
  }
}
