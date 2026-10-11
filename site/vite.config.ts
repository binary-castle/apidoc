import { defineConfig } from 'vite'

/**
 * Static demo for GitHub Pages. Relative base so it works under /apidoc/.
 * The service worker is its own entry, emitted as a self-contained sw.js at
 * the root so its scope covers the whole demo.
 */
export default defineConfig({
  base: './',
  server: { port: Number(process.env.PORT) || 5190 },
  preview: { port: Number(process.env.PORT) || 5190 },
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: { main: 'index.html', sw: 'src/sw.ts' },
      output: { entryFileNames: chunk => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js') },
    },
  },
})
