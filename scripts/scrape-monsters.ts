/**
 * Offline monster scraper for tibiopedia.pl.
 *
 * Usage:
 *   npm run scrape:monsters              # full run (uses HTML cache when present)
 *   npm run scrape:monsters -- --limit 20  # only the first 20 monsters (debugging)
 *   npm run scrape:monsters -- --refresh   # ignore the cache and re-download
 *
 * Output: src/data/monsters.json (array of `Monster`, sorted by name).
 * Raw HTML is cached in scripts/.cache/ (gitignored) so re-runs do not hit the site.
 *
 * See docs/modules/data.md for the page structure and the parsing rules.
 */
import { load, type CheerioAPI } from 'cheerio';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Element, Monster } from '../src/types/index.ts';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE = 'https://tibiopedia.pl';
const LIST_URL = `${BASE}/monsters/all`;
/** The site shows a language "setup" splash page unless these cookies are set. */
const COOKIE = 'tp_lang=pl; tp_layout=library';
const USER_AGENT =
  'Mozilla/5.0 (compatible; TibiaWheelOptimizer-DataScraper/1.0; offline one-off data import)';
const DELAY_MS = 400;
const CONCURRENCY = 2;
const MAX_RETRIES = 4;

/**
 * Sections of the /monsters/all page that we import. Gladiator arena,
 * event-only and trap "monsters" are skipped — they are not hunting targets.
 */
const INCLUDED_SECTIONS = [
  'Potwory', // regular (bestiary) monsters
  'Bossy', // bosses
  'Potwory powiązane z questami', // quest monsters
  'Pozostałe', // other
];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, 'scripts', '.cache');
const OUT_FILE = join(ROOT, 'src', 'data', 'monsters.json');

// ---------------------------------------------------------------------------
// Element mapping
// ---------------------------------------------------------------------------

/**
 * Resistance icons: `images/static/elements/<Name>.gif` (language independent).
 * The Polish `title` attribute is used as a fallback.
 */
const RESIST_ICON_TO_ELEMENT: Record<string, Element> = {
  physical: 'physical',
  fire: 'fire',
  earth: 'earth',
  energy: 'energy',
  ice: 'ice',
  holy: 'holy',
  death: 'death',
  lifedrain: 'lifeDrain',
  manadrain: 'manaDrain',
  drown: 'drown',
  drowning: 'drown',
  healing: 'healing',
};

/** Polish labels (normalized: lowercase, no diacritics) → element. */
const POLISH_TO_ELEMENT: Record<string, Element> = {
  'ataki fizyczne': 'physical',
  fizyczne: 'physical',
  ogien: 'fire',
  ziemia: 'earth',
  energia: 'energy',
  lod: 'ice',
  swietosc: 'holy',
  swiety: 'holy',
  smierc: 'death',
  'wysysanie zycia': 'lifeDrain',
  'wysysanie many': 'manaDrain',
  toniecie: 'drown',
  leczenie: 'healing',
};

/**
 * Attack icons: `images/static/attacks/elem_<name>.gif`. Only damage-dealing
 * elements are mapped; `heal` (the monster healing itself) is ignored.
 */
const ATTACK_ICON_TO_ELEMENT: Record<string, Element> = {
  physical: 'physical',
  fire: 'fire',
  earth: 'earth',
  poison: 'earth',
  energy: 'energy',
  ice: 'ice',
  holy: 'holy',
  death: 'death',
  lifedrain: 'lifeDrain',
  life_drain: 'lifeDrain',
  manadrain: 'manaDrain',
  mana_drain: 'manaDrain',
  drown: 'drown',
  drowning: 'drown',
};

/**
 * Older pages list attacks as plain text ("Walka w zwarciu(0-2000)",
 * " - Death Beam(0-600)") without element icons. The element is then inferred
 * from keywords in the spell name; unrecognised spells are ignored.
 */
const SPELL_KEYWORDS: [RegExp, Element][] = [
  [/life ?drain|vampir|blood suck/i, 'lifeDrain'],
  [/mana ?drain|mana ?leech/i, 'manaDrain'],
  [/drown/i, 'drown'],
  [/fire|flame|burn|lava|heat|inferno|magma|explosion|ember/i, 'fire'],
  [/energy|electric|lightning|thunder|spark|shock|plasma/i, 'energy'],
  [/\bice\b|frost|cold|freez|snow|glacier|blizzard|icicle/i, 'ice'],
  [/poison|earth|venom|acid|toxic|stalagmite|envenom|slime/i, 'earth'],
  [/death|curse|skull|mort|soul|necro|undead/i, 'death'],
  [/holy|divine|light|sacred|smite|shine/i, 'holy'],
  [/melee|zwarciu|physical|stone|rock|throw|spear|arrow|bolt|boulder|whirlwind|berserk|bite|strike/i, 'physical'],
];

export function parseLegacyAttacks(text: string): { damage: Element[]; maxHit?: number } {
  const damage = new Set<Element>();
  let maxHit: number | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s*-\s*/, '').trim();
    if (!line || /^magia:?$/i.test(line) || /heal|leczen|summon|haste|invisib|outfit|paraly/i.test(line)) continue;
    const name = line.replace(/\(.*$/, '');
    const el = /walka w zwarciu/i.test(name)
      ? 'physical'
      : SPELL_KEYWORDS.find(([re]) => re.test(name))?.[1];
    if (!el) continue;
    damage.add(el);
    const range = line.match(/\((?:\s*\d+\s*-\s*)?(\d+)\s*\)/);
    if (range) {
      const hi = Number(range[1]);
      if (hi > 0 && (maxHit === undefined || hi > maxHit)) maxHit = hi;
    }
  }
  return { damage: [...damage], maxHit };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function stripDiacritics(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L');
}

export function slugify(name: string): string {
  return stripDiacritics(name)
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseIntLoose(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const digits = text.replace(/[\s.,]/g, '').match(/^\d+$/);
  return digits ? Number(digits[0]) : undefined;
}

function iconBaseName(src: string | undefined): string {
  if (!src) return '';
  const file = src.split('/').pop() ?? '';
  return file.replace(/\.(gif|png|jpg)$/i, '').toLowerCase();
}

function cacheFileFor(url: string): string {
  const key = url.replace(BASE, '').replace(/^\/+/, '').replace(/[^A-Za-z0-9_.-]+/g, '_');
  return join(CACHE_DIR, `${key || 'index'}.html`);
}

let lastRequestAt = 0;

async function fetchHtml(url: string, refresh: boolean): Promise<string> {
  const file = cacheFileFor(url);
  if (!refresh && existsSync(file)) return readFileSync(file, 'utf8');

  for (let attempt = 0; ; attempt++) {
    // Global politeness delay between network requests.
    const wait = lastRequestAt + DELAY_MS - Date.now();
    lastRequestAt = Date.now() + Math.max(0, wait);
    if (wait > 0) await sleep(wait);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Cookie: COOKIE, 'Accept-Language': 'pl,en;q=0.5' },
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      if (html.includes('id="setupForm"')) throw new Error('got language setup page (cookie ignored)');
      writeFileSync(file, html, 'utf8');
      return html;
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw new Error(`Failed to fetch ${url}: ${String(err)}`);
      const backoff = 1000 * 2 ** attempt;
      console.warn(`  retry ${attempt + 1}/${MAX_RETRIES} for ${url} in ${backoff} ms (${String(err)})`);
      await sleep(backoff);
    }
  }
}

// ---------------------------------------------------------------------------
// List page
// ---------------------------------------------------------------------------

export interface ListEntry {
  name: string;
  url: string;
  section: string;
  imageUrl?: string;
  experience?: number;
  hitpoints?: number;
}

export function parseListPage(html: string): ListEntry[] {
  const $ = load(html);
  const out: ListEntry[] = [];
  $('table').each((_, table) => {
    const caption = $(table).children('caption').first();
    if (!caption.length) return;
    const section = caption.clone().children().remove().end().text().trim();
    if (!INCLUDED_SECTIONS.includes(section)) return;
    $(table)
      .find('tr')
      .each((__, tr) => {
        const tds = $(tr).children('td');
        const link = tds.eq(1).find('a[href*="/monsters/"]').first();
        if (!link.length) return;
        out.push({
          name: link.text().trim(),
          url: link.attr('href')!,
          section,
          imageUrl: tds.eq(0).find('img').attr('src'),
          experience: parseIntLoose(tds.eq(2).text()),
          hitpoints: parseIntLoose(tds.eq(3).text()),
        });
      });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Detail page
// ---------------------------------------------------------------------------

export interface DetailParse {
  name?: string;
  imageUrl?: string;
  experience?: number;
  hitpoints?: number;
  elementModifiers: Partial<Record<Element, number>>;
  damageTypes: Element[];
  maxDamage?: number;
  unknownIcons: string[];
}

function elementFromResistBox($: CheerioAPI, box: Parameters<CheerioAPI>[0]): Element | undefined {
  const img = $(box).find('img').first();
  const byIcon = RESIST_ICON_TO_ELEMENT[iconBaseName(img.attr('src'))];
  if (byIcon) return byIcon;
  const title = stripDiacritics(img.attr('title') ?? '')
    .toLowerCase()
    .replace(/\(.*\)/, '')
    .trim();
  return POLISH_TO_ELEMENT[title];
}

/**
 * Converts a resistance box into "percent of damage taken".
 * The site shows the *resistance*: "+80%" = takes 80% less (→ 20),
 * "-10%" = takes 10% more (→ 110), black box "Niewrażliwość" = immune (→ 0),
 * empty yellow "Neutralność" = 100.
 */
export function modifierFromResistBox(valueText: string, hint: string): number | undefined {
  const text = valueText.replace(/ /g, ' ').trim();
  const m = text.match(/^([+\-−]?)\s*(\d+(?:[.,]\d+)?)\s*%$/);
  if (m) {
    const v = Number(m[2].replace(',', '.'));
    const sign = m[1] === '-' || m[1] === '−' ? -1 : 1;
    return Math.round(100 - sign * v);
  }
  const h = stripDiacritics(hint).toLowerCase();
  if (h.includes('niewrazliw')) return 0;
  if (h.includes('neutral')) return 100;
  return undefined;
}

export function parseDetailPage(html: string): DetailParse {
  const $ = load(html);
  const detail = $('#monsterDetail');
  const unknownIcons: string[] = [];

  const name = detail.children('caption').first().contents().first().text().trim() || undefined;
  const imageUrl = detail.find('td.monsterPic img').first().attr('src');

  let experience: number | undefined;
  let hitpoints: number | undefined;
  detail.find('table.monster_base_stats tr').each((_, tr) => {
    const label = stripDiacritics($(tr).children('td').first().text()).toLowerCase().trim();
    const value = parseIntLoose($(tr).find('strong').first().text());
    if (label.startsWith('doswiadczenie')) experience = value;
    else if (label.startsWith('zycie')) hitpoints = value;
  });

  // Resistances
  const elementModifiers: Partial<Record<Element, number>> = {};
  detail.find('.monster_resist').each((_, box) => {
    const el = elementFromResistBox($, box);
    const valueDiv = $(box).children('div').first();
    if (!el) {
      unknownIcons.push(`resist:${iconBaseName($(box).find('img').attr('src'))}`);
      return;
    }
    const mod = modifierFromResistBox(valueDiv.text(), valueDiv.attr('title') ?? '');
    if (mod !== undefined) elementModifiers[el] = mod;
  });

  // Damage types: attack list icons + DPS breakdown table.
  const damage = new Set<Element>();
  let maxAttack: number | undefined;
  detail.find('img[src*="/attacks/elem_"]').each((_, img) => {
    const key = iconBaseName($(img).attr('src')).replace(/^elem_/, '');
    if (key === 'heal' || key === 'healing' || key === 'agony') return;
    const el = ATTACK_ICON_TO_ELEMENT[key];
    if (el) damage.add(el);
    else unknownIcons.push(`attack:${key}`);
  });
  detail.find('span[class^="att_color_"]').each((_, span) => {
    if ($(span).attr('class')?.includes('heal')) return;
    const range = $(span).text().match(/(\d+)\s*-\s*(\d+)/);
    const single = $(span).text().match(/^\s*(\d+)\s*$/);
    const hi = range ? Number(range[2]) : single ? Number(single[1]) : undefined;
    if (hi !== undefined && (maxAttack === undefined || hi > maxAttack)) maxAttack = hi;
  });

  if (damage.size === 0) {
    const legacy = detail
      .find('td.monsterDetRowT')
      .filter((_, td) => $(td).text().trim().startsWith('Ataki'))
      .first()
      .closest('tr')
      .next('tr')
      .find('div')
      .first();
    const html = legacy.html();
    if (html) {
      const parsed = parseLegacyAttacks(load(html.replace(/<br\s*\/?>/gi, '\n')).text());
      parsed.damage.forEach((e) => damage.add(e));
      if (parsed.maxHit !== undefined && (maxAttack === undefined || parsed.maxHit > maxAttack)) maxAttack = parsed.maxHit;
    }
  }

  const dpsMatch = detail.find('table.monster_dmg_types').text().match(/Max DPS:\s*(\d+)/i);
  const maxDamage = dpsMatch ? Number(dpsMatch[1]) : maxAttack;

  // Keep a stable order following the Element union.
  const order: Element[] = [
    'physical', 'fire', 'earth', 'energy', 'ice', 'holy', 'death',
    'lifeDrain', 'manaDrain', 'drown', 'healing',
  ];
  const damageTypes = order.filter((e) => damage.has(e));
  const orderedModifiers: Partial<Record<Element, number>> = {};
  for (const e of order) if (elementModifiers[e] !== undefined) orderedModifiers[e] = elementModifiers[e];

  return {
    name,
    imageUrl,
    experience,
    hitpoints,
    elementModifiers: orderedModifiers,
    damageTypes,
    maxDamage,
    unknownIcons,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes('--refresh');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;

  mkdirSync(CACHE_DIR, { recursive: true });

  console.log(`Fetching list: ${LIST_URL}`);
  const listHtml = await fetchHtml(LIST_URL, refresh);
  const seen = new Set<string>();
  const entries = parseListPage(listHtml).filter((e) => {
    if (seen.has(e.url)) return false;
    seen.add(e.url);
    return true;
  });
  const todo = entries.slice(0, limit);
  console.log(`Found ${entries.length} monsters in included sections; processing ${todo.length}.`);

  const results: (Monster | null)[] = new Array(todo.length).fill(null);
  const unknown = new Map<string, number>();
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < todo.length) {
      const i = next++;
      const entry = todo[i];
      try {
        const html = await fetchHtml(entry.url, refresh);
        const d = parseDetailPage(html);
        d.unknownIcons.forEach((k) => unknown.set(k, (unknown.get(k) ?? 0) + 1));
        const name = d.name ?? entry.name;
        const m: Monster = {
          id: slugify(name),
          name,
          elementModifiers: d.elementModifiers,
          damageTypes: d.damageTypes,
        };
        // The site uses "0" HP as a placeholder for "unknown"; then exp is unknown too.
        const hp = d.hitpoints ?? entry.hitpoints;
        const exp = d.experience ?? entry.experience;
        if (hp !== undefined && hp > 0) {
          m.hitpoints = hp;
          if (exp !== undefined) m.experience = exp;
        } else if (exp !== undefined && exp > 0) m.experience = exp;
        if (d.maxDamage !== undefined) m.maxDamage = d.maxDamage;
        const img = d.imageUrl ?? entry.imageUrl;
        if (img) m.imageUrl = img;
        m.sourceUrl = entry.url;
        results[i] = m;
      } catch (err) {
        console.error(`  ! ${entry.name}: ${String(err)}`);
      }
      done++;
      if (done % 50 === 0 || done === todo.length) console.log(`  ${done}/${todo.length}`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Deduplicate ids (append -2, -3 … on collisions) and sort by name.
  const monsters = results.filter((m): m is Monster => m !== null);
  monsters.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const ids = new Map<string, number>();
  for (const m of monsters) {
    const n = (ids.get(m.id) ?? 0) + 1;
    ids.set(m.id, n);
    if (n > 1) m.id = `${m.id}-${n}`;
  }

  writeFileSync(OUT_FILE, JSON.stringify(monsters, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${monsters.length} monsters to ${OUT_FILE}`);
  if (unknown.size) console.log('Unmapped icons:', Object.fromEntries(unknown));
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
