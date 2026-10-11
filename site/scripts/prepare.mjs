// Copy the built <api-docs> bundle and the example specs into public/ for the demo.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const site = join(import.meta.dirname, '..')
const bundle = join(site, '../packages/standalone/dist')
const specs = join(site, '../examples/specs')
const pub = join(site, 'public')

if (!existsSync(join(bundle, 'apidoc.js'))) {
  console.error('packages/standalone/dist/apidoc.js is missing; build @binarycastle/apidoc first.')
  process.exit(1)
}
rmSync(join(pub, 'apidoc'), { recursive: true, force: true })
rmSync(join(pub, 'specs'), { recursive: true, force: true })
mkdirSync(join(pub, 'specs'), { recursive: true })
cpSync(join(bundle, 'apidoc.js'), join(pub, 'apidoc/apidoc.js'))
cpSync(join(bundle, 'chunks'), join(pub, 'apidoc/chunks'), { recursive: true })
for (const file of readdirSync(specs).filter(f => f.startsWith('orbit'))) cpSync(join(specs, file), join(pub, 'specs', file))
console.log('Copied the bundle and the Orbit specs into site/public.')
