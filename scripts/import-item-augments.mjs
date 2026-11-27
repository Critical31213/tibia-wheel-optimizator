/**
 * Offline import of item augments (an item's bonus to one spell, e.g. "Divine Barrage -> +8% critical extra damage").
 *
 * Usage: npm run import:augments [-- --refresh]
 *
 * Source (cached in scripts/.cache/augments/, see THIRD_PARTY_NOTICES.md): the `augments` field of the TibiaWiki item
 * infoboxes, read through the MediaWiki API, for every item in equipment.json and every weapon in proficiency.json.
 * Only the facts (spell, effect, value) are kept.
 *
 * D131: also the `mantra` field (monk equipment), kept per item id in the same file.
 *
 * Output: src/data/equipment/augments.json. Unparsed augments are printed and listed in `meta.issues`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', '.cache', 'augments');
const OUT = join(ROOT, 'src', 'data', 'equipment', 'augments.json');
const API = 'https://tibia.fandom.com/api.php';
const UA = 'wheel-optimizer-research';
const refresh = process.argv.includes('--refresh');
const BATCH = 50;

const equipment = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'equipment', 'equipment.json'), 'utf8')).items;
const proficiency = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'proficiency', 'proficiency.json'), 'utf8'));
const weapons = (function find(o, out = []) {
  if (Array.isArray(o)) o.forEach((x) => find(x, out));
  else if (o && typeof o === 'object') {
    if (typeof o.id === 'string' && typeof o.name === 'string' && Array.isArray(o.levels)) out.push(o);
    else Object.values(o).forEach((x) => find(x, out));
  }
  return out;
})(proficiency);
const items = [...equipment, ...weapons].map((x) => ({ id: x.id, name: x.name }));

async function batch(names, n) {
  const file = join(CACHE, `batch-${n}.json`);
  if (!refresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const url = `${API}?action=query&prop=revisions&rvprop=content&rvslots=main&format=json&formatversion=2&redirects=1&titles=${encodeURIComponent(names.join('|'))}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`batch ${n}: HTTP ${res.status}`);
  const json = await res.json();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, JSON.stringify(json));
  await new Promise((r) => setTimeout(r, 1000));
  return json;
}

const issues = [];
const issue = (s) => {
  issues.push(s);
  console.warn('!', s);
};

/** Effect names on the wiki → engine augment kinds. */
const KINDS = [
  [/^critical extra damage$/i, 'critDamage'],
  [/^critical (hit )?chance$/i, 'critChance'],
  [/^base damage$/i, 'baseDamage'],
  [/^base healing$/i, 'baseHealing'],
  [/^cooldown$/i, 'cooldown'],
  [/^life leech$/i, 'lifeLeech'],
  [/^mana leech$/i, 'manaLeech'],
];

/** Spell names misspelled on some item pages. */
const SPELL_ALIAS = { 'Etheral Spear': 'Ethereal Spear' };

function parseAugments(raw, name) {
  const out = [];
  for (const part of raw.split(/<br\s*\/?>|\n|;|,(?=\s*[A-Z][^>]*->)/).map((s) => s.replace(/\[\[|\]\]/g, '').replace(/^Augments:\s*/i, '').trim()).filter(Boolean)) {
    const m = part.match(/^(.+?)\s*->\s*([+-]?\d+(?:\.\d+)?)\s*(%|s)?\s+(.+)$/);
    const kind = m && KINDS.find(([re]) => re.test(m[4].trim()))?.[1];
    if (!m || !kind) {
      issue(`${name}: unparsed augment "${part}"`);
      continue;
    }
    const v = Number(m[2]);
    // Cooldown on the wiki: "-2s cooldown" → 2 s shorter.
    out.push({ spell: SPELL_ALIAS[m[1].trim()] ?? m[1].trim(), kind, value: kind === 'cooldown' ? Math.abs(v) : v / 100 });
  }
  return out;
}

const byTitle = new Map();
for (let i = 0; i < items.length; i += BATCH) {
  const chunk = items.slice(i, i + BATCH);
  const json = await batch(chunk.map((x) => x.name), i / BATCH);
  const alias = new Map();
  for (const r of json.query?.normalized ?? []) alias.set(r.from, r.to);
  for (const r of json.query?.redirects ?? []) alias.set(r.from, r.to);
  for (const p of json.query?.pages ?? []) byTitle.set(p.title, p.revisions?.[0]?.slots?.main?.content ?? '');
  for (const x of chunk) {
    let t = x.name;
    for (let k = 0; k < 3 && alias.has(t); k++) t = alias.get(t);
    x.title = t;
  }
}

const augments = {};
const mantra = {};
let missing = 0;
for (const x of items) {
  const text = byTitle.get(x.title);
  if (!text) {
    missing++;
    continue;
  }
  // Multi-line or one-line infoboxes: the value ends at a newline, the next `|` or the closing `}}`.
  const mt = text.match(/\|\s*mantra\s*=\s*(\d+)/);
  if (mt && Number(mt[1]) > 0) mantra[x.id] = Number(mt[1]);
  const m = text.match(/\|\s*augments\s*=\s*([^|\n}]*)/);
  const raw = m?.[1]?.trim();
  if (!raw || raw === '--') continue;
  const list = parseAugments(raw, x.name);
  if (list.length) augments[x.id] = list;
}
if (missing) issue(`${missing} items without a wiki page`);

writeFileSync(OUT, JSON.stringify({ meta: { source: 'https://tibia.fandom.com', items: Object.keys(augments).length, issues }, augments, mantra }, null, 0) + '\n');
console.log(`${Object.keys(augments).length} items with augments → ${OUT}`);
