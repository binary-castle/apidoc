import type { JsonObject, OpenAPIDocument } from './types'

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const REF_REWRITES: [string, string][] = [
  ['#/definitions/', '#/components/schemas/'],
  ['#/parameters/', '#/components/parameters/'],
  ['#/responses/', '#/components/responses/'],
]

/** Deep-copy while rewriting Swagger 2.0 $ref targets to their OpenAPI 3 locations. */
function rewriteRefs<T>(value: T): T {
  if (Array.isArray(value)) return value.map(rewriteRefs) as T
  if (!isObject(value)) return value
  const out: JsonObject = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === '$ref' && typeof child === 'string') {
      const rewrite = REF_REWRITES.find(([from]) => child.startsWith(from))
      out[key] = rewrite ? rewrite[1] + child.slice(rewrite[0].length) : child
    } else {
      out[key] = rewriteRefs(child)
    }
  }
  return out as T
}

/** Swagger 2.0 non-body parameters carry schema keywords inline; OpenAPI 3 nests them under `schema`. */
const SCHEMA_KEYS = [
  'type', 'format', 'items', 'collectionFormat', 'default', 'maximum', 'exclusiveMaximum', 'minimum',
  'exclusiveMinimum', 'maxLength', 'minLength', 'pattern', 'maxItems', 'minItems', 'uniqueItems', 'enum', 'multipleOf',
]

function convertParameter(parameter: JsonObject): JsonObject {
  if (typeof parameter.$ref === 'string') return parameter
  const schema: JsonObject = {}
  const out: JsonObject = {}
  for (const [key, value] of Object.entries(parameter)) {
    if (SCHEMA_KEYS.includes(key) && key !== 'collectionFormat') schema[key] = value
    else if (key !== 'collectionFormat' && key !== 'allowEmptyValue') out[key] = value
  }
  if (schema.type === 'file') {
    schema.type = 'string'
    schema.format = 'binary'
  }
  out.schema = schema
  const collection = parameter.collectionFormat
  if (collection === 'multi') out.explode = true
  else if (collection === 'csv' || (schema.type === 'array' && !collection)) out.explode = false
  else if (collection === 'ssv') out.style = 'spaceDelimited'
  else if (collection === 'pipes') out.style = 'pipeDelimited'
  return out
}

function convertResponse(response: JsonObject, produces: string[]): JsonObject {
  if (typeof response.$ref === 'string') return response
  const out: JsonObject = { description: response.description ?? '' }
  if (response.schema !== undefined) {
    const content: JsonObject = {}
    for (const mediaType of produces) {
      const media: JsonObject = { schema: response.schema }
      const examples = isObject(response.examples) ? response.examples : undefined
      if (examples && mediaType in examples) media.example = examples[mediaType]
      content[mediaType] = media
    }
    out.content = content
  }
  if (isObject(response.headers)) {
    out.headers = Object.fromEntries(
      Object.entries(response.headers).map(([name, header]) => {
        const { description, ...schema } = header as JsonObject
        return [name, { description, schema }]
      }),
    )
  }
  return out
}

function convertSecurityScheme(scheme: JsonObject): JsonObject {
  switch (scheme.type) {
    case 'basic':
      return { type: 'http', scheme: 'basic', description: scheme.description }
    case 'apiKey':
      return { type: 'apiKey', name: scheme.name, in: scheme.in, description: scheme.description }
    case 'oauth2': {
      const flowName = ({ implicit: 'implicit', password: 'password', application: 'clientCredentials', accessCode: 'authorizationCode' } as Record<string, string>)[String(scheme.flow)] ?? 'implicit'
      return {
        type: 'oauth2',
        description: scheme.description,
        flows: {
          [flowName]: { authorizationUrl: scheme.authorizationUrl, tokenUrl: scheme.tokenUrl, scopes: scheme.scopes ?? {} },
        },
      }
    }
    default:
      return scheme
  }
}

/**
 * Convert a Swagger 2.0 document to OpenAPI 3.0.3. Covers what real-world
 * generators emit (drf-yasg, older springfox/Swashbuckle, l5-swagger):
 * host/basePath/schemes, body + formData parameters, produces/consumes,
 * definitions, and security definitions.
 */
export function upgradeSwagger2(input: JsonObject): OpenAPIDocument {
  const swagger = rewriteRefs(input)
  const consumes = (swagger.consumes as string[] | undefined) ?? ['application/json']
  const produces = (swagger.produces as string[] | undefined) ?? ['application/json']

  const schemes = (swagger.schemes as string[] | undefined) ?? []
  const host = swagger.host as string | undefined
  const basePath = (swagger.basePath as string | undefined) ?? ''
  const servers = host
    ? (schemes.length ? schemes : ['https']).map(scheme => ({ url: `${scheme}://${host}${basePath}` }))
    : [{ url: basePath || '/' }]

  const components: JsonObject = {}
  if (isObject(swagger.definitions)) components.schemas = swagger.definitions
  if (isObject(swagger.securityDefinitions)) {
    components.securitySchemes = Object.fromEntries(
      Object.entries(swagger.securityDefinitions).map(([name, scheme]) => [name, convertSecurityScheme(scheme as JsonObject)]),
    )
  }
  const globalParameters = isObject(swagger.parameters) ? swagger.parameters : {}
  const requestBodies: JsonObject = {}
  const parameters: JsonObject = {}
  for (const [name, parameter] of Object.entries(globalParameters)) {
    const p = parameter as JsonObject
    if (p.in === 'body') requestBodies[name] = { required: p.required, description: p.description, content: { [consumes[0] ?? 'application/json']: { schema: p.schema } } }
    else parameters[name] = convertParameter(p)
  }
  if (Object.keys(parameters).length) components.parameters = parameters
  if (Object.keys(requestBodies).length) components.requestBodies = requestBodies
  if (isObject(swagger.responses)) {
    components.responses = Object.fromEntries(
      Object.entries(swagger.responses).map(([name, response]) => [name, convertResponse(response as JsonObject, produces)]),
    )
  }

  const paths: Record<string, JsonObject> = {}
  for (const [path, pathItem] of Object.entries((swagger.paths as JsonObject | undefined) ?? {})) {
    if (!isObject(pathItem)) continue
    const outItem: JsonObject = {}
    for (const [key, value] of Object.entries(pathItem)) {
      if (key === 'parameters' && Array.isArray(value)) {
        outItem.parameters = value.filter(p => (p as JsonObject).in !== 'body' && (p as JsonObject).in !== 'formData').map(p => convertParameter(p as JsonObject))
        continue
      }
      if (!isObject(value)) { outItem[key] = value; continue }
      const operation = value
      const opConsumes = (operation.consumes as string[] | undefined) ?? consumes
      const opProduces = (operation.produces as string[] | undefined) ?? produces
      const { parameters: rawParams, responses, consumes: _c, produces: _p, schemes: _s, ...rest } = operation
      const outOp: JsonObject = { ...rest }
      const params = Array.isArray(rawParams) ? (rawParams as JsonObject[]) : []

      const body = params.find(p => p.in === 'body')
      const formData = params.filter(p => p.in === 'formData')
      const bodyRef = params.find(p => typeof p.$ref === 'string' && String(p.$ref).replace('#/components/parameters/', '') in requestBodies)
      outOp.parameters = params
        .filter(p => p !== body && p !== bodyRef && p.in !== 'formData')
        .map(convertParameter)

      if (body) {
        outOp.requestBody = {
          required: Boolean(body.required),
          description: body.description,
          content: Object.fromEntries(opConsumes.map(mediaType => [mediaType, { schema: body.schema }])),
        }
      } else if (bodyRef) {
        outOp.requestBody = { $ref: `#/components/requestBodies/${String(bodyRef.$ref).replace('#/components/parameters/', '')}` }
      } else if (formData.length) {
        const hasFile = formData.some(p => p.type === 'file')
        const mediaType = hasFile ? 'multipart/form-data' : opConsumes.find(c => c.includes('form')) ?? 'application/x-www-form-urlencoded'
        const properties: JsonObject = {}
        const required: string[] = []
        for (const p of formData) {
          properties[String(p.name)] = (convertParameter(p).schema as JsonObject) ?? {}
          if (p.description) (properties[String(p.name)] as JsonObject).description = p.description
          if (p.required) required.push(String(p.name))
        }
        outOp.requestBody = { content: { [mediaType]: { schema: { type: 'object', properties, ...(required.length ? { required } : {}) } } } }
      }

      if (isObject(responses)) {
        outOp.responses = Object.fromEntries(
          Object.entries(responses).map(([status, response]) => [status, convertResponse(response as JsonObject, opProduces)]),
        )
      }
      outItem[key] = outOp
    }
    paths[path] = outItem
  }

  const { swagger: _version, host: _h, basePath: _b, schemes: _s, consumes: _c, produces: _p, definitions: _d,
    parameters: _params, responses: _r, securityDefinitions: _sd, paths: _paths, ...rest } = swagger
  return { ...rest, openapi: '3.0.3', servers, paths, components } as OpenAPIDocument
}
