/**
 * Offline import of equipment items (helmets, armors, legs, boots, shields, spellbooks, quivers, trinkets, amulets, rings).
 *
 * Usage: npm run import:equipment [-- --refresh]
 *
 * Source (cached in scripts/.cache/equipment/, see THIRD_PARTY_NOTICES.md): tibiopedia.pl item tables
 * (armor, defense, class, imbuement slots, bonuses, required level and vocation). Only the facts are kept.
 *
 * Output: src/data/equipment/equipment.json. Unparsed bonuses are printed and listed in `meta.issues`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', '.cache', 'equipment');
const OUT = join(ROOT, 'src', 'data', 'equipment', 'equipment.json');
const SITE = 'https://tibiopedia.pl';
const UA = 'wheel-optimizer-research';
const refresh = process.argv.includes('--refresh');

let cookie = '';
/** The site asks for a language / layout choice once per session (a cookie). */
async function session() {
  if (cookie) return;
  const res = await fetch(`${SITE}/setup/choose`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'tp_lang=pl&tp_layout=library',
  });
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
}

async function cached(name, path) {
  const file = join(CACHE, name);
  if (!refresh && existsSync(file)) return readFileSync(file, 'utf8');
  await session();
  const res = await fetch(SITE + path, { headers: { 'User-Agent': UA, Cookie: cookie } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const text = await res.text();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, text);
  await new Promise((r) => setTimeout(r, 1000));
  return text;
}

const issues = [];
const issue = (s) => {
  issues.push(s);
  console.warn('!', s);
};

const strip = (s) =>
  s.replace(/<br\s*\/?>/g, '; ').replace(/<img[^>]*title="([^"]*)"[^>]*>/g, ' [$1]').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const int = (s) => (s && /^-?\d+$/.test(s) ? Number(s) : undefined);
const slug = (s) => s.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function tables(html) {
  return html.split(/<tr class="sticky">/).slice(1).map((t) => {
    const rows = t.split(/<tr class="itemTabRow/);
    const head = [...rows[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((m) => strip(m[1]));
    return rows.slice(1).map((r) => {
      const cells = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]));
      return Object.fromEntries(head.map((k, j) => [k, cells[j]]));
    });
  });
}

const PL_RESIST = {
  'ataki fizyczne': 'physical', ogień: 'fire', ziemię: 'earth', energię: 'energy', lód: 'ice', świętość: 'holy', śmierć: 'death',
  'wykradanie życia': 'lifeDrain', 'wykradanie many': 'manaDrain', tonięcie: 'drown',
};
const ML_ELEMENTS = new Set(['fire', 'ice', 'earth', 'energy', 'holy', 'death', 'healing']);
const VOCATIONS = { knight: 'knight', paladin: 'paladin', sorcerer: 'sorcerer', srocerer: 'sorcerer', druid: 'druid', monk: 'monk' };
const IGNORED = /prędkość|damage reflection|magic shield|regeneracja|niweluje|Dekoracja|mana shield|niewidzialność|Pokazuje|Zapobiega|Działa|Świeci|Umożliwia|Raz na godzinę|Ładowane do|^-$/;

function parseBonus(text, name) {
  const b = {};
  for (const raw of (text ?? '').split(';').map((s) => s.trim().replace(/,$/, '')).filter(Boolean)) {
    let m;
    if ((m = /^\+(\d+) magic level$/.exec(raw))) (b.skills ??= {}).magic = Number(m[1]);
    else if ((m = /^\+(\d+) (\w+) magic level$/.exec(raw)) && ML_ELEMENTS.has(m[2])) (b.elementMl ??= {})[m[2]] = Number(m[1]);
    else if ((m = /^([+-]\d+) (axe|club|sword|fist|distance) fighting$/.exec(raw))) (b.skills ??= {})[m[2]] = Number(m[1]);
    else if ((m = /^([+-]\d+) shielding$/.exec(raw))) (b.skills ??= {}).shielding = Number(m[1]);
    else if ((m = /^([+-]\d+)% odporność na (.+)$/.exec(raw)) && PL_RESIST[m[2]]) {
      if (PL_RESIST[m[2]] !== 'drown') (b.resist ??= {})[PL_RESIST[m[2]]] = Number(m[1]);
    } else if ((m = /^\+?(\d+(?:\.\d+)?)% szansy na obrażenie krytyczne$/.exec(raw))) b.critChance = Number(m[1]);
    else if ((m = /^\+(\d+(?:\.\d+)?)% wysysania życia$/.exec(raw))) b.lifeLeech = Number(m[1]);
    else if ((m = /^\+(\d+(?:\.\d+)?)% wysysania many$/.exec(raw))) b.manaLeech = Number(m[1]);
    else if ((m = /^perfect shot \(\+(\d+) at range (\d+)\)$/.exec(raw))) b.perfectShot = { value: Number(m[1]), range: Number(m[2]) };
    else if (IGNORED.test(raw)) continue;
    else issue(`${name}: bonus "${raw}"`);
  }
  return b;
}

function vocationsOf(text, name) {
  if (!text || text === 'Każda') return undefined;
  if (text === 'Tylko bez profesji') return [];
  const out = text.split(/,\s*/).map((s) => VOCATIONS[s.trim().toLowerCase()]);
  if (out.some((v) => !v)) issue(`${name}: vocation "${text}"`);
  return out.filter(Boolean);
}

/** Armory table order on the page: helmets, armors, legs, boots, shields + spellbooks, quivers, trinkets (D137). */
const ARMORY = ['helmet', 'armor', 'legs', 'boots', 'shield', 'quiver', 'trinket'];
/** Equipment page: amulets, rings (other tables are not wearable). */
const JEWELRY = ['amulet', 'ring'];

function toItem(slot, r) {
  const name = r['Nazwa'];
  const vocations = vocationsOf(r['Profesja'], name);
  const bonus = parseBonus(r['Speciale'] ?? r['Działanie'], name);
  const mage = vocations?.every((v) => v === 'sorcerer' || v === 'druid');
  const item = { id: slug(name), name, slot: slot === 'shield' && mage ? 'spellbook' : slot };
  if (vocations) item.vocations = vocations;
  item.minLevel = int(r['Min.; lvl']) ?? 0;
  const arm = int(r['Arm']);
  if (arm) item.armor = arm;
  const def = int(r['Def']);
  if (def) item.defense = def;
  const cls = int(r['Klas.']);
  if (cls) item.class = cls;
  const slots = int(r['Sloty']);
  if (slots) item.imbuementSlots = slots;
  if (Object.keys(bonus).length) item.bonus = bonus;
  return item;
}

const useful = (it) => it.bonus || it.armor || it.defense || it.imbuementSlots || it.class;

const armory = tables(await cached('armory.html', '/items/armory'));
const jewelry = tables(await cached('equipment.html', '/items/equipment'));
const items = [];
const seen = new Set();
const push = (slot, rows) => {
  const list = rows.filter((r) => r['Nazwa']).map((r) => toItem(slot, r)).filter((it) => useful(it) && it.vocations?.length !== 0);
  const count = list.reduce((m, it) => m.set(it.id, (m.get(it.id) ?? 0) + 1), new Map());
  for (const it of list) {
    // Same name, one variant per skill (e.g. Enchanted Werewolf Helmet): named after its first skill.
    const tag = Object.keys(it.bonus?.skills ?? {})[0];
    if (count.get(it.id) > 1 && tag) {
      it.name = `${it.name} (${tag})`;
      it.id = slug(it.name);
    }
    if (seen.has(it.id)) {
      issue(`duplicate "${it.name}", keeping the first`);
      continue;
    }
    seen.add(it.id);
    items.push(it);
  }
};
ARMORY.forEach((slot, i) => push(slot, armory[i] ?? []));
JEWELRY.forEach((slot, i) => push(slot, jewelry[i] ?? []));
items.sort((a, b) => a.slot.localeCompare(b.slot) || a.minLevel - b.minLevel || a.name.localeCompare(b.name));

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ meta: { sources: [`${SITE}/items/armory`, `${SITE}/items/equipment`], items: items.length, issues }, items }) + '\n');
const bySlot = items.reduce((a, it) => ((a[it.slot] = (a[it.slot] ?? 0) + 1), a), {});
console.log(`${items.length} items`, bySlot, `${issues.length} issues`);
