import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Main chunk ~725 kB / ~158 kB gzip: React + engine + official wheel data + damage formulas
  // (src/data/damage) + fflate's inflate, all needed synchronously for the first optimize().
  // The lazily loaded monster dataset chunk (src/data) is ~700 kB / ~76 kB gzip by design.
  build: { chunkSizeWarningLimit: 800 },
})
