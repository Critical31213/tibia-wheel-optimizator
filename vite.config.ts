import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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

/** Package root of a bundled module id (handles scoped packages), or null outside node_modules. */
function packageRoot(id: string): string | null {
  const m = /^(.*[\\/]node_modules[\\/])((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(id)
  return m ? m[1] + m[2] : null
}

// Ships THIRD_PARTY_NOTICES.md plus the license text of every bundled package as third-party-licenses.txt.
const licenses = (): Plugin => ({
  name: 'third-party-licenses',
  apply: 'build',
  generateBundle() {
    const roots = new Set<string>()
    for (const id of this.getModuleIds()) {
      const root = packageRoot(id)
      if (root) roots.add(root)
    }
    const parts = [readFileSync('THIRD_PARTY_NOTICES.md', 'utf8')]
    for (const root of [...roots].sort()) {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; version: string; license?: string }
      const file = existsSync(root) ? readdirSync(root).find((f) => /^(licen[cs]e|copying)/i.test(f)) : undefined
      const text = file ? readFileSync(join(root, file), 'utf8').trim() : `License: ${pkg.license ?? 'see package'}`
      const rule = '='.repeat(72)
      parts.push([rule, `${pkg.name}@${pkg.version} (${pkg.license ?? 'unknown'})`, rule, text].join('\n'))
    }
    this.emitFile({ type: 'asset', fileName: 'third-party-licenses.txt', source: parts.join('\n\n') + '\n' })
  },
})

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths: works on GitHub Pages under any repository name.
  base: './',
  plugins: [react(), tailwindcss(), csp(), licenses()],
  // Main chunk ~725 kB / ~158 kB gzip: React + engine + official wheel data + damage formulas
  // (src/data/damage) + fflate's inflate, all needed synchronously for the first optimize().
  // The lazily loaded monster dataset chunk (src/data) is ~700 kB / ~76 kB gzip by design.
  build: { chunkSizeWarningLimit: 800 },
  // D42: the optimizer runs in a module worker (src/workers/optimize.worker.ts).
  worker: { format: 'es' },
})
