/**
 * Rotation choice, forced spells (stage II subset), forced revelation stages, stance and excluded spells
 * (D20/D21/D32/D35/D92), own average targets (D107) and the forced number of gem vessels (D116): per-vocation localStorage
 * and URL keys `r` / `fs` / `fs2` / `fr` / `st` / `cr` / `xs` / `tg` / `mv`. Pure.
 */
import type { ForcedRevelation, RotationSpell, Vocation } from '../types';

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
  /** D70: the user's own rotation (used when `rotationId` is `custom`). */
  customRotation: RotationSpell[];
  /** D92: spells the player does not cast. */
  excludedSpells: string[];
  /** D107: the player's average targets per cast when hunting (spell → targets); absent = community average. */
  targets: Record<string, number>;
  /** D116: minimum number of unlocked gem vessels; 0 = auto. */
  minVessels: number;
  /** D122: share of rotation turns with an auto-attack (%); null = vocation default. */
  autoAttack: number | null;
}

export const EMPTY_SPELL_PREFS: SpellPrefs = { rotationId: null, forcedSpells: [], forcedStage2: [], forcedRevelations: [], stance: null, customRotation: [], excludedSpells: [], targets: {}, minVessels: 0, autoAttack: null };
/** D116: gem vessels of the current wheel. */
export const MAX_VESSELS = 8;
export const MAX_CUSTOM_SPELLS = 8;
export const MAX_CUSTOM_RATIO = 20;

/** D70: known spells only (canonical casing), unique, whole casts 1..MAX_CUSTOM_RATIO, at most MAX_CUSTOM_SPELLS. */
export function sanitizeCustomSpells(raw: unknown, allowed: readonly string[]): RotationSpell[] {
  if (!Array.isArray(raw)) return [];
  const byLower = new Map(allowed.map((s) => [s.toLowerCase(), s]));
  const out: RotationSpell[] = [];
  for (const x of raw) {
    const { name, ratio } = (x ?? {}) as Record<string, unknown>;
    const n = typeof name === 'string' ? byLower.get(name.trim().toLowerCase()) : undefined;
    const r = typeof ratio === 'number' && Number.isFinite(ratio) ? Math.round(ratio) : NaN;
    if (!n || !(r >= 1) || out.some((s) => s.name === n)) continue;
    out.push({ name: n, ratio: Math.min(MAX_CUSTOM_RATIO, r) });
    if (out.length >= MAX_CUSTOM_SPELLS) break;
  }
  return out;
}
/** D92: known spells only (canonical casing), unique. */
function knownSpells(raw: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const byLower = new Map(allowed.map((s) => [s.toLowerCase(), s]));
  const out: string[] = [];
  for (const x of raw) {
    const n = typeof x === 'string' ? byLower.get(x.trim().toLowerCase()) : undefined;
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}
export const MAX_SPELL_TARGETS = 50;
/** D107: known spells only (canonical casing), targets rounded to 0.1 within 1..MAX_SPELL_TARGETS. */
export function sanitizeTargets(raw: unknown, allowed: readonly string[]): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const byLower = new Map(allowed.map((s) => [s.toLowerCase(), s]));
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const n = byLower.get(k.trim().toLowerCase());
    const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    if (n && Number.isFinite(x)) out[n] = Math.min(MAX_SPELL_TARGETS, Math.max(1, Math.round(x * 10) / 10));
  }
  return out;
}
export const STANCE_SEP = '+';
export const stanceNames = (key: string) => (key ? key.split(STANCE_SEP) : []);
export const MAX_FORCED_SPELLS = 8;

export const spellPrefsStorageKey = (vocation: Vocation) => `wheel-optimizer:spells:v1:${vocation}`;

const R_KEY = 'r';
const FS_KEY = 'fs';
const ST_KEY = 'st';
const FS2_KEY = 'fs2';
const FR_KEY = 'fr';
const CR_KEY = 'cr';
const XS_KEY = 'xs';
const TG_KEY = 'tg';
const MV_KEY = 'mv';
const AA_KEY = 'aa';
const SEP = ',';

/** Keeps only known ids/spells (canonical casing), unique, at most MAX_FORCED_SPELLS. */
export function sanitizeSpellPrefs(
  raw: unknown,
  rotationIds: readonly string[],
  spells: readonly string[],
  stances: readonly string[] = [],
  revelations: readonly string[] = [],
  customSpells: readonly string[] = [],
  /** D92: spells that can be excluded. */
  excludable: readonly string[] = [],
): SpellPrefs {
  if (!raw || typeof raw !== 'object') return EMPTY_SPELL_PREFS;
  const { rotationId, forcedSpells, forcedStage2, forcedRevelations, stance, customRotation, excludedSpells, targets, minVessels, autoAttack } = raw as Record<string, unknown>;
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
    customRotation: sanitizeCustomSpells(customRotation, customSpells),
    excludedSpells: knownSpells(excludedSpells, excludable),
    targets: sanitizeTargets(targets, excludable),
    minVessels: sanitizeMinVessels(minVessels),
    autoAttack: sanitizeAutoAttack(autoAttack),
  };
}

/** D122: whole percent 0..100 (anything else = vocation default). */
export function sanitizeAutoAttack(raw: unknown): number | null {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
}

/** D116: whole number 0..MAX_VESSELS (anything else = auto). */
export function sanitizeMinVessels(raw: unknown): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_VESSELS ? n : 0;
}

export function parseSpellPrefs(
  json: string | null,
  rotationIds: readonly string[],
  spells: readonly string[],
  stances: readonly string[] = [],
  revelations: readonly string[] = [],
  customSpells: readonly string[] = [],
  /** D92: spells that can be excluded. */
  excludable: readonly string[] = [],
): SpellPrefs {
  if (!json) return EMPTY_SPELL_PREFS;
  try {
    return sanitizeSpellPrefs(JSON.parse(json), rotationIds, spells, stances, revelations, customSpells, excludable);
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
  customSpells: readonly string[] = [],
  /** D92: spells that can be excluded. */
  excludable: readonly string[] = [],
): SpellPrefs | undefined {
  const q = new URLSearchParams(search);
  if (![R_KEY, FS_KEY, FS2_KEY, FR_KEY, ST_KEY, CR_KEY, XS_KEY, TG_KEY, MV_KEY, AA_KEY, 'v'].some((k) => q.has(k))) return undefined;
  const customRotation = (q.get(CR_KEY) ?? '')
    .split(SEP)
    .map((x) => {
      const i = x.lastIndexOf(':');
      return { name: x.slice(0, i), ratio: Number(x.slice(i + 1)) };
    });
  const forcedRevelations = (q.get(FR_KEY) ?? '')
    .split(SEP)
    .map((x) => {
      const i = x.lastIndexOf(':');
      return { name: x.slice(0, i), stage: Number(x.slice(i + 1)) };
    });
  const targets = Object.fromEntries(
    (q.get(TG_KEY) ?? '')
      .split(SEP)
      .map((x) => {
        const i = x.lastIndexOf(':');
        return [x.slice(0, i), x.slice(i + 1)];
      }),
  );
  return sanitizeSpellPrefs(
    { targets, minVessels: q.get(MV_KEY), autoAttack: q.get(AA_KEY), rotationId: q.get(R_KEY), forcedSpells: (q.get(FS_KEY) ?? '').split(SEP), forcedStage2: (q.get(FS2_KEY) ?? '').split(SEP), forcedRevelations, stance: q.get(ST_KEY), customRotation, excludedSpells: (q.get(XS_KEY) ?? '').split(SEP) },
    rotationIds,
    spells,
    stances,
    revelations,
    customSpells,
    excludable,
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
  if (prefs.customRotation?.length) q.set(CR_KEY, prefs.customRotation.map((s) => `${s.name}:${s.ratio}`).join(SEP));
  else q.delete(CR_KEY);
  if (prefs.excludedSpells?.length) q.set(XS_KEY, prefs.excludedSpells.join(SEP));
  else q.delete(XS_KEY);
  const tg = Object.entries(prefs.targets ?? {});
  if (tg.length) q.set(TG_KEY, tg.map(([n, v]) => `${n}:${v}`).join(SEP));
  else q.delete(TG_KEY);
  if (prefs.minVessels) q.set(MV_KEY, String(prefs.minVessels));
  else q.delete(MV_KEY);
  if (prefs.autoAttack !== null && prefs.autoAttack !== undefined) q.set(AA_KEY, String(prefs.autoAttack));
  else q.delete(AA_KEY);
  return `?${q.toString()}`;
}
