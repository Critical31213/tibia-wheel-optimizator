// D37: every external source must be listed in THIRD_PARTY_NOTICES.md; runtime packages need permissive licenses.
import { describe, expect, it } from 'vitest';

type Fs = { readdirSync(p: string): string[]; readFileSync(p: string, e: 'utf8'): string; statSync(p: string): { isDirectory(): boolean } };
const nodeImport = <T>(m: string) => import(/* @vite-ignore */ m) as Promise<T>;
const { readdirSync, readFileSync, statSync } = await nodeImport<Fs>('node:fs');
const join = (...p: string[]) => p.join('/');

const NOTICES = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8');
const ALLOWED = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'OFL-1.1', '0BSD']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

type Pkg = { name: string; license?: string; dependencies?: Record<string, string> };
const pkgOf = (name: string): Pkg => JSON.parse(readFileSync(join('node_modules', name, 'package.json'), 'utf8')) as Pkg;

describe('legal', () => {
  it('lists every host used by scripts and app code in THIRD_PARTY_NOTICES.md', () => {
    const hosts = new Set<string>();
    for (const f of [...files('scripts'), ...files('src')]) {
      for (const m of readFileSync(f, 'utf8').matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) hosts.add(m[1].toLowerCase().replace(/^www\./, ''));
    }
    expect(hosts.size).toBeGreaterThan(0);
    expect([...hosts].filter((h) => !NOTICES.includes(h))).toEqual([]);
  });

  it('bundles only permissively licensed runtime packages', () => {
    const seen = new Map<string, string>();
    const visit = (name: string) => {
      if (seen.has(name)) return;
      const pkg = pkgOf(name);
      seen.set(name, pkg.license ?? 'unknown');
      for (const d of Object.keys(pkg.dependencies ?? {})) visit(d);
    };
    for (const d of Object.keys((JSON.parse(readFileSync('package.json', 'utf8')) as Pkg).dependencies ?? {})) visit(d);
    expect([...seen].filter(([, l]) => !ALLOWED.has(l))).toEqual([]);
  });
});
