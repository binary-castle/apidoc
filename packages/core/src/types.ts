// Loose OpenAPI shapes. Specs in the wild are messy, so everything is optional
// and we narrow at the edges instead of trusting the input.

export type JsonObject = Record<string, unknown>

export interface SchemaObject {
  $ref?: string
  type?: string | string[]
  format?: string
  title?: string
  description?: string
  default?: unknown
  example?: unknown
  examples?: unknown[]
  enum?: unknown[]
  const?: unknown
  nullable?: boolean
  readOnly?: boolean
  writeOnly?: boolean
  deprecated?: boolean
  properties?: Record<string, SchemaObject>
  additionalProperties?: boolean | SchemaObject
  required?: string[]
  items?: SchemaObject
  allOf?: SchemaObject[]
  oneOf?: SchemaObject[]
  anyOf?: SchemaObject[]
  not?: SchemaObject
  discriminator?: { propertyName: string; mapping?: Record<string, string> }
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number | boolean
  exclusiveMaximum?: number | boolean
  minLength?: number
  maxLength?: number
  pattern?: string
  minItems?: number
  maxItems?: number
  uniqueItems?: boolean
  [extension: `x-${string}`]: unknown
}

export interface OpenAPIDocument {
  openapi: string
  info?: { title?: string; version?: string; description?: string; summary?: string }
  servers?: { url: string; description?: string; variables?: Record<string, { default: string; enum?: string[]; description?: string }> }[]
  paths?: Record<string, JsonObject>
  components?: {
    schemas?: Record<string, SchemaObject>
    parameters?: Record<string, JsonObject>
    requestBodies?: Record<string, JsonObject>
    responses?: Record<string, JsonObject>
    securitySchemes?: Record<string, JsonObject>
    [key: string]: unknown
  }
  security?: Record<string, string[]>[]
  tags?: { name: string; description?: string; 'x-displayName'?: string }[]
  'x-tagGroups'?: { name: string; tags: string[] }[]
  [key: string]: unknown
}

export type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace'
export const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']

export type ParameterLocation = 'path' | 'query' | 'header' | 'cookie'

export interface ServerModel {
  url: string
  description?: string
  variables: Record<string, { default: string; enum?: string[]; description?: string }>
}

export interface ParameterModel {
  name: string
  in: ParameterLocation
  required: boolean
  deprecated: boolean
  description?: string
  schema?: SchemaObject
  example?: unknown
  style?: string
  explode?: boolean
}

export interface MediaTypeModel {
  mediaType: string
  schema?: SchemaObject
  example?: unknown
  examples: { name: string; summary?: string; value: unknown }[]
}

export interface RequestBodyModel {
  required: boolean
  description?: string
  content: MediaTypeModel[]
}

export interface ResponseModel {
  status: string
  description?: string
  content: MediaTypeModel[]
  headers: { name: string; description?: string; schema?: SchemaObject }[]
}

export interface SecurityRequirementModel {
  /** All schemes in one requirement must be satisfied together. */
  schemes: { name: string; scopes: string[] }[]
}

export type SecuritySchemeModel =
  | { kind: 'http'; name: string; scheme: string; bearerFormat?: string; description?: string }
  | { kind: 'apiKey'; name: string; in: 'header' | 'query' | 'cookie'; paramName: string; description?: string }
  | { kind: 'oauth2'; name: string; description?: string; flows: JsonObject }
  | { kind: 'openIdConnect'; name: string; description?: string; url: string }
  | { kind: 'unknown'; name: string; description?: string }

export interface OperationModel {
  /** Stable, URL-safe id used for routing and anchors. */
  id: string
  operationId?: string
  method: HttpMethod
  path: string
  summary?: string
  description?: string
  tags: string[]
  deprecated: boolean
  parameters: ParameterModel[]
  requestBody?: RequestBodyModel
  responses: ResponseModel[]
  security: SecurityRequirementModel[]
  servers: ServerModel[]
  extensions: Record<string, unknown>
}

export interface TagModel {
  name: string
  displayName: string
  description?: string
  operations: OperationModel[]
}

export interface SchemaEntry {
  name: string
  ref: string
  schema: SchemaObject
}

/** `info.x-logo` (the ReDoc convention): the API's logo, as given in the spec. */
export interface SpecLogo {
  url: string
  altText?: string
  href?: string
  backgroundColor?: string
}

export interface ApiModel {
  /** Version string of the original input, e.g. "2.0", "3.0.3", "3.1.0". */
  specVersion: string
  sourceFormat: 'swagger2' | 'openapi3'
  info: { title: string; version: string; description?: string; summary?: string; logo?: SpecLogo }
  servers: ServerModel[]
  tags: TagModel[]
  operations: OperationModel[]
  schemas: SchemaEntry[]
  securitySchemes: Record<string, SecuritySchemeModel>
  /** The (upgraded) OpenAPI 3.x document everything was built from. */
  document: OpenAPIDocument
}
