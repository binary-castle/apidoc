import { defaultInputs, findOperation, isExpression, parseCondition, type ArazzoDocument, type ArazzoStep, type ArazzoWorkflow, type ConditionNode } from './arazzo'
import { Resolver } from './refs'
import { objectProperties, schemaTypes, unwrapNullable } from './schema'
import type { ApiModel, OperationModel, SchemaObject } from './types'

/**
 * Turn an Arazzo workflow into a script people can run or commit: TypeScript
 * (fetch), Python (requests) or a VS Code REST Client `.http` file.
 * Control flow (goto/retry) isn't reproduced; it's noted in comments.
 */

export type WorkflowExportFormat = 'typescript' | 'python' | 'http'

type Lang = 'ts' | 'py'

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
const EMBEDDED = /\{(\$[A-Za-z][^{}]*)\}/g

const decodePointer = (segment: string) => segment.replace(/~1/g, '/').replace(/~0/g, '~')

function access(base: string, keys: (string | number)[], lang: Lang): string {
  return keys.reduce<string>((code, key) => {
    if (typeof key === 'number') return `${code}[${key}]`
    if (lang === 'ts') return IDENTIFIER.test(key) ? `${code}.${key}` : `${code}[${JSON.stringify(key)}]`
    return `${code}[${JSON.stringify(key)}]`
  }, base)
}

const pointerKeys = (pointer: string) => pointer.split('/').slice(1).map(decodePointer).map(k => (/^\d+$/.test(k) ? Number(k) : k))

/** A runtime expression as code, with `res` the current step's response. */
function expressionCode(expression: string, lang: Lang): string {
  const hash = expression.indexOf('#')
  const base = hash === -1 ? expression : expression.slice(0, hash)
  const keys = hash === -1 ? [] : pointerKeys(expression.slice(hash + 1))
  const [root, ...rest] = base.slice(1).split('.')
  const res = (field: string) => (lang === 'ts' ? `res.${field}` : `res[${JSON.stringify(field)}]`)
  switch (root) {
    case 'inputs':
      return access('inputs', [...rest, ...keys], lang)
    case 'steps': {
      const [stepId, , ...outputKeys] = rest
      return access(lang === 'ts' ? access('steps', [stepId!], lang) : `steps[${JSON.stringify(stepId)}]`, [...outputKeys, ...keys], lang)
    }
    case 'statusCode':
      return res('status')
    case 'url':
      return res('url')
    case 'response':
      if (rest[0] === 'body') return access(res('body'), keys, lang)
      if (rest[0] === 'header') {
        const name = JSON.stringify(rest.slice(1).join('.'))
        return lang === 'ts' ? `res.headers.get(${name})` : `res["headers"].get(${name})`
      }
  }
  return lang === 'ts' ? `undefined /* ${expression} not supported in exports */` : `None  # ${expression} not supported in exports`
}

function stringParts(value: string, lang: Lang): string {
  const parts: string[] = []
  let last = 0
  for (const match of value.matchAll(EMBEDDED)) {
    if (match.index! > last) parts.push(JSON.stringify(value.slice(last, match.index)))
    const code = expressionCode(match[1]!, lang)
    parts.push(lang === 'ts' ? `String(${code})` : `str(${code})`)
    last = match.index! + match[0].length
  }
  if (last < value.length) parts.push(JSON.stringify(value.slice(last)))
  return parts.join(' + ') || '""'
}

/** A literal value as code, with expressions spliced in. */
function valueCode(value: unknown, lang: Lang, indent = ''): string {
  const inner = `${indent}  `
  if (isExpression(value)) return expressionCode(value, lang)
  if (typeof value === 'string') return value.match(EMBEDDED) ? stringParts(value, lang) : JSON.stringify(value)
  if (value === null || value === undefined) return lang === 'ts' ? 'null' : 'None'
  if (typeof value === 'boolean') return lang === 'ts' ? String(value) : value ? 'True' : 'False'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    return `[\n${value.map(v => `${inner}${valueCode(v, lang, inner)}`).join(',\n')},\n${indent}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (!entries.length) return '{}'
  const key = (k: string) => (lang === 'ts' && IDENTIFIER.test(k) ? k : JSON.stringify(k))
  return `{\n${entries.map(([k, v]) => `${inner}${key(k)}: ${valueCode(v, lang, inner)}`).join(',\n')},\n${indent}}`
}

function conditionCode(node: ConditionNode, lang: Lang): string {
  switch (node.kind) {
    case 'literal':
      return valueCode(node.value, lang)
    case 'expression':
      return expressionCode(node.expression, lang)
    case 'not':
      return lang === 'ts' ? `!(${conditionCode(node.operand, lang)})` : `not (${conditionCode(node.operand, lang)})`
    case 'binary': {
      const wrap = (child: ConditionNode) => (child.kind === 'binary' && (child.operator === '&&' || child.operator === '||') ? `(${conditionCode(child, lang)})` : conditionCode(child, lang))
      const operator =
        lang === 'ts'
          ? ({ '==': '===', '!=': '!==' } as Record<string, string>)[node.operator] ?? node.operator
          : ({ '&&': 'and', '||': 'or' } as Record<string, string>)[node.operator] ?? node.operator
      return `${wrap(node.left)} ${operator} ${wrap(node.right)}`
    }
  }
}

interface PreparedStep {
  step: ArazzoStep
  operation?: OperationModel
  path: Record<string, unknown>
  query: Record<string, unknown>
  headers: Record<string, unknown>
  criteria: string[]
}

function prepare(workflow: ArazzoWorkflow, model: ApiModel): PreparedStep[] {
  return workflow.steps.map(step => {
    const operation = findOperation(step, model)
    const groups = { path: {} as Record<string, unknown>, query: {} as Record<string, unknown>, headers: {} as Record<string, unknown> }
    for (const p of [...(workflow.parameters ?? []), ...(step.parameters ?? [])]) {
      if (!('name' in p)) continue
      const location = p.in ?? operation?.parameters.find(x => x.name === p.name)?.in ?? 'query'
      if (location === 'path') groups.path[p.name] = p.value
      else if (location === 'header') groups.headers[p.name] = p.value
      else if (location === 'query') groups.query[p.name] = p.value
    }
    const criteria = step.successCriteria?.length ? step.successCriteria.filter(c => (c.type ?? 'simple') === 'simple').map(c => c.condition) : ['$statusCode >= 200 && $statusCode < 300']
    return { step, operation, ...groups, criteria }
  })
}

function pathCode(operation: OperationModel, params: Record<string, unknown>, lang: Lang): string {
  const pieces = operation.path.split(/(\{[^}]+\})/).filter(Boolean)
  if (lang === 'ts') {
    return `\`${pieces
      .map(piece => {
        const name = piece.match(/^\{(.+)\}$/)?.[1]
        if (!name) return piece.replace(/`/g, '\\`')
        return name in params ? `\${encodeURIComponent(String(${valueCode(params[name], 'ts')}))}` : piece
      })
      .join('')}\``
  }
  return pieces
    .map(piece => {
      const name = piece.match(/^\{(.+)\}$/)?.[1]
      return name && name in params ? `quote(str(${valueCode(params[name], 'py')}), safe="")` : JSON.stringify(piece)
    })
    .join(' + ')
}

const notes = (step: ArazzoStep, comment: string) =>
  [
    ...(step.onSuccess?.length ? [`${comment} onSuccess: ${step.onSuccess.map(a => a.type + (a.stepId ? ` → ${a.stepId}` : '')).join(', ')} (not reproduced here)`] : []),
    ...(step.onFailure?.length ? [`${comment} onFailure: ${step.onFailure.map(a => a.type + (a.stepId ? ` → ${a.stepId}` : '')).join(', ')} (not reproduced here)`] : []),
  ]

function typescript(doc: ArazzoDocument, workflow: ArazzoWorkflow, model: ApiModel, baseUrl: string): string {
  const lines = [
    `// ${workflow.summary ?? workflow.workflowId}`,
    `// Generated by apidoc from "${doc.info.title}" (Arazzo ${doc.arazzo}), workflow "${workflow.workflowId}".`,
    '// Run with Node 20+: BASE_URL=https://api.example.com npx tsx workflow.ts',
    '',
    `const baseUrl = (process.env.BASE_URL ?? ${JSON.stringify(baseUrl)}).replace(/\\/$/, '')`,
    '// Add credentials here, e.g. { Authorization: `Bearer ${process.env.API_TOKEN}` }',
    'const headers: Record<string, string> = {}',
    `const inputs: Record<string, any> = ${valueCode(defaultInputs(workflow, doc), 'ts')}`,
    'const steps: Record<string, any> = {}',
    '',
    'async function call(method: string, path: string, options: { query?: Record<string, unknown>; headers?: Record<string, string>; body?: unknown; contentType?: string } = {}) {',
    '  const url = new URL(baseUrl + path)',
    '  for (const [name, value] of Object.entries(options.query ?? {})) url.searchParams.set(name, String(value))',
    '  const init: RequestInit = { method, headers: { ...headers, ...options.headers } }',
    '  if (options.body !== undefined) {',
    "    const type = options.contentType ?? 'application/json'",
    "    ;(init.headers as Record<string, string>)['Content-Type'] = type",
    "    init.body = type === 'application/x-www-form-urlencoded' ? new URLSearchParams(options.body as Record<string, string>) : JSON.stringify(options.body)",
    '  }',
    '  const response = await fetch(url, init)',
    '  const text = await response.text()',
    '  let body: any = text',
    '  try {',
    '    body = JSON.parse(text)',
    '  } catch {}',
    '  return { status: response.status, headers: response.headers, body, url: response.url }',
    '}',
    '',
    'function check(passed: boolean, step: string, condition: string) {',
    '  if (!passed) throw new Error(`${step} failed: ${condition}`)',
    '}',
  ]
  prepare(workflow, model).forEach(({ step, operation, path, query, headers, criteria }, index) => {
    lines.push('', `// ${index + 1}. ${step.stepId}${operation ? ` — ${operation.method.toUpperCase()} ${operation.path}` : ''}${step.description ? `: ${step.description}` : ''}`)
    lines.push(...notes(step, '//'))
    if (!operation) {
      lines.push(`// ${step.workflowId ? `Calls workflow ${step.workflowId}` : `Operation ${step.operationId ?? step.operationPath} not found`}; not exported.`)
      return
    }
    const options: string[] = []
    if (Object.keys(query).length) options.push(`query: ${valueCode(query, 'ts', '  ')}`)
    if (Object.keys(headers).length) options.push(`headers: ${valueCode(headers, 'ts', '  ')}`)
    if (step.requestBody?.payload !== undefined) {
      options.push(`body: ${valueCode(step.requestBody.payload, 'ts', '  ')}`)
      const type = step.requestBody.contentType ?? operation.requestBody?.content[0]?.mediaType
      if (type && type !== 'application/json') options.push(`contentType: ${JSON.stringify(type)}`)
    }
    lines.push('{')
    lines.push(`  const res = await call(${JSON.stringify(operation.method.toUpperCase())}, ${pathCode(operation, path, 'ts')}${options.length ? `, { ${options.join(', ')} }` : ''})`)
    for (const condition of criteria) lines.push(`  check(${conditionCode(parseCondition(condition), 'ts')}, ${JSON.stringify(step.stepId)}, ${JSON.stringify(condition)})`)
    lines.push(`  steps.${IDENTIFIER.test(step.stepId) ? step.stepId : `[${JSON.stringify(step.stepId)}]`} = ${valueCode(step.outputs ?? {}, 'ts', '  ')}`)
    lines.push('}')
  })
  lines.push('', workflow.outputs ? `console.log(${valueCode(workflow.outputs, 'ts')})` : 'console.log(steps)', '')
  return lines.join('\n')
}

function python(doc: ArazzoDocument, workflow: ArazzoWorkflow, model: ApiModel, baseUrl: string): string {
  const lines = [
    `"""${(workflow.summary ?? workflow.workflowId).replace(/"""/g, '')}`,
    '',
    `Generated by apidoc from "${doc.info.title}" (Arazzo ${doc.arazzo}), workflow "${workflow.workflowId}".`,
    'Run: pip install requests && BASE_URL=https://api.example.com python workflow.py',
    '"""',
    '',
    'import json',
    'import os',
    'from urllib.parse import quote',
    '',
    'import requests',
    '',
    `BASE_URL = os.environ.get("BASE_URL", ${JSON.stringify(baseUrl)}).rstrip("/")`,
    '# Add credentials here, e.g. {"Authorization": "Bearer " + os.environ["API_TOKEN"]}',
    'HEADERS = {}',
    `inputs = ${valueCode(defaultInputs(workflow, doc), 'py')}`,
    'steps = {}',
    '',
    '',
    'def call(method, path, query=None, headers=None, body=None, content_type="application/json"):',
    '    kwargs = {"params": query, "headers": {**HEADERS, **(headers or {})}}',
    '    if body is not None:',
    '        if content_type == "application/x-www-form-urlencoded":',
    '            kwargs["data"] = body',
    '        else:',
    '            kwargs["json"] = body',
    '    response = requests.request(method, BASE_URL + path, **kwargs)',
    '    try:',
    '        parsed = response.json()',
    '    except ValueError:',
    '        parsed = response.text',
    '    return {"status": response.status_code, "headers": response.headers, "body": parsed, "url": response.url}',
    '',
    '',
    'def check(passed, step, condition):',
    '    if not passed:',
    '        raise SystemExit(f"{step} failed: {condition}")',
  ]
  prepare(workflow, model).forEach(({ step, operation, path, query, headers, criteria }, index) => {
    lines.push('', '', `# ${index + 1}. ${step.stepId}${operation ? `: ${operation.method.toUpperCase()} ${operation.path}` : ''}${step.description ? ` (${step.description})` : ''}`)
    lines.push(...notes(step, '#'))
    if (!operation) {
      lines.push(`# ${step.workflowId ? `Calls workflow ${step.workflowId}` : `Operation ${step.operationId ?? step.operationPath} not found`}; not exported.`)
      return
    }
    const args = [JSON.stringify(operation.method.toUpperCase()), pathCode(operation, path, 'py')]
    if (Object.keys(query).length) args.push(`query=${valueCode(query, 'py')}`)
    if (Object.keys(headers).length) args.push(`headers=${valueCode(headers, 'py')}`)
    if (step.requestBody?.payload !== undefined) {
      args.push(`body=${valueCode(step.requestBody.payload, 'py')}`)
      const type = step.requestBody.contentType ?? operation.requestBody?.content[0]?.mediaType
      if (type && type !== 'application/json') args.push(`content_type=${JSON.stringify(type)}`)
    }
    lines.push(`res = call(${args.join(', ')})`)
    for (const condition of criteria) lines.push(`check(${conditionCode(parseCondition(condition), 'py')}, ${JSON.stringify(step.stepId)}, ${JSON.stringify(condition)})`)
    lines.push(`steps[${JSON.stringify(step.stepId)}] = ${valueCode(step.outputs ?? {}, 'py')}`)
  })
  lines.push('', '', `print(json.dumps(${workflow.outputs ? valueCode(workflow.outputs, 'py') : 'steps'}, indent=2, default=str))`, '')
  return lines.join('\n')
}

/** Type of the value at a JSON pointer inside a response schema ("string", "integer"…), if known. */
function typeAt(schema: SchemaObject | undefined, keys: (string | number)[], resolver: Resolver): string | undefined {
  let current = unwrapNullable(schema, resolver)
  for (const key of keys) {
    if (!current) return undefined
    if (typeof key === 'number') current = unwrapNullable(current.items, resolver)
    else current = unwrapNullable(objectProperties(current, resolver).find(p => p.name === key)?.schema, resolver)
  }
  return current ? schemaTypes(current)[0] : undefined
}

function http(doc: ArazzoDocument, workflow: ArazzoWorkflow, model: ApiModel, baseUrl: string): string {
  const resolver = new Resolver(model.document)
  const prepared = prepare(workflow, model)
  const inputs = defaultInputs(workflow, doc)
  const lines = [
    `# ${workflow.summary ?? workflow.workflowId}`,
    `# Generated by apidoc from "${doc.info.title}" (Arazzo ${doc.arazzo}). For the VS Code REST Client extension.`,
    '',
    `@baseUrl = ${baseUrl.replace(/\/$/, '')}`,
    ...Object.entries(inputs).map(([name, value]) => `@${name} = ${typeof value === 'string' ? value : JSON.stringify(value)}`),
  ]
  /** REST Client reference for an expression, and whether its value is a JSON string. */
  const reference = (expression: string): { text: string; quoted: boolean } => {
    const [root, ...rest] = expression.split('#')[0]!.slice(1).split('.')
    if (root === 'inputs' && rest.length === 1) return { text: `{{${rest[0]}}}`, quoted: typeof inputs[rest[0]!] === 'string' || inputs[rest[0]!] === undefined }
    if (root === 'steps' && rest[1] === 'outputs') {
      const source = prepared.find(p => p.step.stepId === rest[0])
      const output = source?.step.outputs?.[rest[2]!]
      const hash = output?.indexOf('#') ?? -1
      if (output && output.startsWith('$response.body')) {
        const keys = hash === -1 ? [] : pointerKeys(output.slice(hash + 1))
        const success = source?.operation?.responses.find(r => r.status.startsWith('2'))
        const type = typeAt(success?.content[0]?.schema, keys, resolver)
        return { text: `{{${rest[0]}.response.body.$${keys.map(k => (typeof k === 'number' ? `[${k}]` : `.${k}`)).join('')}}}`, quoted: type === undefined || type === 'string' }
      }
      if (output?.startsWith('$response.header.')) return { text: `{{${rest[0]}.response.headers.${output.slice('$response.header.'.length)}}}`, quoted: true }
    }
    return { text: `{{UNSUPPORTED ${expression}}}`, quoted: true }
  }
  const substitute = (value: unknown): string => {
    if (isExpression(value)) return reference(value).text
    if (typeof value === 'string') return value.replace(EMBEDDED, (_, expression: string) => reference(expression).text)
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
  const bodyText = (payload: unknown): string => {
    // Expression placeholders keep their JSON quoting when the value is a string.
    const placeholders: string[] = []
    const walk = (value: unknown): unknown => {
      if (isExpression(value)) {
        placeholders.push(value)
        return `__apidoc_${placeholders.length - 1}__`
      }
      if (typeof value === 'string') return substitute(value)
      if (Array.isArray(value)) return value.map(walk)
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]))
      return value
    }
    return JSON.stringify(walk(payload), null, 2).replace(/"__apidoc_(\d+)__"/g, (_, i: string) => {
      const ref = reference(placeholders[Number(i)]!)
      return ref.quoted ? `"${ref.text}"` : ref.text
    })
  }
  prepared.forEach(({ step, operation, path, query, headers, criteria }, index) => {
    lines.push('', `### ${index + 1}. ${step.stepId}${step.description ? `: ${step.description}` : ''}`)
    if (!operation) {
      lines.push(`# ${step.workflowId ? `Calls workflow ${step.workflowId}` : `Operation not found`}; not exported.`)
      return
    }
    lines.push(`# @name ${step.stepId}`, ...criteria.map(c => `# expect: ${c}`), ...notes(step, '#'))
    const target = operation.path.replace(/\{([^}]+)\}/g, (match, name: string) => (name in path ? substitute(path[name]) : match))
    const search = Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${substitute(v)}`).join('&')
    lines.push(`${operation.method.toUpperCase()} {{baseUrl}}${target}${search ? `?${search}` : ''}`)
    for (const [name, value] of Object.entries(headers)) lines.push(`${name}: ${substitute(value)}`)
    if (step.requestBody?.payload !== undefined) {
      const type = step.requestBody.contentType ?? operation.requestBody?.content[0]?.mediaType ?? 'application/json'
      lines.push(`Content-Type: ${type}`, '', /json/.test(type) ? bodyText(step.requestBody.payload) : substitute(step.requestBody.payload))
    }
  })
  return lines.join('\n') + '\n'
}

export function exportWorkflow(format: WorkflowExportFormat, doc: ArazzoDocument, workflowId: string, model: ApiModel, baseUrl: string): string {
  const workflow = doc.workflows.find(w => w.workflowId === workflowId)
  if (!workflow) throw new Error(`No workflow "${workflowId}"`)
  if (format === 'typescript') return typescript(doc, workflow, model, baseUrl)
  if (format === 'python') return python(doc, workflow, model, baseUrl)
  return http(doc, workflow, model, baseUrl)
}
