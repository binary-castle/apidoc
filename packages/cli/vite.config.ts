import { defineConfig } from 'vite'

/** Bundle the CLI (and @apidoc/core) into one Node ES module with a shebang. */
export default defineConfig({
  build: {
    ssr: 'src/bin.ts',
    target: 'node20',
    minify: false,
    rolldownOptions: {
      output: { entryFileNames: 'apidoc.mjs', banner: '#!/usr/bin/env node' },
    },
  },
  // Bundle dependencies instead of leaving bare imports for node_modules.
  ssr: { noExternal: true },
})
