import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface Asset {
  body: Buffer
  etag: string
  /** Chunks have content hashes in their names and never change. */
  immutable: boolean
}

/**
 * The prebuilt `@binarycastle/apidoc` bundle: `apidoc.js` plus its lazy
 * chunks. Files are read on first request and kept in memory (~1 MB total).
 */
export class BundleAssets {
  readonly dir: string
  readonly #chunks: Set<string>
  readonly #cache = new Map<string, Asset>()

  constructor(dir = defaultBundleDir()) {
    if (!existsSync(join(dir, 'apidoc.js'))) {
      throw new Error(
        `The apidoc bundle is missing from ${dir}. Packages from npm include it; in a source checkout ` +
          'run `pnpm build` in the apidoc repo first, or pass `bundleUrl` to load it from a CDN.',
      )
    }
    this.dir = dir
    // Only files that exist at startup can be served, so request paths never reach the filesystem.
    const chunks = join(dir, 'chunks')
    this.#chunks = new Set(existsSync(chunks) ? readdirSync(chunks).filter(name => name.endsWith('.js')) : [])
  }

  /** `apidoc.js` or `chunks/<name>.js`; undefined for anything else. */
  get(path: string): Asset | undefined {
    const chunk = path.startsWith('chunks/') ? path.slice('chunks/'.length) : undefined
    if (path !== 'apidoc.js' && !(chunk && this.#chunks.has(chunk))) return undefined
    let asset = this.#cache.get(path)
    if (!asset) {
      const body = readFileSync(join(this.dir, path))
      const hash = createHash('sha256').update(body).digest('base64url').slice(0, 27)
      asset = { body, etag: `"${hash}"`, immutable: chunk !== undefined }
      this.#cache.set(path, asset)
    }
    return asset
  }
}

/** `dist/` of the `@binarycastle/apidoc` package this one depends on. */
export function defaultBundleDir(): string {
  return join(dirname(require.resolve('@binarycastle/apidoc/package.json')), 'dist')
}
