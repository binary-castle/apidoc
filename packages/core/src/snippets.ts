import type { HttpRequestSpec } from './request'

export interface SnippetTarget {
  id: string
  label: string
  /** Language id for syntax highlighting. */
  language: string
  generate: (request: HttpRequestSpec) => string
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

const isJson = (request: HttpRequestSpec) =>
  request.headers.some(([k, v]) => k.toLowerCase() === 'content-type' && /json/i.test(v))

function parsedJsonBody(request: HttpRequestSpec): { ok: true; value: unknown } | { ok: false } {
  if (!request.body || !isJson(request)) return { ok: false }
  try {
    return { ok: true, value: JSON.parse(request.body) }
  } catch {
    return { ok: false }
  }
}

const curl: SnippetTarget = {
  id: 'curl',
  label: 'cURL',
  language: 'shellscript',
  generate(request) {
    const lines = [`curl ${request.method === 'GET' ? '' : `-X ${request.method} `}${shellQuote(request.url)}`]
    for (const [name, value] of request.headers) lines.push(`  -H ${shellQuote(`${name}: ${value}`)}`)
    if (request.body !== undefined) {
      const json = parsedJsonBody(request)
      lines.push(`  -d ${shellQuote(json.ok ? JSON.stringify(json.value, null, 2) : request.body)}`)
    }
    return lines.join(' \\\n')
  },
}

const javascript: SnippetTarget = {
  id: 'javascript',
  label: 'JavaScript',
  language: 'javascript',
  generate(request) {
    const options: string[] = []
    if (request.method !== 'GET') options.push(`  method: ${JSON.stringify(request.method)},`)
    if (request.headers.length) {
      options.push('  headers: {')
      for (const [name, value] of request.headers) options.push(`    ${JSON.stringify(name)}: ${JSON.stringify(value)},`)
      options.push('  },')
    }
    if (request.body !== undefined) {
      const json = parsedJsonBody(request)
      if (json.ok) options.push(`  body: JSON.stringify(${JSON.stringify(json.value, null, 2).replace(/\n/g, '\n  ')}),`)
      else options.push(`  body: ${JSON.stringify(request.body)},`)
    }
    const args = options.length ? `, {\n${options.join('\n')}\n}` : ''
    return `const response = await fetch(${JSON.stringify(request.url)}${args})\nconst data = await response.json()`
  },
}

function toPython(value: unknown, indent = 0): string {
  const pad = '    '.repeat(indent)
  const inner = '    '.repeat(indent + 1)
  if (value === null || value === undefined) return 'None'
  if (value === true) return 'True'
  if (value === false) return 'False'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    return `[\n${value.map(v => `${inner}${toPython(v, indent + 1)}`).join(',\n')},\n${pad}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (!entries.length) return '{}'
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${toPython(v, indent + 1)}`).join(',\n')},\n${pad}}`
}

const python: SnippetTarget = {
  id: 'python',
  label: 'Python',
  language: 'python',
  generate(request) {
    const json = parsedJsonBody(request)
    const headers = request.headers.filter(([k]) => !(json.ok && k.toLowerCase() === 'content-type'))
    const args = [JSON.stringify(request.url)]
    const lines = ['import requests', '']
    if (headers.length) {
      lines.push(`headers = ${toPython(Object.fromEntries(headers))}`)
      args.push('headers=headers')
    }
    if (json.ok) {
      lines.push(`payload = ${toPython(json.value)}`)
      args.push('json=payload')
    } else if (request.body !== undefined) {
      lines.push(`payload = ${JSON.stringify(request.body)}`)
      args.push('data=payload')
    }
    if (lines.length > 2) lines.push('')
    lines.push(`response = requests.${request.method.toLowerCase()}(${args.join(', ')})`, 'print(response.json())')
    return lines.join('\n')
  },
}

const go: SnippetTarget = {
  id: 'go',
  label: 'Go',
  language: 'go',
  generate(request) {
    const hasBody = request.body !== undefined
    const body = hasBody
      ? request.body!.includes('`') ? JSON.stringify(request.body) : `\`${parsedJsonBody(request).ok ? JSON.stringify(JSON.parse(request.body!), null, 2) : request.body}\``
      : ''
    const lines = [
      'package main',
      '',
      'import (',
      '\t"fmt"',
      '\t"io"',
      '\t"net/http"',
      ...(hasBody ? ['\t"strings"'] : []),
      ')',
      '',
      'func main() {',
      ...(hasBody ? [`\tbody := strings.NewReader(${body})`] : []),
      `\treq, _ := http.NewRequest(${JSON.stringify(request.method)}, ${JSON.stringify(request.url)}, ${hasBody ? 'body' : 'nil'})`,
      ...request.headers.map(([name, value]) => `\treq.Header.Set(${JSON.stringify(name)}, ${JSON.stringify(value)})`),
      '',
      '\tres, err := http.DefaultClient.Do(req)',
      '\tif err != nil {',
      '\t\tpanic(err)',
      '\t}',
      '\tdefer res.Body.Close()',
      '\tdata, _ := io.ReadAll(res.Body)',
      '\tfmt.Println(res.Status, string(data))',
      '}',
    ]
    return lines.join('\n')
  },
}

const http: SnippetTarget = {
  id: 'http',
  label: 'HTTP',
  language: 'http',
  generate(request) {
    let target = request.url
    let host = ''
    try {
      const url = new URL(request.url)
      target = url.pathname + url.search
      host = url.host
    } catch {
      // relative URL: keep as-is
    }
    const lines = [`${request.method} ${target} HTTP/1.1`]
    if (host) lines.push(`Host: ${host}`)
    for (const [name, value] of request.headers) lines.push(`${name}: ${value}`)
    if (request.body !== undefined) lines.push('', request.body)
    return lines.join('\n')
  },
}

export const SNIPPET_TARGETS: SnippetTarget[] = [curl, javascript, python, go, http]

export function generateSnippet(targetId: string, request: HttpRequestSpec): string {
  const target = SNIPPET_TARGETS.find(t => t.id === targetId) ?? curl
  return target.generate(request)
}
