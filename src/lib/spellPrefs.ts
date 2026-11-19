/**
 * Rotation choice, forced spells (stage II subset), forced revelation stages and stance (D20/D21/D32/D35):
 * per-vocation localStorage and URL keys `r` / `fs` / `fs2` / `fr` / `st`. Pure.
 */
import type { ForcedRevelation, Vocation } from '../types';

export interface SpellPrefs {
  /** Rotation preset id; null = auto (engine picks the best). */
  rotationId: string | null;
  forcedSpells: string[];
  /** D35: forced spells whose augment must reach stage II. */
  forcedStage2: string[];
  /** D35: revelations forced to at least a stage. */
  forcedRevelations: ForcedRevelation[];
  /** D32: stance set key ('' = none, names joined by STANCE_SEP); null = auto. */
  stance: string | null;
}

export const EMPTY_SPELL_PREFS: SpellPrefs = { rotationId: null, forcedSpells: [], forcedStage2: [], forcedRevelations: [], stance: null };
export const STANCE_SEP = '+';
export const stanceNames = (key: string) => (key ? key.split(STANCE_SEP) : []);
export const MAX_FORCED_SPELLS = 8;

export const spellPrefsStorageKey = (vocation: Vocation) => `wheel-optimizer:spells:v1:${vocation}`;

const R_KEY = 'r';
const FS_KEY = 'fs';
const ST_KEY = 'st';
const FS2_KEY = 'fs2';
const FR_KEY = 'fr';
const SEP = ',';

/** Keeps only known ids/spells (canonical casing), unique, at most MAX_FORCED_SPELLS. */
export function sanitizeSpellPrefs(
  raw: unknown,
  rotationIds: readonly string[],
  spells: readonly string[],
  stances: readonly string[] = [],
  revelations: readonly string[] = [],
): SpellPrefs {
  if (!raw || typeof raw !== 'object') return EMPTY_SPELL_PREFS;
  const { rotationId, forcedSpells, forcedStage2, forcedRevelations, stance } = raw as Record<string, unknown>;
  const byLower = new Map(spells.map((s) => [s.toLowerCase(), s]));
  const forced: string[] = [];
  if (Array.isArray(forcedSpells)) {
    for (const s of forcedSpells) {
      const name = typeof s === 'string' ? byLower.get(s.trim().toLowerCase()) : undefined;
      if (name && !forced.includes(name)) forced.push(name);
      if (forced.length >= MAX_FORCED_SPELLS) break;
    }
  }
  const stage2 = Array.isArray(forcedStage2) ? forced.filter((s) => forcedStage2.some((x) => typeof x === 'string' && x.trim().toLowerCase() === s.toLowerCase())) : [];
  const revs: ForcedRevelation[] = [];
  if (Array.isArray(forcedRevelations)) {
    for (const f of forcedRevelations) {
      const { name, stage } = (f ?? {}) as Record<string, unknown>;
      if (typeof name === 'string' && revelations.includes(name) && (stage === 1 || stage === 2 || stage === 3) && !revs.some((r) => r.name === name)) revs.push({ name, stage });
    }
  }
  return {
    rotationId: typeof rotationId === 'string' && rotationIds.includes(rotationId) ? rotationId : null,
    forcedSpells: forced,
    forcedStage2: stage2,
    forcedRevelations: revs,
    stance: typeof stance === 'string' && stances.includes(stance) ? stance : null,
  };
}

export function parseSpellPrefs(
  json: string | null,
  rotationIds: readonly string[],
  spells: readonly string[],
  stances: readonly string[] = [],
  revelations: readonly string[] = [],
): SpellPrefs {
  if (!json) return EMPTY_SPELL_PREFS;
  try {
    return sanitizeSpellPrefs(JSON.parse(json), rotationIds, spells, stances, revelations);
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
  stances: readonly string[] = [],
  revelations: readonly string[] = [],
): SpellPrefs | undefined {
  const q = new URLSearchParams(search);
  if (![R_KEY, FS_KEY, FS2_KEY, FR_KEY, ST_KEY, 'v'].some((k) => q.has(k))) return undefined;
  const forcedRevelations = (q.get(FR_KEY) ?? '')
    .split(SEP)
    .map((x) => {
      const i = x.lastIndexOf(':');
      return { name: x.slice(0, i), stage: Number(x.slice(i + 1)) };
    });
  return sanitizeSpellPrefs(
    { rotationId: q.get(R_KEY), forcedSpells: (q.get(FS_KEY) ?? '').split(SEP), forcedStage2: (q.get(FS2_KEY) ?? '').split(SEP), forcedRevelations, stance: q.get(ST_KEY) },
    rotationIds,
    spells,
    stances,
    revelations,
  );
}

/** Writes `r` / `fs` into `search` (omitted when auto / empty), preserving other params. */
export function spellPrefsToQuery(prefs: SpellPrefs, search = ''): string {
  const q = new URLSearchParams(search);
  if (prefs.rotationId) q.set(R_KEY, prefs.rotationId);
  else q.delete(R_KEY);
  if (prefs.forcedSpells.length) q.set(FS_KEY, prefs.forcedSpells.join(SEP));
  else q.delete(FS_KEY);
  if (prefs.forcedStage2.length) q.set(FS2_KEY, prefs.forcedStage2.join(SEP));
  else q.delete(FS2_KEY);
  if (prefs.forcedRevelations.length) q.set(FR_KEY, prefs.forcedRevelations.map((f) => `${f.name}:${f.stage}`).join(SEP));
  else q.delete(FR_KEY);
  if (prefs.stance !== null) q.set(ST_KEY, prefs.stance);
  else q.delete(ST_KEY);
  return `?${q.toString()}`;
}
