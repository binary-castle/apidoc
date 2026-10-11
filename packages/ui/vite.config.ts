import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { exampleSpecs } from '../../scripts/example-specs-plugin.ts'

export default defineConfig({
  plugins: [react(), tailwindcss(), exampleSpecs()],
  server: { port: Number(process.env.PORT) || 5173 },
})
