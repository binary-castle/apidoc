/**
 * An in-memory Orbit sandbox (examples/specs/orbit.yaml) for the hosted demo.
 * The service worker answers requests to the sandbox server with it, so "Try
 * it", the contract check and the Arazzo workflows all work without a backend.
 *
 * It behaves like the documented API, with one deliberate exception for the
 * contract check to find: "Retrieve a customer" returns an undocumented
 * `tax_exempt` field.
 */

export const SANDBOX_ORIGIN = 'https://api.sandbox.orbit.dev'

interface Address {
  line1: string
  city?: string
  postal_code?: string
  country?: string
}

interface Customer {
  id: string
  object: 'customer'
  email: string
  name: string | null
  balance: number
  livemode: false
  address?: Address
  metadata: Record<string, string>
  created: number
}

interface PaymentIntent {
  id: string
  amount: number
  currency: string
  status: 'requires_payment_method' | 'requires_confirmation' | 'processing' | 'succeeded' | 'canceled'
  customer: string
}

interface Invoice {
  id: string
  status: 'draft' | 'open' | 'paid' | 'void'
  total: number
  lines: { description: string; amount: number; tax_rate: number | null }[]
}

interface Stored {
  status: number
  headers: Record<string, string>
  body: string
}

const COUNTRY = /^[A-Z]{2}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CURRENCIES = ['gbp', 'usd', 'eur']
const REFUND_REASONS = ['duplicate', 'fraudulent', 'requested_by_customer']

export interface SandboxOptions {
  /** Milliseconds; a little latency makes the timings in the UI realistic. */
  latency?: () => number
  now?: () => number
  random?: () => number
}

export function createSandbox(options: SandboxOptions = {}) {
  const now = options.now ?? (() => Date.now())
  const random = options.random ?? Math.random
  const latency = options.latency ?? (() => 40 + Math.round(random() * 120))
  const seconds = () => Math.floor(now() / 1000)
  const id = (prefix: string) => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789'
    let out = `${prefix}_`
    for (let i = 0; i < 14; i++) out += alphabet[Math.floor(random() * alphabet.length)]
    return out
  }

  const customers = new Map<string, Customer>()
  const payments = new Map<string, PaymentIntent>()
  const invoices: Invoice[] = []
  const idempotent = new Map<string, Stored>()

  // Seed data, so lists aren't empty on first visit.
  for (const [cid, email, name, created] of [
    ['cus_9Hq2LxP0aB', 'grace@hopper.dev', 'Grace Hopper', 1760140800],
    ['cus_Lq2mN8xR4tVbKd', 'katherine@johnson.dev', 'Katherine Johnson', 1760227200],
  ] as const) {
    customers.set(cid, { id: cid, object: 'customer', email, name, balance: 0, livemode: false, metadata: {}, created })
  }
  invoices.push(
    { id: 'in_1Pq7Rz2eZvKYlo2C', status: 'paid', total: 4900, lines: [{ description: 'Pro plan · October', amount: 4900, tax_rate: 0.2 }] },
    { id: 'in_1Pq7Sa2eZvKYlo2C', status: 'open', total: 12900, lines: [{ description: 'Team plan · October', amount: 9900, tax_rate: 0.2 }, { description: 'Extra seats × 3', amount: 3000, tax_rate: null }] },
    { id: 'in_1Pq7Sb2eZvKYlo2C', status: 'draft', total: 0, lines: [] },
  )

  const json = (status: number, body: unknown, headers: Record<string, string> = {}): Stored => ({
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: status === 204 ? '' : JSON.stringify(body),
  })
  const error = (status: number, type: string, message: string, extra: Record<string, string> = {}) => json(status, { type, message, ...extra })
  const invalid = (field: string, message: string) => error(422, 'validation_error', message, { field })
  const notFound = (what: string, value: string) => error(404, 'not_found', `No such ${what}: ${value}`)

  function validateCustomer(body: Record<string, unknown>, partial: boolean): Stored | undefined {
    if (!partial || 'email' in body) {
      if (typeof body.email !== 'string' || !EMAIL.test(body.email)) return invalid('email', 'email must be a valid email address')
    }
    if ('name' in body && body.name !== null && (typeof body.name !== 'string' || body.name.length > 256)) return invalid('name', 'name must be a string of at most 256 characters')
    if ('address' in body) {
      const address = body.address as Partial<Address> | null
      if (!address || typeof address !== 'object' || typeof address.line1 !== 'string') return invalid('address.line1', 'address.line1 is required')
      if (address.country !== undefined && (typeof address.country !== 'string' || !COUNTRY.test(address.country))) {
        return invalid('address.country', 'address.country must be an ISO-3166 alpha-2 code')
      }
    }
    if ('metadata' in body) {
      const metadata = body.metadata
      if (!metadata || typeof metadata !== 'object' || Object.values(metadata).some(v => typeof v !== 'string')) return invalid('metadata', 'metadata values must be strings')
    }
    return undefined
  }

  const routes: [string, RegExp, (match: RegExpMatchArray, request: Request, url: URL) => Promise<Stored> | Stored][] = [
    [
      'GET',
      /^\/v2\/customers$/,
      (_m, _r, url) => {
        const limit = clampLimit(url.searchParams.get('limit'))
        if (limit === undefined) return invalid('limit', 'limit must be an integer between 1 and 100')
        const email = url.searchParams.get('email')
        const since = Number(url.searchParams.get('created[gte]') ?? 0)
        const all = [...customers.values()].filter(c => (!email || c.email === email) && c.created >= since).sort((a, b) => b.created - a.created)
        return json(200, { data: all.slice(0, limit), has_more: all.length > limit })
      },
    ],
    [
      'POST',
      /^\/v2\/customers$/,
      async (_m, request) => {
        const body = await readJson(request)
        if (!body) return invalid('body', 'The request body must be a JSON object')
        const problem = validateCustomer(body, false)
        if (problem) return problem
        const existing = [...customers.values()].find(c => c.email === body.email)
        if (existing) return error(409, 'conflict', 'Email already in use.', { existing_id: existing.id })
        const customer: Customer = {
          id: id('cus'),
          object: 'customer',
          email: body.email as string,
          name: typeof body.name === 'string' ? body.name : null,
          balance: 0,
          livemode: false,
          ...(body.address ? { address: body.address as Address } : {}),
          metadata: (body.metadata as Record<string, string>) ?? {},
          created: seconds(),
        }
        customers.set(customer.id, customer)
        return json(201, customer)
      },
    ],
    [
      'GET',
      /^\/v2\/customers\/([^/]+)$/,
      ([, cid]) => {
        const customer = customers.get(cid!)
        // `tax_exempt` is not in the spec: the contract check reports it with a suggested patch.
        return customer ? json(200, { ...customer, tax_exempt: 'none' }) : notFound('customer', cid!)
      },
    ],
    [
      'PATCH',
      /^\/v2\/customers\/([^/]+)$/,
      async ([, cid], request) => {
        const customer = customers.get(cid!)
        if (!customer) return notFound('customer', cid!)
        const body = await readJson(request)
        if (!body) return invalid('body', 'The request body must be a JSON object')
        const problem = validateCustomer(body, true)
        if (problem) return problem
        if (typeof body.email === 'string' && body.email !== customer.email && [...customers.values()].some(c => c.email === body.email)) {
          return invalid('email', 'Email already in use.')
        }
        const updated: Customer = {
          ...customer,
          ...(typeof body.email === 'string' ? { email: body.email } : {}),
          ...('name' in body ? { name: (body.name as string | null) ?? null } : {}),
          ...(body.address ? { address: body.address as Address } : {}),
          ...(body.metadata ? { metadata: { ...customer.metadata, ...(body.metadata as Record<string, string>) } } : {}),
        }
        customers.set(updated.id, updated)
        return json(200, updated)
      },
    ],
    [
      'DELETE',
      /^\/v2\/customers\/([^/]+)$/,
      ([, cid]) => {
        // Deprecated endpoint: still works, and says so in standard headers.
        const sunset = { Deprecation: '@1772323200', Sunset: 'Mon, 01 Mar 2027 00:00:00 GMT' }
        if (!customers.delete(cid!)) return { ...notFound('customer', cid!), headers: { 'Content-Type': 'application/json', ...sunset } }
        return json(204, undefined, sunset)
      },
    ],
    [
      'POST',
      /^\/v2\/customers\/([^/]+)\/archive$/,
      ([, cid]) => {
        const customer = customers.get(cid!)
        if (!customer) return notFound('customer', cid!)
        const archived = { ...customer, metadata: { ...customer.metadata, archived: 'true' } }
        customers.set(archived.id, archived)
        return json(200, archived)
      },
    ],
    [
      'POST',
      /^\/v2\/payments\/intents$/,
      async (_m, request) => {
        const body = await readJson(request)
        if (!body) return invalid('body', 'The request body must be a JSON object')
        const { amount, currency, customer, confirm, payment_method } = body
        if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 50) return invalid('amount', 'amount must be an integer of at least 50')
        if (typeof currency !== 'string' || !CURRENCIES.includes(currency)) return invalid('currency', `currency must be one of ${CURRENCIES.join(', ')}`)
        if (typeof customer !== 'string' || !customers.has(customer)) return invalid('customer', `No such customer: ${String(customer)}`)
        // Like real test cards: this amount is always declined.
        if (amount === 4002) return error(402, 'card_declined', 'Your card was declined.')
        const intent: PaymentIntent = {
          id: id('pi'),
          amount,
          currency,
          customer,
          status: confirm === true ? 'succeeded' : typeof payment_method === 'string' ? 'requires_confirmation' : 'requires_payment_method',
        }
        payments.set(intent.id, intent)
        return json(200, intent)
      },
    ],
    [
      'POST',
      /^\/v2\/payments\/([^/]+)\/refund$/,
      async ([, pid], request) => {
        const intent = payments.get(pid!)
        if (!intent) return notFound('payment', pid!)
        const form = new URLSearchParams(await request.text())
        const amount = form.get('amount')
        if (amount !== null && (!/^\d+$/.test(amount) || Number(amount) < 1 || Number(amount) > intent.amount)) {
          return invalid('amount', `amount must be between 1 and ${intent.amount}`)
        }
        const reason = form.get('reason')
        if (reason !== null && !REFUND_REASONS.includes(reason)) return invalid('reason', `reason must be one of ${REFUND_REASONS.join(', ')}`)
        if (intent.status !== 'succeeded') return invalid('id', 'Only succeeded payments can be refunded')
        return json(200, intent)
      },
    ],
    [
      'GET',
      /^\/v2\/invoices$/,
      (_m, _r, url) => {
        const limit = clampLimit(url.searchParams.get('limit'))
        if (limit === undefined) return invalid('limit', 'limit must be an integer between 1 and 100')
        const statuses = url.searchParams.get('status')?.split(',').filter(Boolean)
        const all = invoices.filter(invoice => !statuses?.length || statuses.includes(invoice.status))
        return json(200, { data: all.slice(0, limit), has_more: all.length > limit })
      },
    ],
    [
      'GET',
      /^\/v2\/invoices\/([^/]+)\/pdf$/,
      ([, iid]) => {
        const invoice = invoices.find(i => i.id === iid)
        if (!invoice) return notFound('invoice', iid!)
        return { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${invoice.id}.pdf"` }, body: invoicePdf(invoice) }
      },
    ],
  ]

  async function respond(request: Request): Promise<Stored> {
    const url = new URL(request.url)
    let methodMismatch = false
    for (const [method, pattern, handler] of routes) {
      const match = url.pathname.match(pattern)
      if (!match) continue
      if (method !== request.method) {
        methodMismatch = true
        continue
      }
      return handler(match, request, url)
    }
    return methodMismatch ? error(405, 'method_not_allowed', `${request.method} is not allowed here`) : error(404, 'not_found', `Unknown endpoint: ${url.pathname}`)
  }

  return {
    /** A response for requests to the sandbox server; undefined for anything else. */
    async handle(request: Request): Promise<Response | undefined> {
      const url = new URL(request.url)
      if (url.origin !== SANDBOX_ORIGIN) return undefined
      if (request.method === 'OPTIONS') return new Response(null, { status: 204 })

      // Idempotency: the same key replays the first response for 24h, like the real API.
      const key = request.headers.get('Idempotency-Key')
      const cacheKey = key && `${request.method} ${url.pathname} ${key}`
      let stored = cacheKey ? idempotent.get(cacheKey) : undefined
      const replayed = !!stored
      if (!stored) {
        stored = await respond(request)
        if (cacheKey && stored.status < 500) idempotent.set(cacheKey, stored)
      }
      await new Promise(resolve => setTimeout(resolve, latency()))
      const headers = new Headers(stored.headers)
      headers.set('Request-Id', id('req'))
      headers.set('X-Orbit-Sandbox', 'in-browser demo')
      if (replayed) headers.set('Idempotent-Replayed', 'true')
      return new Response(stored.status === 204 || request.method === 'HEAD' ? null : stored.body, { status: stored.status, statusText: STATUS_TEXT[stored.status] ?? '', headers })
    },
  }
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  402: 'Payment Required',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  422: 'Unprocessable Content',
}

function clampLimit(raw: string | null): number | undefined {
  if (raw === null || raw === '') return 10
  const limit = Number(raw)
  return Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : undefined
}

async function readJson(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = JSON.parse(await request.text())
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** A one-page PDF listing the invoice lines. */
function invoicePdf(invoice: Invoice): string {
  const money = (pence: number) => `GBP ${(pence / 100).toFixed(2)}`
  const lines = [`Orbit invoice ${invoice.id} (${invoice.status})`, '', ...invoice.lines.map(l => `${l.description}  ${money(l.amount)}`), '', `Total  ${money(invoice.total)}`]
  const text = lines.map((line, i) => `BT /F1 12 Tf 72 ${720 - i * 18} Td (${line.replace(/[()\\]/g, '\\$&')}) Tj ET`).join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}
