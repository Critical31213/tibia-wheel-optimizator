import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The lazily loaded monster dataset chunk (src/data) is ~700 kB minified / ~76 kB gzip by design.
  build: { chunkSizeWarningLimit: 800 },
})
