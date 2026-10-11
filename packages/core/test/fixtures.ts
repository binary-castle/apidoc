import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const specsDir = fileURLToPath(new URL('../../../examples/specs/', import.meta.url))

export const readSpec = (name: string) => readFileSync(specsDir + name, 'utf8')
