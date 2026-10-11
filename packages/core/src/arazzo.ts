import { parseSpecText } from './load'
import { buildRequest, type HttpRequestSpec } from './request'
import type { ApiModel, JsonObject, OperationModel, SchemaObject } from './types'
import { deepEqual } from './validate'

/**
 * Arazzo 1.0 workflows: sequences of API calls where later steps use values
 * from earlier ones (`$steps.createCustomer.outputs.customerId`).
 * https://spec.openapis.org/arazzo/latest.html
 */

export interface ArazzoParameter {
  name: string
  in?: 'path' | 'query' | 'header' | 'cookie'
  value: unknown
}

export interface ArazzoCriterion {
  condition: string
  context?: string
  type?: 'simple' | 'regex' | 'jsonpath' | 'xpath' | { type: string }
}

export interface ArazzoAction {
  name?: string
  type: 'end' | 'goto' | 'retry'
  stepId?: string
  workflowId?: string
  retryAfter?: number
  retryLimit?: number
  criteria?: ArazzoCriterion[]
}

export interface ArazzoStep {
  stepId: string
  description?: string
  operationId?: string
  operationPath?: string
  workflowId?: string
  parameters?: (ArazzoParameter | { reference: string; value?: unknown })[]
  requestBody?: { contentType?: string; payload?: unknown; replacements?: { target: string; value: unknown }[] }
  successCriteria?: ArazzoCriterion[]
  onSuccess?: ArazzoAction[]
  onFailure?: ArazzoAction[]
  outputs?: Record<string, string>
}

export interface ArazzoWorkflow {
  workflowId: string
  summary?: string
  description?: string
  inputs?: SchemaObject
  dependsOn?: string[]
  parameters?: ArazzoParameter[]
  steps: ArazzoStep[]
  outputs?: Record<string, string>
}

export interface ArazzoDocument {
  arazzo: string
  info: { title: string; version?: string; summary?: string; description?: string }
  sourceDescriptions: { name: string; url: string; type?: string }[]
  workflows: ArazzoWorkflow[]
  components?: { parameters?: Record<string, ArazzoParameter>; inputs?: Record<string, SchemaObject> }
}

export class WorkflowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowError'
  }
}

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Parse an Arazzo 1.x document from JSON/YAML text or an object. */
export function parseArazzo(input: string | JsonObject): ArazzoDocument {
  const doc = typeof input === 'string' ? parseSpecText(input) : input
  if (typeof doc.arazzo !== 'string' || !doc.arazzo.startsWith('1.')) throw new WorkflowError('Not an Arazzo 1.x document: expected an "arazzo: 1.0.x" field.')
  if (!Array.isArray(doc.workflows) || !doc.workflows.length) throw new WorkflowError('The Arazzo document has no workflows.')
  for (const workflow of doc.workflows as JsonObject[]) {
    if (typeof workflow.workflowId !== 'string') throw new WorkflowError('Every workflow needs a workflowId.')
    if (!Array.isArray(workflow.steps) || !workflow.steps.length) throw new WorkflowError(`Workflow ${workflow.workflowId} has no steps.`)
    for (const step of workflow.steps as JsonObject[]) {
      if (typeof step.stepId !== 'string') throw new WorkflowError(`A step in ${workflow.workflowId} has no stepId.`)
      const targets = ['operationId', 'operationPath', 'workflowId'].filter(key => typeof step[key] === 'string')
      if (targets.length !== 1) throw new WorkflowError(`Step ${workflow.workflowId}.${step.stepId} needs exactly one of operationId, operationPath or workflowId.`)
    }
  }
  return {
    arazzo: doc.arazzo,
    info: isObject(doc.info) ? (doc.info as ArazzoDocument['info']) : { title: 'Workflows' },
    sourceDescriptions: Array.isArray(doc.sourceDescriptions) ? (doc.sourceDescriptions as ArazzoDocument['sourceDescriptions']) : [],
    workflows: doc.workflows as ArazzoWorkflow[],
    components: isObject(doc.components) ? (doc.components as ArazzoDocument['components']) : undefined,
  }
}

// ---------------------------------------------------------------------------
// Runtime expressions

export interface StepResponse {
  status: number
  headers: [string, string][]
  body: string
  json?: unknown
}

export interface ExpressionContext {
  inputs: Record<string, unknown>
  steps: Record<string, { outputs: Record<string, unknown> }>
  outputs?: Record<string, unknown>
  request?: HttpRequestSpec & { pathParams: Record<string, string>; query: Record<string, string> }
  response?: StepResponse
}

const decodePointer = (segment: string) => segment.replace(/~1/g, '/').replace(/~0/g, '~')

function pointer(value: unknown, path: string, expression: string): unknown {
  let current = value
  for (const segment of path.split('/').slice(1).map(decodePointer)) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) current = current[Number(segment)]
    else if (isObject(current) && segment in current) current = current[segment]
    else throw new WorkflowError(`${expression}: nothing at /${path.split('/').slice(1).join('/')}`)
  }
  return current
}

function dotted(value: unknown, keys: string[], expression: string): unknown {
  let current = value
  for (const key of keys) {
    if (isObject(current) && key in current) current = current[key]
    else if (Array.isArray(current) && /^\d+$/.test(key)) current = current[Number(key)]
    else throw new WorkflowError(`${expression} is not available (no "${key}")`)
  }
  return current
}

const bodyOf = (response: StepResponse) => (response.json !== undefined ? response.json : response.body)

/** Evaluate one runtime expression such as `$response.body#/id` or `$steps.a.outputs.b`. */
export function evaluateExpression(expression: string, ctx: ExpressionContext): unknown {
  const hash = expression.indexOf('#')
  const base = hash === -1 ? expression : expression.slice(0, hash)
  const path = hash === -1 ? undefined : expression.slice(hash + 1)
  const [root, ...rest] = base.slice(1).split('.')
  let value: unknown
  switch (root) {
    case 'statusCode':
      if (!ctx.response) throw new WorkflowError('$statusCode is only available after a request')
      value = ctx.response.status
      break
    case 'url':
      value = ctx.request?.url
      break
    case 'method':
      value = ctx.request?.method
      break
    case 'inputs':
      value = dotted(ctx.inputs, rest, expression)
      break
    case 'outputs':
      value = dotted(ctx.outputs ?? {}, rest, expression)
      break
    case 'steps': {
      const [stepId, kind, ...keys] = rest
      const step = stepId ? ctx.steps[stepId] : undefined
      if (!step) throw new WorkflowError(`${expression}: step "${stepId}" has not run`)
      if (kind !== 'outputs') throw new WorkflowError(`${expression}: only step outputs can be referenced`)
      value = dotted(step.outputs, keys, expression)
      break
    }
    case 'response': {
      const response = ctx.response
      if (!response) throw new WorkflowError(`${expression} is only available after a request`)
      const [part, ...name] = rest
      if (part === 'body') value = bodyOf(response)
      else if (part === 'header') value = response.headers.find(([k]) => k.toLowerCase() === name.join('.').toLowerCase())?.[1]
      else throw new WorkflowError(`Unsupported expression ${expression}`)
      break
    }
    case 'request': {
      const request = ctx.request
      if (!request) throw new WorkflowError(`${expression} is only available during a request`)
      const [part, ...name] = rest
      const key = name.join('.')
      if (part === 'body') value = request.body === undefined ? undefined : safeJson(request.body)
      else if (part === 'header') value = request.headers.find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1]
      else if (part === 'query') value = request.query[key]
      else if (part === 'path') value = request.pathParams[key]
      else throw new WorkflowError(`Unsupported expression ${expression}`)
      break
    }
    default:
      throw new WorkflowError(`Unsupported expression ${expression}`)
  }
  return path !== undefined ? pointer(value, path, expression) : value
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const FULL_EXPRESSION = /^\$[A-Za-z][\w.\-#/~]*$/
const EMBEDDED_EXPRESSION = /\{(\$[A-Za-z][^{}]*)\}/g

export const isExpression = (value: unknown): value is string => typeof value === 'string' && FULL_EXPRESSION.test(value)

/** Resolve expressions inside a value: whole-string expressions keep their type, `{$...}` interpolates. */
export function resolveValue(value: unknown, ctx: ExpressionContext): unknown {
  if (isExpression(value)) return evaluateExpression(value, ctx)
  if (typeof value === 'string') return value.replace(EMBEDDED_EXPRESSION, (_, expression: string) => stringify(evaluateExpression(expression, ctx)))
  if (Array.isArray(value)) return value.map(item => resolveValue(item, ctx))
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveValue(v, ctx)]))
  return value
}

const stringify = (value: unknown) => (typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value))

// ---------------------------------------------------------------------------
// Conditions: `$statusCode == 201 && $response.body#/status != 'failed'`

export type ConditionNode =
  | { kind: 'literal'; value: unknown }
  | { kind: 'expression'; expression: string }
  | { kind: 'not'; operand: ConditionNode }
  | { kind: 'binary'; operator: '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||'; left: ConditionNode; right: ConditionNode }

const TOKEN = /\s*(\$[^\s()=!<>&|]+|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|==|!=|<=|>=|&&|\|\||[<>!()]|true\b|false\b|null\b)/y

export function parseCondition(source: string): ConditionNode {
  const tokens: string[] = []
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < source.length) {
    const start = TOKEN.lastIndex
    const match = TOKEN.exec(source)
    if (!match) {
      if (!source.slice(start).trim()) break
      throw new WorkflowError(`Cannot parse condition "${source}" near "${source.slice(start).trim()}"`)
    }
    tokens.push(match[1]!)
  }
  let index = 0
  const peek = () => tokens[index]
  const take = () => tokens[index++]

  const primary = (): ConditionNode => {
    const token = take()
    if (token === undefined) throw new WorkflowError(`Condition "${source}" ends unexpectedly`)
    if (token === '(') {
      const node = or()
      if (take() !== ')') throw new WorkflowError(`Missing ) in condition "${source}"`)
      return node
    }
    if (token === '!') return { kind: 'not', operand: primary() }
    if (token.startsWith('$')) return { kind: 'expression', expression: token }
    if (token.startsWith("'") || token.startsWith('"')) return { kind: 'literal', value: token.slice(1, -1).replace(/\\(.)/g, '$1') }
    if (token === 'true' || token === 'false') return { kind: 'literal', value: token === 'true' }
    if (token === 'null') return { kind: 'literal', value: null }
    if (/^-?\d/.test(token)) return { kind: 'literal', value: Number(token) }
    throw new WorkflowError(`Unexpected "${token}" in condition "${source}"`)
  }
  const comparison = (): ConditionNode => {
    const left = primary()
    const operator = peek()
    if (operator && ['==', '!=', '<', '<=', '>', '>='].includes(operator)) {
      take()
      return { kind: 'binary', operator: operator as '==', left, right: primary() }
    }
    return left
  }
  const and = (): ConditionNode => {
    let node = comparison()
    while (peek() === '&&') {
      take()
      node = { kind: 'binary', operator: '&&', left: node, right: comparison() }
    }
    return node
  }
  const or = (): ConditionNode => {
    let node = and()
    while (peek() === '||') {
      take()
      node = { kind: 'binary', operator: '||', left: node, right: and() }
    }
    return node
  }
  const tree = or()
  if (index < tokens.length) throw new WorkflowError(`Unexpected "${tokens[index]}" in condition "${source}"`)
  return tree
}

function evaluateNode(node: ConditionNode, ctx: ExpressionContext): unknown {
  switch (node.kind) {
    case 'literal':
      return node.value
    case 'expression':
      return evaluateExpression(node.expression, ctx)
    case 'not':
      return !evaluateNode(node.operand, ctx)
    case 'binary': {
      if (node.operator === '&&') return Boolean(evaluateNode(node.left, ctx)) && Boolean(evaluateNode(node.right, ctx))
      if (node.operator === '||') return Boolean(evaluateNode(node.left, ctx)) || Boolean(evaluateNode(node.right, ctx))
      const left = evaluateNode(node.left, ctx)
      const right = evaluateNode(node.right, ctx)
      // Numbers compare numerically even when one side came from a header or path (a string).
      const numeric = typeof left === 'number' || typeof right === 'number'
      const a = numeric && left !== null && left !== '' ? Number(left) : left
      const b = numeric && right !== null && right !== '' ? Number(right) : right
      switch (node.operator) {
        case '==':
          return deepEqual(a, b)
        case '!=':
          return !deepEqual(a, b)
        case '<':
          return (a as number) < (b as number)
        case '<=':
          return (a as number) <= (b as number)
        case '>':
          return (a as number) > (b as number)
        case '>=':
          return (a as number) >= (b as number)
      }
    }
  }
}

export interface CriterionResult {
  condition: string
  passed: boolean
  error?: string
}

export function checkCriterion(criterion: ArazzoCriterion, ctx: ExpressionContext): CriterionResult {
  const type = typeof criterion.type === 'object' ? criterion.type.type : criterion.type ?? 'simple'
  const label = criterion.context ? `${criterion.context} ~ ${criterion.condition}` : criterion.condition
  try {
    if (type === 'simple') return { condition: label, passed: Boolean(evaluateNode(parseCondition(criterion.condition), ctx)) }
    if (type === 'regex') {
      const subject = criterion.context ? evaluateExpression(criterion.context, ctx) : undefined
      return { condition: label, passed: new RegExp(criterion.condition).test(stringify(subject)) }
    }
    return { condition: label, passed: false, error: `${type} criteria are not supported yet` }
  } catch (error) {
    return { condition: label, passed: false, error: (error as Error).message }
  }
}

// ---------------------------------------------------------------------------
// Running

export type StepStatus = 'pending' | 'running' | 'waiting' | 'passed' | 'failed' | 'skipped'

export interface StepRun {
  stepId: string
  description?: string
  status: StepStatus
  operation?: { method: string; path: string; id: string; operationId?: string }
  request?: HttpRequestSpec
  response?: StepResponse
  durationMs?: number
  outputs: Record<string, unknown>
  criteria: CriterionResult[]
  attempt: number
  error?: string
}

export interface WorkflowRun {
  workflowId: string
  status: 'running' | 'passed' | 'failed' | 'cancelled'
  steps: StepRun[]
  outputs: Record<string, unknown>
  error?: string
}

export interface RunOptions {
  model: ApiModel
  baseUrl: string
  inputs?: Record<string, unknown>
  /** Perform the HTTP request (browser fetch, Node fetch, a test double…). */
  send: (request: HttpRequestSpec) => Promise<StepResponse>
  /** Add credentials etc. before sending. */
  prepare?: (request: HttpRequestSpec, operation: OperationModel) => HttpRequestSpec
  /** Called whenever the run changes (for live UI). */
  onUpdate?: (run: WorkflowRun) => void
  /** Awaited before each step; resolve to continue ("step through"). */
  beforeStep?: (step: ArazzoStep, index: number) => Promise<void>
  signal?: AbortSignal
  /** Upper bound for retryAfter waits, in seconds. */
  maxRetryWait?: number
}

const MAX_STEP_EXECUTIONS = 200

/** Default input values from the workflow's input schema (`default`, then `examples`/`example`). */
export function defaultInputs(workflow: ArazzoWorkflow, doc?: ArazzoDocument): Record<string, unknown> {
  let schema = workflow.inputs
  const ref = schema?.$ref?.match(/^#\/components\/inputs\/(.+)$/)
  if (ref && doc?.components?.inputs?.[ref[1]!]) schema = doc.components.inputs[ref[1]!]
  const out: Record<string, unknown> = {}
  for (const [name, property] of Object.entries(schema?.properties ?? {})) {
    const value = property.default ?? property.examples?.[0] ?? property.example
    if (value !== undefined) out[name] = value
  }
  return out
}

/** Find the operation a step calls, by operationId or operationPath (`…#/paths/~1pets/get`). */
export function findOperation(step: ArazzoStep, model: ApiModel): OperationModel | undefined {
  if (step.operationId) {
    // "$sourceDescriptions.petStore.getPet" or a bare "getPet".
    const id = step.operationId.startsWith('$sourceDescriptions.') ? step.operationId.split('.').slice(2).join('.') : step.operationId
    return model.operations.find(op => op.operationId === id)
  }
  if (step.operationPath) {
    const match = step.operationPath.match(/#\/paths\/([^/]+)\/(\w+)$/)
    if (!match) return undefined
    const path = decodePointer(decodeURIComponent(match[1]!))
    return model.operations.find(op => op.path === path && op.method === match[2]!.toLowerCase())
  }
  return undefined
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
}

function serializeBody(payload: unknown, contentType: string | undefined): string | undefined {
  if (payload === undefined) return undefined
  if (contentType === 'application/x-www-form-urlencoded' && isObject(payload)) {
    return new URLSearchParams(Object.entries(payload).map(([k, v]): [string, string] => [k, stringify(v)])).toString()
  }
  if (typeof payload === 'string' && !(contentType && /json/i.test(contentType))) return payload
  return JSON.stringify(payload)
}

function applyReplacements(payload: unknown, replacements: { target: string; value: unknown }[], ctx: ExpressionContext): unknown {
  const copy = structuredClone(payload)
  for (const { target, value } of replacements) {
    const keys = target.split('/').slice(1).map(decodePointer)
    const last = keys.pop()
    let parent = copy as Record<string, unknown>
    for (const key of keys) parent = parent?.[key] as Record<string, unknown>
    if (parent && last !== undefined) parent[last] = resolveValue(value, ctx)
  }
  return copy
}

/** Run one workflow from an Arazzo document. Never throws for API failures; they end up in the run. */
export async function runWorkflow(doc: ArazzoDocument, workflowId: string, options: RunOptions): Promise<WorkflowRun> {
  const workflow = doc.workflows.find(w => w.workflowId === workflowId)
  if (!workflow) throw new WorkflowError(`No workflow "${workflowId}"`)
  const run: WorkflowRun = {
    workflowId,
    status: 'running',
    steps: workflow.steps.map(step => {
      // Known up front so pending and skipped steps can show what they would call.
      const operation = findOperation(step, options.model)
      return {
        stepId: step.stepId,
        description: step.description,
        status: 'pending',
        operation: operation && { method: operation.method.toUpperCase(), path: operation.path, id: operation.id, operationId: operation.operationId },
        outputs: {},
        criteria: [],
        attempt: 0,
      }
    }),
    outputs: {},
  }
  const update = () => options.onUpdate?.(structuredClone(run))
  const ctx: ExpressionContext = { inputs: { ...defaultInputs(workflow, doc), ...options.inputs }, steps: {} }
  update()

  let index = 0
  let executions = 0
  let ended = false
  try {
    while (index < workflow.steps.length && !ended) {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      if (++executions > MAX_STEP_EXECUTIONS) throw new WorkflowError(`Stopped after ${MAX_STEP_EXECUTIONS} step executions (a goto loop?)`)
      const step = workflow.steps[index]!
      const result = run.steps[index]!
      await options.beforeStep?.(step, index)
      // Cancelling while paused between steps must not run the next one.
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      result.attempt += 1
      result.status = 'running'
      result.error = undefined
      update()

      const passed = await executeStep(step, result, ctx, workflow, doc, options)
      ctx.steps[step.stepId] = { outputs: result.outputs }
      result.status = passed ? 'passed' : 'failed'
      update()

      // onSuccess / onFailure: the first action whose criteria hold decides what happens next.
      const actions = (passed ? step.onSuccess : step.onFailure) ?? []
      const action = actions.find(a => (a.criteria ?? []).every(c => checkCriterion(c, ctx).passed))
      ctx.response = undefined
      if (!action) {
        if (!passed) {
          run.status = 'failed'
          run.error = `Step ${step.stepId} failed`
          ended = true
        } else index += 1
        continue
      }
      if (action.type === 'end') {
        if (!passed) {
          run.status = 'failed'
          run.error = `Step ${step.stepId} failed`
        }
        ended = true
      } else if (action.type === 'goto') {
        const target = workflow.steps.findIndex(s => s.stepId === action.stepId)
        if (target === -1) throw new WorkflowError(`goto: no step "${action.stepId ?? action.workflowId}" in ${workflowId}`)
        index = target
      } else if (action.type === 'retry') {
        const limit = action.retryLimit ?? 1
        if (result.attempt > limit) {
          run.status = 'failed'
          run.error = `Step ${step.stepId} failed after ${result.attempt} attempts`
          ended = true
        } else {
          result.status = 'waiting'
          update()
          await sleep(Math.min(action.retryAfter ?? 0, options.maxRetryWait ?? 30) * 1000, options.signal)
          if (action.stepId) index = Math.max(0, workflow.steps.findIndex(s => s.stepId === action.stepId))
        }
      }
    }
    for (const result of run.steps) if (result.status === 'pending') result.status = 'skipped'
    if (run.status === 'running') {
      run.status = 'passed'
      for (const [name, expression] of Object.entries(workflow.outputs ?? {})) {
        try {
          run.outputs[name] = resolveValue(expression, ctx)
        } catch (error) {
          run.status = 'failed'
          run.error = `Workflow output ${name}: ${(error as Error).message}`
        }
      }
    }
  } catch (error) {
    const aborted = (error as Error).name === 'AbortError'
    run.status = aborted ? 'cancelled' : 'failed'
    run.error = aborted ? 'Cancelled' : (error as Error).message
    for (const result of run.steps) if (result.status === 'pending' || result.status === 'running' || result.status === 'waiting') result.status = 'skipped'
  }
  update()
  return run
}

async function executeStep(step: ArazzoStep, result: StepRun, ctx: ExpressionContext, workflow: ArazzoWorkflow, doc: ArazzoDocument, options: RunOptions): Promise<boolean> {
  result.criteria = []
  result.outputs = {}
  try {
    // Parameters: workflow-level ones apply to every step; step-level ones override by name + location.
    const parameters = [...(workflow.parameters ?? []), ...(step.parameters ?? [])].map(p => {
      if ('reference' in p) {
        const name = p.reference.replace(/^\$components\.parameters\./, '')
        const shared = doc.components?.parameters?.[name]
        if (!shared) throw new WorkflowError(`Unknown parameter reference ${p.reference}`)
        return { ...shared, value: p.value ?? shared.value }
      }
      return p
    })

    if (step.workflowId) {
      // Nested workflow: parameters become its inputs.
      const inputs = Object.fromEntries(parameters.map(p => [p.name, resolveValue(p.value, ctx)]))
      const nested = await runWorkflow(doc, step.workflowId, { ...options, inputs, onUpdate: undefined, beforeStep: undefined })
      if (nested.status !== 'passed') {
        result.outputs = nested.outputs
        result.error = nested.error ?? `Workflow ${step.workflowId} ${nested.status}`
        return false
      }
      // A workflow step's outputs read the called workflow's outputs as `$outputs.<name>`.
      if (!step.outputs) {
        result.outputs = nested.outputs
        return true
      }
      return evaluateOutputs(step, result, { ...ctx, outputs: nested.outputs })
    }

    const operation = findOperation(step, options.model)
    if (!operation) throw new WorkflowError(`Operation ${step.operationId ?? step.operationPath} is not in the loaded API description`)
    result.operation = { method: operation.method.toUpperCase(), path: operation.path, id: operation.id, operationId: operation.operationId }

    const pathParams: Record<string, string> = {}
    const query: Record<string, string> = {}
    const headers: Record<string, string> = {}
    const cookies: Record<string, string> = {}
    for (const parameter of parameters) {
      const location = parameter.in ?? operation.parameters.find(p => p.name === parameter.name)?.in ?? 'query'
      const value = stringify(resolveValue(parameter.value, ctx))
      ;({ path: pathParams, query, header: headers, cookie: cookies })[location][parameter.name] = value
    }
    let payload = step.requestBody?.payload === undefined ? undefined : resolveValue(step.requestBody.payload, ctx)
    if (payload !== undefined && step.requestBody?.replacements?.length) payload = applyReplacements(payload, step.requestBody.replacements, ctx)
    const contentType = step.requestBody?.contentType ?? (payload === undefined ? undefined : operation.requestBody?.content[0]?.mediaType ?? 'application/json')

    let request = buildRequest(operation, { baseUrl: options.baseUrl, pathParams, query, headers, cookies, body: serializeBody(payload, contentType), contentType })
    if (options.prepare) request = options.prepare(request, operation)
    result.request = request
    ctx.request = { ...request, pathParams, query }

    const started = Date.now()
    const response = await options.send(request)
    result.durationMs = Date.now() - started
    result.response = response
    ctx.response = response

    const criteria = step.successCriteria?.length ? step.successCriteria : [{ condition: '$statusCode >= 200 && $statusCode < 300' }]
    result.criteria = criteria.map(c => checkCriterion(c, ctx))
    if (result.criteria.some(c => !c.passed)) {
      result.error = result.criteria.find(c => c.error)?.error
      return false
    }
    return evaluateOutputs(step, result, ctx)
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    result.error = (error as Error).message
    return false
  }
}

function evaluateOutputs(step: ArazzoStep, result: StepRun, ctx: ExpressionContext): boolean {
  for (const [name, expression] of Object.entries(step.outputs ?? {})) {
    try {
      result.outputs[name] = resolveValue(expression, ctx)
    } catch (error) {
      result.error = `Output ${name}: ${(error as Error).message}`
      return false
    }
  }
  return true
}
