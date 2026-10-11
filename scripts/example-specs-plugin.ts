import { createReadStream, existsSync, readdirSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'
import type { Plugin } from 'vite'

const specsDir = resolve(import.meta.dirname, '../examples/specs')

function serveSpecs(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const name = decodeURIComponent((req.url ?? '/').split('?')[0]!.slice(1))
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (!name) {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(readdirSync(specsDir).filter(f => /\.(json|ya?ml)$/.test(f) && !f.includes('.arazzo.'))))
    return
  }
  const file = join(specsDir, name)
  if (!file.startsWith(specsDir) || !existsSync(file)) return next()
  res.setHeader('Content-Type', name.endsWith('.json') ? 'application/json' : 'application/yaml')
  createReadStream(file).pipe(res)
}

/** Serve examples/specs at /specs/* in `vite` dev and `vite preview`. */
export function exampleSpecs(): Plugin {
  return {
    name: 'apidoc-example-specs',
    configureServer(server) {
      server.middlewares.use('/specs', serveSpecs)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/specs', serveSpecs)
    },
  }
}
