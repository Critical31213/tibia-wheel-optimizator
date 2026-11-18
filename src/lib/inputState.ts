/** Serialisation of the user's inputs (URL query string + localStorage). Pure. */
import { VOCATIONS } from '../types';
import type { CharacterStats, FightContext, FightMode, HuntStyle, Vocation } from '../types';
import { clamp } from './labels';

export interface MonsterEntry {
  id: string;
  weight: number;
}

export type SkillField = 'mainSkill' | 'shielding' | 'magicLevel';

export interface InputState {
  vocation: Vocation;
  points: number;
  /** Character level (drives points and character stats); null = not entered. */
  level: number | null;
  /** Promotion scroll points (0–MAX_SCROLLS). */
  scrolls: number;
  mainSkill: number | null;
  shielding: number | null;
  magicLevel: number | null;
  /** Hunting spot: monsters with relative weights (empty = generic build). */
  monsters: MonsterEntry[];
  priority: number;
  mode: FightMode;
  huntStyle: HuntStyle;
}

export const FIGHT_MODES: readonly FightMode[] = ['hunt', 'boss'];
export const HUNT_STYLES: readonly HuntStyle[] = ['solo', 'teamLure', 'teamBox'];

export const DEFAULT_INPUTS: InputState = {
  vocation: 'knight',
  points: 0,
  level: null,
  scrolls: 0,
  mainSkill: null,
  shielding: null,
  magicLevel: null,
  monsters: [],
  priority: 50,
  mode: 'hunt',
  huntStyle: 'solo',
};

export const contextOf = (s: Pick<InputState, 'mode' | 'huntStyle'>): FightContext => ({
  mode: s.mode,
  huntStyle: s.huntStyle,
});

/** Upper bound for point values: total wheel capacity (5 rings, 36 slices, 4000 points) for every vocation. */
export const MAX_POINTS = 4000;
export const MAX_LEVEL = 5000;
export const MAX_SKILL = 200;
export const MAX_SCROLLS = 50;
export const MAX_MONSTERS = 10;
export const MIN_WEIGHT = 0.1;
export const MAX_WEIGHT = 100;

/** Skill fields shown (and sent to the engine) per vocation (D13). */
export const VOCATION_SKILLS: Record<Vocation, readonly SkillField[]> = {
  knight: ['mainSkill', 'shielding'],
  paladin: ['mainSkill', 'shielding', 'magicLevel'],
  sorcerer: ['magicLevel'],
  druid: ['magicLevel'],
  monk: ['mainSkill', 'magicLevel'],
};

const isVocation = (v: unknown): v is Vocation =>
  typeof v === 'string' && (VOCATIONS as readonly string[]).includes(v);

function toInt(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/** Clamps a weight to MIN..MAX_WEIGHT with one decimal; invalid → undefined. */
export function normalizeWeight(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(clamp(n, MIN_WEIGHT, MAX_WEIGHT) * 10) / 10;
}

const MONSTER_ID = /^[a-z0-9-]+$/;

/** Validates a monster list: known id shape, unique, weight default 1, at most MAX_MONSTERS. */
export function sanitizeMonsters(raw: unknown): MonsterEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: MonsterEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { id, weight } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !MONSTER_ID.test(id) || out.some((m) => m.id === id)) continue;
    out.push({ id, weight: normalizeWeight(weight) ?? 1 });
    if (out.length >= MAX_MONSTERS) break;
  }
  return out;
}

function optionalInt(raw: Record<string, unknown>, key: string, min: number, max: number): number | null | undefined {
  if (raw[key] === null) return null;
  const n = toInt(raw[key]);
  return n === undefined ? undefined : n < min ? null : Math.min(n, max);
}

/** Validate an untrusted partial state, dropping invalid fields. */
export function sanitize(raw: Record<string, unknown>): Partial<InputState> {
  const out: Partial<InputState> = {};
  if (isVocation(raw.vocation)) out.vocation = raw.vocation;
  const p = toInt(raw.points);
  if (p !== undefined) out.points = clamp(p, 0, MAX_POINTS);
  const pr = toInt(raw.priority);
  if (pr !== undefined) out.priority = clamp(pr, 0, 100);
  const sc = toInt(raw.scrolls);
  if (sc !== undefined) out.scrolls = clamp(sc, 0, MAX_SCROLLS);
  const lv = optionalInt(raw, 'level', 1, MAX_LEVEL);
  if (lv !== undefined) out.level = lv;
  for (const k of ['mainSkill', 'shielding', 'magicLevel'] as const) {
    const v = optionalInt(raw, k, 0, MAX_SKILL);
    if (v !== undefined) out[k] = v;
  }
  const monsters = sanitizeMonsters(raw.monsters);
  if (monsters) out.monsters = monsters;
  // Legacy (iteration 2) single monster.
  else if (typeof raw.monsterId === 'string' && MONSTER_ID.test(raw.monsterId.trim()))
    out.monsters = [{ id: raw.monsterId.trim(), weight: 1 }];
  if (FIGHT_MODES.includes(raw.mode as FightMode)) out.mode = raw.mode as FightMode;
  if (HUNT_STYLES.includes(raw.huntStyle as HuntStyle)) out.huntStyle = raw.huntStyle as HuntStyle;
  return out;
}

/** `demon*2_dragon-lord` ⇄ [{demon, 2}, {dragon-lord, 1}] (weight 1 omitted). */
export function encodeMonsters(list: readonly MonsterEntry[]): string {
  return list.map((m) => (m.weight === 1 ? m.id : `${m.id}*${m.weight}`)).join('_');
}

export function decodeMonsters(s: string): MonsterEntry[] {
  return sanitizeMonsters(
    s
      .split('_')
      .filter(Boolean)
      .map((part) => {
        const [id, weight] = part.split('*');
        return { id: id.trim(), weight };
      }),
  )!;
}

/** Query param names: short so shared links stay tidy. */
const KEYS = {
  vocation: 'v',
  points: 'p',
  level: 'lv',
  scrolls: 'sc',
  mainSkill: 'sk',
  shielding: 'sh',
  magicLevel: 'ml',
  monsters: 'm',
  priority: 'prio',
  mode: 'f',
  huntStyle: 'h',
} as const;

export function fromQuery(search: string): Partial<InputState> {
  const q = new URLSearchParams(search);
  // A full app link (has `v`) omits empty optional fields: absent means "not set", not "keep stored".
  const empty = q.has(KEYS.vocation) ? null : undefined;
  const get = (k: keyof typeof KEYS) => q.get(KEYS[k]) ?? undefined;
  const opt = (k: keyof typeof KEYS) => q.get(KEYS[k]) ?? empty;
  const m = q.get(KEYS.monsters) ?? (empty === null ? '' : undefined);
  return sanitize({
    vocation: get('vocation'),
    points: get('points'),
    level: opt('level'),
    scrolls: get('scrolls') ?? (empty === null ? 0 : undefined),
    mainSkill: opt('mainSkill'),
    shielding: opt('shielding'),
    magicLevel: opt('magicLevel'),
    priority: get('priority'),
    monsters: m === undefined ? undefined : decodeMonsters(m),
    mode: get('mode'),
    huntStyle: get('huntStyle'),
  });
}

/** Drops monster ids that do not exist in the dataset (stale link / storage). */
export function withKnownMonsters<T extends Partial<InputState>>(state: T, exists: (id: string) => boolean): T {
  if (!state.monsters) return state;
  const known = state.monsters.filter((m) => exists(m.id));
  return known.length === state.monsters.length ? state : { ...state, monsters: known };
}

/** Writes the state into `search`, preserving unrelated params. */
export function toQuery(state: InputState, search = ''): string {
  const q = new URLSearchParams(search);
  const opt = (k: keyof typeof KEYS, v: string | number | null) => {
    if (v === null || v === '') q.delete(KEYS[k]);
    else q.set(KEYS[k], String(v));
  };
  q.set(KEYS.vocation, state.vocation);
  q.set(KEYS.points, String(state.points));
  opt('level', state.level);
  opt('scrolls', state.scrolls || null);
  opt('mainSkill', state.mainSkill);
  opt('shielding', state.shielding);
  opt('magicLevel', state.magicLevel);
  q.set(KEYS.priority, String(state.priority));
  q.set(KEYS.mode, state.mode);
  q.set(KEYS.huntStyle, state.huntStyle);
  opt('monsters', encodeMonsters(state.monsters));
  return `?${q.toString()}`;
}

/**
 * Character stats for the engine: only the vocation's skill fields; undefined when nothing
 * was entered (the engine then estimates from points).
 */
export function characterOf(s: InputState): CharacterStats | undefined {
  const skills = VOCATION_SKILLS[s.vocation];
  const out: CharacterStats = { level: s.level ?? s.points + 50 };
  let any = s.level !== null;
  for (const k of skills) {
    const v = s[k];
    if (v !== null) {
      out[k] = v;
      any = true;
    }
  }
  return any ? out : undefined;
}
