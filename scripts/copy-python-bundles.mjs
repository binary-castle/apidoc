// Copy the built standalone bundle into each Python integration's static files.
// Run via `pnpm build:integrations` (which builds the bundle first).
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const dist = join(root, 'packages/standalone/dist')
const targets = [
  'integrations/django/src/apidoc_django/static/apidoc_django',
  'integrations/fastapi/src/apidoc_fastapi/static',
]

if (!existsSync(join(dist, 'apidoc.js'))) {
  console.error('packages/standalone/dist/apidoc.js is missing: build @apidoc/standalone first.')
  process.exit(1)
}

for (const relative of targets) {
  const target = join(root, relative)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  // Only the module and its chunks; dist also holds the isolation demo page.
  cpSync(join(dist, 'apidoc.js'), join(target, 'apidoc.js'))
  cpSync(join(dist, 'chunks'), join(target, 'chunks'), { recursive: true })
  console.log(`Copied apidoc bundle to ${relative}`)
}
