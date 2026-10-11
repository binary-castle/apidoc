import { createReadStream, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const specsDir = resolve(__dirname, '../../examples/specs')

/** Serve examples/specs at /specs/* in dev so the playground app can load them. */
function exampleSpecs(): Plugin {
  return {
    name: 'apidoc-example-specs',
    configureServer(server) {
      server.middlewares.use('/specs', (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '/').split('?')[0]!.slice(1))
        if (!name) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(readdirSync(specsDir)))
          return
        }
        const file = join(specsDir, name)
        if (!file.startsWith(specsDir) || !existsSync(file)) return next()
        res.setHeader('Content-Type', name.endsWith('.json') ? 'application/json' : 'application/yaml')
        createReadStream(file).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), exampleSpecs()],
  server: { port: Number(process.env.PORT) || 5173 },
})
