import { fileURLToPath } from 'node:url'
import { apidoc } from '@binarycastle/apidoc-express'
import express from 'express'

const app = express()
app.use(express.json())

// The OpenAPI document, served as a file. Generated specs work the same way:
// pass `spec: document` to apidoc() instead of `specUrl` and it serves it for you.
app.get('/openapi.yaml', (_req, res) => res.sendFile(fileURLToPath(new URL('./openapi.yaml', import.meta.url))))

app.use('/docs', apidoc({ specUrl: '/openapi.yaml' }))

// --- A tiny in-memory API ----------------------------------------------------

const customers = new Map()
let nextId = 1

app.use('/v1', (req, res, next) => {
  if (req.get('authorization') !== 'Bearer sk_test_demo') return res.status(401).json({ error: 'Use the bearer token sk_test_demo.' })
  next()
})

app.get('/v1/customers', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100)
  const all = [...customers.values()].reverse()
  res.json({ data: all.slice(0, limit), has_more: all.length > limit })
})

app.post('/v1/customers', (req, res) => {
  const { email, name = null } = req.body ?? {}
  if (typeof email !== 'string' || !email.includes('@')) return res.status(400).json({ error: 'email is required.' })
  const customer = { id: `cus_${nextId++}`, email, name, created: Math.floor(Date.now() / 1000) }
  customers.set(customer.id, customer)
  res.status(201).json(customer)
})

app.get('/v1/customers/:id', (req, res) => {
  const customer = customers.get(req.params.id)
  customer ? res.json(customer) : res.status(404).json({ error: 'No such customer.' })
})

app.delete('/v1/customers/:id', (req, res) => {
  customers.delete(req.params.id) ? res.status(204).end() : res.status(404).json({ error: 'No such customer.' })
})

const port = Number(process.env.PORT) || 3000
app.listen(port, () => console.log(`Docs: http://localhost:${port}/docs/`))
