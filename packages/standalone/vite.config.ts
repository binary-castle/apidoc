import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { exampleSpecs } from '../../scripts/example-specs-plugin.ts'

/**
 * Library build: one ES module entry (dist/apidoc.js) plus lazy chunks for the
 * syntax highlighter and fonts, all resolved relative to the entry's URL so it
 * works from any CDN path. React is bundled in; hosts need nothing else.
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), exampleSpecs()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  server: { port: Number(process.env.PORT) || 5180 },
  preview: { port: Number(process.env.PORT) || 5180 },
  build: {
    target: 'es2022',
    // Lib-mode ES output is left unminified by default (it assumes re-bundling);
    // this file is served straight to browsers, so minify it.
    minify: true,
    lib: {
      entry: 'src/main.ts',
      formats: ['es'],
      fileName: () => 'apidoc.js',
    },
    rolldownOptions: {
      output: { chunkFileNames: 'chunks/[name]-[hash].js', minify: true },
    },
  },
})
