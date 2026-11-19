import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

// Production-only CSP (GitHub Pages cannot set headers): everything is bundled and same-origin.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const csp = (): Plugin => ({
  name: 'csp',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
})

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths: works on GitHub Pages under any repository name.
  base: './',
  plugins: [react(), tailwindcss(), csp()],
  // Main chunk ~725 kB / ~158 kB gzip: React + engine + official wheel data + damage formulas
  // (src/data/damage) + fflate's inflate, all needed synchronously for the first optimize().
  // The lazily loaded monster dataset chunk (src/data) is ~700 kB / ~76 kB gzip by design.
  build: { chunkSizeWarningLimit: 800 },
})
