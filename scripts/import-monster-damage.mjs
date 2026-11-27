/**
 * D140: offline import of the damage types monsters deal, from TibiaWiki creature infoboxes (`abilities`).
 *
 * Usage: npm run import:monster-damage [-- --refresh]
 *
 * Source (cached in scripts/.cache/monster-wiki/, see THIRD_PARTY_NOTICES.md): TibiaWiki through the MediaWiki API.
 * Per creature: the elements of its attacks and each element's share of the summed maximum damage of its attacks.
 * Only the facts are kept. Updates `damageTypes` (union with the existing ones) and `damageShares` in
 * src/data/monsters.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', '.cache', 'monster-wiki');
const OUT = join(ROOT, 'src', 'data', 'monsters.json');
const API = 'https://tibia.fandom.com/api.php';
const UA = 'wheel-optimizer-research';
const refresh = process.argv.includes('--refresh');
const survey = process.argv.includes('--survey');

async function batch(titles, k) {
  const file = join(CACHE, `batch-${k}.json`);
  if (!refresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const url = `${API}?action=query&prop=revisions&rvprop=content&rvslots=main&format=json&redirects=1&titles=${encodeURIComponent(titles.join('|'))}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`batch ${k}: HTTP ${res.status}`);
  const j = await res.json();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, JSON.stringify(j));
  await new Promise((r) => setTimeout(r, 1000));
  return j;
}

const monsters = JSON.parse(readFileSync(OUT, 'utf8'));
const pages = new Map();
for (let i = 0, k = 0; i < monsters.length; i += 50, k++) {
  const names = monsters.slice(i, i + 50).map((m) => m.name);
  const j = await batch(names, k);
  const alias = new Map();
  for (const r of [...(j.query?.normalized ?? []), ...(j.query?.redirects ?? [])]) alias.set(r.to, r.from);
  for (const p of Object.values(j.query?.pages ?? {})) {
    const text = p.revisions?.[0]?.slots?.main?.['*'];
    if (!text) continue;
    let name = p.title;
    while (alias.has(name)) name = alias.get(name);
    pages.set(name, text);
  }
}

/** `abilities = ...` field of the infobox (up to the next top-level field). */
function abilities(text) {
  const i = text.search(/\|\s*abilities\s*=/);
  if (i < 0) return null;
  let depth = 0;
  let j = text.indexOf('=', i) + 1;
  const start = j;
  for (; j < text.length; j++) {
    if (text.startsWith('{{', j)) [depth, j] = [depth + 1, j + 1];
    else if (text.startsWith('}}', j)) {
      if (depth === 0) break;
      [depth, j] = [depth - 1, j + 1];
    } else if (text[j] === '\n' && depth === 0 && text[j + 1] === '|') break;
  }
  return text.slice(start, j);
}

if (survey) {
  const tpl = new Map();
  const el = new Map();
  for (const [, t] of pages) {
    const a = abilities(t) ?? '';
    for (const m of a.matchAll(/\{\{\s*([A-Za-z ]+?)\s*\|/g)) tpl.set(m[1], (tpl.get(m[1]) ?? 0) + 1);
    for (const m of a.matchAll(/element\s*=\s*([^|}]+)/g)) el.set(m[1].trim().toLowerCase(), (el.get(m[1].trim().toLowerCase()) ?? 0) + 1);
  }
  console.log('pages', pages.size, 'of', monsters.length);
  console.log([...tpl].sort((a, b) => b[1] - a[1]).slice(0, 40));
  console.log([...el].sort((a, b) => b[1] - a[1]));
  process.exit(0);
}

const ELEMENT = {
  physical: 'physical', bleed: 'physical', bleeding: 'physical',
  fire: 'fire', 'fire field': 'fire', burning: 'fire',
  earth: 'earth', poison: 'earth', 'poison field': 'earth',
  energy: 'energy', 'energy field': 'energy', electrified: 'energy',
  ice: 'ice', holy: 'holy', death: 'death',
  'life drain': 'lifeDrain', lifedrain: 'lifeDrain', 'lifed rain': 'lifeDrain', 'element-earth': 'earth', 'mana drain': 'manaDrain', manadrain: 'manaDrain',
  drowning: 'drown', drown: 'drown',
};
const ORDER = ['physical', 'fire', 'earth', 'energy', 'ice', 'holy', 'death', 'lifeDrain', 'manaDrain', 'drown'];

/** Top-level `{{Name|...}}` templates of a text with their arguments (links and nested templates kept whole). */
function templates(text) {
  const out = [];
  for (let i = text.indexOf('{{'); i >= 0; i = text.indexOf('{{', i + 2)) {
    let depth = 0;
    let j = i;
    const args = [];
    let cur = '';
    for (; j < text.length; j++) {
      const two = text.slice(j, j + 2);
      if (two === '{{' || two === '[[') { depth++; if (depth > 1) cur += two; j++; continue; }
      if (two === '}}' || two === ']]') { depth--; if (depth === 0) break; cur += two; j++; continue; }
      if (text[j] === '|' && depth === 1) { args.push(cur); cur = ''; continue; }
      cur += text[j];
    }
    args.push(cur);
    out.push({ name: args[0].trim(), args: args.slice(1).map((s) => s.trim()) });
  }
  return out;
}

/** Highest number of a damage text ("300-550", "0-1400+", "~200"); null when unknown. */
function maxOf(s) {
  const n = [...(s ?? '').replace(/,/g, '').matchAll(/\d+/g)].map((m) => Number(m[0]));
  return n.length ? Math.max(...n) : null;
}

const stats = { pages: 0, changed: 0, added: 0 };
const issues = [];
for (const m of monsters) {
  const text = pages.get(m.name);
  const a = text && abilities(text);
  if (!a) continue;
  stats.pages++;
  const parts = [];
  for (const t of templates(a)) {
    if (t.name === 'Melee') parts.push({ e: 'physical', dmg: maxOf(t.args.find((x) => !x.includes('='))) });
    else if (t.name === 'Ability') {
      const pos = t.args.filter((x) => !/^\w+\s*=/.test(x));
      const named = t.args.find((x) => /^element\s*=/.test(x))?.split('=')[1];
      const raw = (named ?? pos[2] ?? '').trim().toLowerCase().replace(/\?$/, '');
      const e = ELEMENT[raw];
      if (e) parts.push({ e, dmg: maxOf(pos[1]) });
      else if (raw && !/^(\?|healing|invisible|summon|haste|paralyze|buff|debuff|none|shapeshifting|rooted|feared|strengthened|agony|slowed|drunk|teleport)$/.test(raw)) issues.push(`${m.name}: element "${raw}"`);
    }
  }
  // An attack of known 0 damage (e.g. a creature that never hits) deals nothing.
  const real = parts.filter((p) => p.dmg !== 0);
  parts.length = 0;
  parts.push(...real);
  const known = parts.filter((p) => p.dmg);
  if (!parts.length) continue;
  const fallback = known.length ? known.reduce((s, p) => s + p.dmg, 0) / known.length : 1;
  const sum = {};
  for (const p of parts) sum[p.e] = (sum[p.e] ?? 0) + (p.dmg || fallback);
  const total = Object.values(sum).reduce((s, x) => s + x, 0);
  const shares = {};
  for (const e of ORDER) if (sum[e]) shares[e] = Math.round((1000 * sum[e]) / total) / 1000;
  const before = m.damageTypes.join();
  const types = new Set([...m.damageTypes, ...Object.keys(shares)]);
  m.damageTypes = [...ORDER, 'healing'].filter((e) => types.has(e));
  if (m.damageTypes.join() !== before) [stats.changed, stats.added] = [stats.changed + 1, stats.added + m.damageTypes.length - before.split(',').filter(Boolean).length];
  // Shares of the wiki attacks only; elements known from the other source alone get none.
  m.damageShares = shares;
}
writeFileSync(OUT, JSON.stringify(monsters, null, 2) + '\n');
console.log(stats, `${issues.length} issues`);
for (const s of issues.slice(0, 30)) console.log(' ', s);
