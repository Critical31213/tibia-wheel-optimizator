/** Rotation choice + forced spells (D20/D21): per-vocation localStorage and URL keys `r` / `fs`. Pure. */
import type { Vocation } from '../types';

export interface SpellPrefs {
  /** Rotation preset id; null = auto (engine picks the best). */
  rotationId: string | null;
  forcedSpells: string[];
}

export const EMPTY_SPELL_PREFS: SpellPrefs = { rotationId: null, forcedSpells: [] };
export const MAX_FORCED_SPELLS = 8;

export const spellPrefsStorageKey = (vocation: Vocation) => `wheel-optimizer:spells:v1:${vocation}`;

const R_KEY = 'r';
const FS_KEY = 'fs';
const SEP = ',';

/** Keeps only known ids/spells (canonical casing), unique, at most MAX_FORCED_SPELLS. */
export function sanitizeSpellPrefs(
  raw: unknown,
  rotationIds: readonly string[],
  spells: readonly string[],
): SpellPrefs {
  if (!raw || typeof raw !== 'object') return EMPTY_SPELL_PREFS;
  const { rotationId, forcedSpells } = raw as Record<string, unknown>;
  const byLower = new Map(spells.map((s) => [s.toLowerCase(), s]));
  const forced: string[] = [];
  if (Array.isArray(forcedSpells)) {
    for (const s of forcedSpells) {
      const name = typeof s === 'string' ? byLower.get(s.trim().toLowerCase()) : undefined;
      if (name && !forced.includes(name)) forced.push(name);
      if (forced.length >= MAX_FORCED_SPELLS) break;
    }
  }
  return {
    rotationId: typeof rotationId === 'string' && rotationIds.includes(rotationId) ? rotationId : null,
    forcedSpells: forced,
  };
}

export function parseSpellPrefs(json: string | null, rotationIds: readonly string[], spells: readonly string[]): SpellPrefs {
  if (!json) return EMPTY_SPELL_PREFS;
  try {
    return sanitizeSpellPrefs(JSON.parse(json), rotationIds, spells);
  } catch {
    return EMPTY_SPELL_PREFS;
  }
}

/**
 * Prefs from the URL, or undefined when the link carries none.
 * A full app link (has `v`) without `r`/`fs` means auto / no forced spells.
 */
export function spellPrefsFromQuery(
  search: string,
  rotationIds: readonly string[],
  spells: readonly string[],
): SpellPrefs | undefined {
  const q = new URLSearchParams(search);
  if (!q.has(R_KEY) && !q.has(FS_KEY) && !q.has('v')) return undefined;
  return sanitizeSpellPrefs(
    { rotationId: q.get(R_KEY), forcedSpells: (q.get(FS_KEY) ?? '').split(SEP) },
    rotationIds,
    spells,
  );
}

/** Writes `r` / `fs` into `search` (omitted when auto / empty), preserving other params. */
export function spellPrefsToQuery(prefs: SpellPrefs, search = ''): string {
  const q = new URLSearchParams(search);
  if (prefs.rotationId) q.set(R_KEY, prefs.rotationId);
  else q.delete(R_KEY);
  if (prefs.forcedSpells.length) q.set(FS_KEY, prefs.forcedSpells.join(SEP));
  else q.delete(FS_KEY);
  return `?${q.toString()}`;
}
