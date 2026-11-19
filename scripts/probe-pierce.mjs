#!/usr/bin/env node
/**
 * Probes how "pierce" perks (Ballistic Mastery bow: +4 % physical & holy pierce) interact with creature
 * resistances in the damage API. 6 requests, >= 2.5 s apart, cached in scripts/.cache/damage-api/damage
 * (same key scheme as datamine-damage.mjs). Usage: node scripts/probe-pierce.mjs [--offline]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts/.cache/damage-api/damage');
const API = process.env.DAMAGE_API ?? '';
const OFFLINE = process.argv.includes('--offline');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastAt = 0;

async function damage(req) {
  const p = join(CACHE, `${createHash('sha1').update(JSON.stringify(req)).digest('hex').slice(0, 16)}.json`);
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')).response;
  if (OFFLINE) throw new Error('offline and not cached');
  const wait = lastAt + 2600 - Date.now();
  if (wait > 0) await sleep(wait);
  lastAt = Date.now();
  if (!API) throw new Error("set DAMAGE_API (base URL of the damage API)");
  const res = await fetch(`${API}/damage`, {
    method: 'POST',
    headers: { 'User-Agent': 'wheel-optimizer-research', Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const response = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(response).slice(0, 200)}`);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(p, JSON.stringify({ request: req, response }) + '\n');
  return response;
}

const CREATURES = { Behemoth: 0, Demon: 190, 'Dragon Lord': 208 };
const creatures = JSON.parse(readFileSync(join(ROOT, 'scripts/.cache/damage-api/meta/creatures.json'), 'utf8')).items;
CREATURES.Behemoth = creatures.find((c) => c.name === 'Behemoth').id;
const base = (id, perks = []) => ({
  stats: { vocation: 'paladin', level: 800, bonus: 0, critChance: 10, critDamage: 50, skill: 120, magicLevel: 30 },
  weapon: { id: 437, ammoId: 21 },
  rotation: [{ id: 13, targets: 1, ratio: 1 }],
  targets: [{ id, ratio: 1 }],
  perks,
});
const pierce = (v, kind = 'regular') => [
  { id: kind === 'regular' ? 216 : 278, value: v },
  { id: kind === 'regular' ? 218 : 280, value: v },
];
const cases = [
  ['Behemoth', 'none', base(CREATURES.Behemoth)],
  ['Behemoth', 'regular 4', base(CREATURES.Behemoth, pierce(4))],
  ['Behemoth', 'regular 40', base(CREATURES.Behemoth, pierce(40))],
  ['Behemoth', 'weapon 4', base(CREATURES.Behemoth, pierce(4, 'weapon'))],
  ['Demon', 'none', base(CREATURES.Demon)],
  ['Demon', 'regular 4', base(CREATURES.Demon, pierce(4))],
  ['Dragon Lord', 'none', base(CREATURES['Dragon Lord'])],
  ['Dragon Lord', 'regular 4', base(CREATURES['Dragon Lord'], pierce(4))],
];
const SPELLS = ['Divine Caldera', 'Ethereal Barrage', 'Auto-attack'];
for (const [c, label, req] of cases) {
  const r = await damage(req);
  const mods = creatures.find((x) => x.name === c);
  const row = SPELLS.map((n) => {
    const s = r.spells.find((x) => x.name === n);
    return `${n}: raw ${s.raw.avg} eff ${s.effective.avg.toFixed(2)}`;
  });
  console.log(`${c} [holy ${mods.damageMods.holy} phys ${mods.damageMods.physical} mit ${mods.mitigation}] ${label} | ${row.join(' | ')}`);
}
