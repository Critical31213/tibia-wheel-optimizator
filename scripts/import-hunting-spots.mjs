/**
 * Offline import of hunting spots (D99): the creatures of every TibiaWiki hunting place, with kill shares where
 * they are reliable.
 *
 * Usage: npm run import:spots [-- --refresh]
 *
 * Sources (cached in scripts/.cache/spots/, see THIRD_PARTY_NOTICES.md):
 * - TibiaWiki: pages of Category:Hunting_Places through the MediaWiki API, `{{CreatureList}}` entries.
 * - TibiaData: last-week kill statistics of every world (tibia.com kill statistics), summed.
 *
 * Kept creatures: known monsters (src/data/monsters.json) with a bestiary class (no bosses); places with at least
 * two of them, recommended above level 100 (MIN_LEVEL). Weights: the creatures' share of weekly kills (%) when every creature of the place is found in the kill
 * statistics and lives in no other hunting place (its kills then come from this place); otherwise 1 for all.
 * At most MAX creatures per place, the most killed first.
 *
 * Output: src/data/spots.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', '.cache', 'spots');
const OUT = join(ROOT, 'src', 'data', 'spots.json');
const WIKI = 'https://tibia.fandom.com/api.php';
const TIBIADATA = 'https://api.tibiadata.com/v4';
const UA = { 'User-Agent': 'wheel-optimizer-research' };
const MAX = 10;
const RARE = 0.01;
/** Places whose highest recommended level is at most this are left out (they still count for shared creatures). */
const MIN_LEVEL = 100;
const refresh = process.argv.includes('--refresh');

mkdirSync(CACHE, { recursive: true });
async function cached(name, url, pause = 800) {
  const file = join(CACHE, name);
  if (!refresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const json = await res.json();
  writeFileSync(file, JSON.stringify(json));
  await new Promise((r) => setTimeout(r, pause));
  return json;
}

const norm = (s) => s.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

// Monsters (bestiary creatures only).
const monsters = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'monsters.json'), 'utf8'));
const byName = new Map(monsters.filter((m) => m.bestiaryClass).map((m) => [norm(m.name), m]));

// Wiki hunting places.
const cat = await cached('category.json', `${WIKI}?action=query&list=categorymembers&cmtitle=Category:Hunting_Places&cmnamespace=0&cmlimit=500&format=json`);
const titles = cat.query.categorymembers.map((m) => m.title).filter((t) => t !== 'Hunting Places');
const places = [];
for (let i = 0; i < titles.length; i += 50) {
  const chunk = titles.slice(i, i + 50);
  const json = await cached(`wiki-${i / 50}.json`, `${WIKI}?action=query&prop=revisions&rvprop=content&rvslots=main&format=json&formatversion=2&titles=${encodeURIComponent(chunk.join('|'))}`);
  for (const p of json.query.pages) {
    const text = p.revisions?.[0]?.slots?.main?.content ?? '';
    const ids = [];
    for (const list of text.matchAll(/\{\{CreatureList([\s\S]*?)\}\}/g)) {
      for (const part of list[1].split('|').slice(1)) {
        const m = byName.get(norm(part.replace(/<!--[\s\S]*?-->/g, '')));
        if (m && !ids.includes(m.id)) ids.push(m.id);
      }
    }
    // Highest recommended level of any vocation ("600?", "80+", "25-50"); unknown = kept.
    const levels = ['lvlknights', 'lvlpaladins', 'lvlmages'].flatMap((k) =>
      (text.match(new RegExp(`\\|\\s*${k}\\s*=\\s*([^|\\n}]*)`))?.[1] ?? '').match(/\d+/g)?.map(Number) ?? [],
    );
    const level = levels.length ? Math.max(...levels) : undefined;
    if (ids.length >= 2) places.push({ name: p.title, ids, low: level !== undefined && level <= MIN_LEVEL });
  }
}

/** Wiki places split into separately hunted spots: place → { spot: creature names }; other creatures are dropped. */
const SPLIT = {
  Podzilla: {
    'Podzilla Quaras': ['Quara Raider', 'Quara Looter', 'Quara Plunderer'],
    'Podzilla Rootthings': ['Rootthing Nutshell', 'Rootthing Bug Tracker', 'Rootthing Amber Shaper'],
  },
};
for (const [place, parts] of Object.entries(SPLIT)) {
  const i = places.findIndex((p) => p.name === place);
  if (i < 0) throw new Error(`split: no place ${place}`);
  const split = Object.entries(parts).map(([name, list]) => ({ name, low: places[i].low, ids: list.map((n) => byName.get(norm(n))?.id ?? fail(`split: unknown ${n}`)) }));
  places.splice(i, 1, ...split);
}
function fail(msg) {
  throw new Error(msg);
}

// Weekly kills of all worlds; races are lowercase plurals ("dragon lords").
const worlds = (await cached('worlds.json', `${TIBIADATA}/worlds`)).worlds.regular_worlds.map((w) => w.name);
const kills = new Map();
for (const w of worlds) {
  const json = await cached(`kills-${w}.json`, `${TIBIADATA}/killstatistics/${encodeURIComponent(w)}`, 300);
  for (const e of json.killstatistics?.entries ?? []) kills.set(norm(e.race), (kills.get(norm(e.race)) ?? 0) + e.last_week_killed);
}
const plurals = (n) => [
  n + 's', n + 'es', n.replace(/y$/, 'ies'), n.replace(/f$/, 'ves'), n.replace(/fe$/, 'ves'), n.replace(/man$/, 'men'),
  n.replace(/us$/, 'i'), n.replace(/^(\S+?)(s?) of /, '$1s of '), n.replace(/^(\S+?)(s?) of /, '$1es of '), n,
];
const byId = new Map(monsters.map((m) => [m.id, m]));
const killsOf = (id) => {
  const key = plurals(norm(byId.get(id).name)).find((k) => kills.has(k));
  return key === undefined ? undefined : kills.get(key);
};

const placesOf = new Map();
for (const p of places) for (const id of p.ids) placesOf.set(id, (placesOf.get(id) ?? 0) + 1);

let weighted = 0;
const spots = places.flatMap((p) => {
  if (p.low) return [];
  const all = p.ids.map((id) => ({ id, kills: killsOf(id) }));
  // Rare creatures (bosses with a bestiary entry, event creatures): under RARE of the most killed one.
  const most = Math.max(0, ...all.map((x) => x.kills ?? 0));
  const k = all.filter((x) => x.kills === undefined || x.kills >= RARE * most);
  k.sort((a, b) => (b.kills ?? 0) - (a.kills ?? 0));
  if (k.length < 2) return [];
  const top = k.slice(0, MAX);
  const sure = k.length <= MAX && top.every((x) => x.kills > 0 && placesOf.get(x.id) === 1);
  const sum = top.reduce((a, x) => a + (x.kills ?? 0), 0);
  if (sure) weighted++;
  return [{ name: p.name, monsters: top.map((x) => ({ id: x.id, weight: sure ? Math.max(1, Math.round((100 * x.kills) / sum)) : 1 })) }];
});
spots.sort((a, b) => a.name.localeCompare(b.name, 'en'));

writeFileSync(
  OUT,
  JSON.stringify({ meta: { sources: ['https://tibia.fandom.com', 'https://api.tibiadata.com'], date: new Date().toISOString().slice(0, 10), spots: spots.length, weighted }, spots }) + '\n',
);
console.log(`${spots.length} spots (${weighted} with kill weights) → ${OUT}`);
