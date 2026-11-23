/**
 * Data module public API.
 *
 * The monster dataset is generated offline from tibiopedia.pl by
 * `npm run scrape:monsters` (scripts/scrape-monsters.ts) and shipped as a static
 * JSON file. See docs/modules/data.md.
 */
import type { Element, Monster } from '../types';
import { ATTACK_ELEMENTS } from '../types';
import monstersJson from './monsters.json';
export { spotsWithMonster, type HuntingSpot } from './spots';

/** All known monsters, sorted by name. */
export const MONSTERS: Monster[] = monstersJson;

/** Lowercase, diacritic-free, whitespace-collapsed form used for matching. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface IndexEntry {
  monster: Monster;
  norm: string;
  words: string[];
}

const INDEX: IndexEntry[] = MONSTERS.map((monster) => {
  const norm = normalizeText(monster.name);
  return { monster, norm, words: norm.split(' ') };
});

const BY_ID = new Map<string, Monster>(MONSTERS.map((m) => [m.id, m]));

/** Lower rank = better match; undefined = no match. */
function rankMatch(entry: IndexEntry, q: string): number | undefined {
  if (entry.norm === q) return 0;
  if (entry.norm.startsWith(q)) return 1;
  // A later word (or run of words) starts with the query: "lord" → "Dragon Lord".
  if (entry.words.some((_, i) => i > 0 && entry.words.slice(i).join(' ').startsWith(q))) return 2;
  if (entry.norm.includes(q)) return 3;
  // Fallback: ignore spaces entirely ("dragonlord" → "Dragon Lord").
  if (entry.norm.replace(/ /g, '').includes(q.replace(/ /g, ''))) return 4;
  return undefined;
}

/**
 * Case- and diacritic-insensitive search, best matches first.
 * Ranking: exact > prefix > word-prefix > substring > space-insensitive
 * substring; ties are broken by name length, then alphabetically.
 */
export function searchMonsters(query: string, limit = 10): Monster[] {
  const q = normalizeText(query);
  if (!q || limit <= 0) return [];
  const hits: { entry: IndexEntry; rank: number }[] = [];
  for (const entry of INDEX) {
    const rank = rankMatch(entry, q);
    if (rank !== undefined) hits.push({ entry, rank });
  }
  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.entry.norm.length - b.entry.norm.length ||
      a.entry.monster.name.localeCompare(b.entry.monster.name, 'en'),
  );
  return hits.slice(0, limit).map((h) => h.entry.monster);
}

export function getMonsterById(id: string): Monster | undefined {
  return BY_ID.get(id);
}

/** Damage-taken percentage for an element (missing = 100, neutral). */
export function getModifier(monster: Monster, element: Element): number {
  return monster.elementModifiers[element] ?? 100;
}

/**
 * Attack elements sorted from the one the monster takes the MOST damage from
 * to the one it takes the least from. Immune elements (0%) are excluded.
 */
export function getWeakestElements(
  monster: Monster,
  elements: readonly Element[] = ATTACK_ELEMENTS,
): { element: Element; modifier: number }[] {
  return elements
    .map((element) => ({ element, modifier: getModifier(monster, element) }))
    .filter((e) => e.modifier > 0)
    .sort((a, b) => b.modifier - a.modifier);
}

/**
 * Attack elements the monster resists (modifier < 100), strongest
 * resistance first (immunities, 0%, come first).
 */
export function getStrongestElements(
  monster: Monster,
  elements: readonly Element[] = ATTACK_ELEMENTS,
): { element: Element; modifier: number }[] {
  return elements
    .map((element) => ({ element, modifier: getModifier(monster, element) }))
    .filter((e) => e.modifier < 100)
    .sort((a, b) => a.modifier - b.modifier);
}

/** Single best attack element against this monster (ties: ATTACK_ELEMENTS order). */
export function getBestAttackElement(monster: Monster): Element {
  return getWeakestElements(monster)[0]?.element ?? 'physical';
}
