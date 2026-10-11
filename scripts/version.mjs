// One version for every published package.
//
//   node scripts/version.mjs            print the current version (fails if packages disagree)
//   node scripts/version.mjs 0.2.0      set it everywhere
//   node scripts/version.mjs --check v0.2.0   CI: fail unless every package is at the tag's version
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

/** [file, read(text) -> version, write(text, version) -> text] */
const targets = [
  ...['packages/standalone/package.json', 'packages/cli/package.json'].map(file => [
    file,
    text => JSON.parse(text).version,
    (text, version) => text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`),
  ]),
  ...['integrations/django/pyproject.toml', 'integrations/fastapi/pyproject.toml'].map(file => [
    file,
    text => text.match(/^version = "([^"]+)"/m)?.[1],
    (text, version) => text.replace(/^version = "[^"]+"/m, `version = "${version}"`),
  ]),
  ...['integrations/django/src/apidoc_django/__init__.py', 'integrations/fastapi/src/apidoc_fastapi/__init__.py'].map(file => [
    file,
    text => text.match(/^__version__ = "([^"]+)"/m)?.[1],
    (text, version) => text.replace(/^__version__ = "[^"]+"/m, `__version__ = "${version}"`),
  ]),
]

const read = file => readFileSync(join(root, file), 'utf8')
const current = () => targets.map(([file, get]) => [file, get(read(file))])

const [arg, tag] = process.argv.slice(2)

if (!arg || arg === '--check') {
  const versions = current()
  const distinct = [...new Set(versions.map(([, v]) => v))]
  const expected = arg === '--check' ? tag?.replace(/^v/, '') : distinct[0]
  const wrong = versions.filter(([, v]) => v !== expected)
  if (wrong.length || !expected) {
    console.error(`Package versions ${arg === '--check' ? `do not match ${tag}` : 'disagree'}:`)
    for (const [file, v] of versions) console.error(`  ${v === expected ? '✓' : '✗'} ${file}: ${v}`)
    process.exit(1)
  }
  console.log(expected)
} else {
  if (!SEMVER.test(arg)) {
    console.error(`Not a semver version: ${arg}`)
    process.exit(1)
  }
  for (const [file, , set] of targets) writeFileSync(join(root, file), set(read(file), arg))
  console.log(`Set ${targets.length} files to ${arg}. Commit, then tag: git tag v${arg}`)
}
