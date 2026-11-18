import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Main chunk ~630 kB / ~138 kB gzip (React + engine + official wheel data, needed for the first render);
  // the lazily loaded monster dataset chunk (src/data) is ~700 kB / ~76 kB gzip by design.
  build: { chunkSizeWarningLimit: 800 },
})
