import { parse as parseYaml } from 'yaml'
import { normalize } from './normalize'
import type { ApiModel, JsonObject, OpenAPIDocument } from './types'
import { upgradeSwagger2 } from './upgrade'

export class SpecError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'SpecError'
  }
}

/** Parse JSON or YAML text. JSON is tried first because it is far faster on large specs. */
export function parseSpecText(text: string): JsonObject {
  const trimmed = text.trimStart()
  let parsed: unknown
  try {
    parsed = trimmed.startsWith('{') ? JSON.parse(trimmed) : parseYaml(text, { maxAliasCount: -1 })
  } catch (error) {
    throw new SpecError(`Could not parse the spec as JSON or YAML: ${(error as Error).message}`, error)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SpecError('The spec must be a JSON or YAML object.')
  }
  return parsed as JsonObject
}

/** Accept any supported input and return an OpenAPI 3.x document plus what it came from. */
export function toOpenAPI3(input: JsonObject): { document: OpenAPIDocument; specVersion: string; sourceFormat: ApiModel['sourceFormat'] } {
  if (typeof input.swagger === 'string' && input.swagger.startsWith('2')) {
    return { document: upgradeSwagger2(input), specVersion: input.swagger, sourceFormat: 'swagger2' }
  }
  if (typeof input.openapi === 'string' && input.openapi.startsWith('3')) {
    return { document: input as OpenAPIDocument, specVersion: input.openapi, sourceFormat: 'openapi3' }
  }
  throw new SpecError('Not an OpenAPI document: expected an "openapi: 3.x" or "swagger: 2.0" field.')
}

export interface LoadOptions {
  fetch?: typeof fetch
  headers?: Record<string, string>
}

/** Where a spec comes from: a URL to fetch, or JSON/YAML text / a parsed object. */
export type SpecSource = { url: string } | { content: string | JsonObject }

export async function loadSpec(source: SpecSource, options: LoadOptions = {}): Promise<ApiModel> {
  let input: JsonObject
  if ('content' in source) {
    input = typeof source.content === 'string' ? parseSpecText(source.content) : source.content
  } else {
    const doFetch = options.fetch ?? fetch
    let response: Response
    try {
      response = await doFetch(source.url, { headers: { Accept: 'application/json, application/yaml;q=0.9, */*;q=0.5', ...options.headers } })
    } catch (error) {
      throw new SpecError(`Could not fetch ${source.url}: ${(error as Error).message}`, error)
    }
    if (!response.ok) throw new SpecError(`Could not fetch ${source.url}: HTTP ${response.status}`)
    input = parseSpecText(await response.text())
  }
  const { document, specVersion, sourceFormat } = toOpenAPI3(input)
  return normalize(document, specVersion, sourceFormat)
}
