/** Serialisation of the user's inputs (URL query string + localStorage). Pure. */
import { MELEE_SKILLS, VOCATIONS } from '../types';
import { wheelVariants } from '../data/wheel';
import type { CharacterStats, FightContext, FightMode, MeleeSkill, Vocation, WheelVariant } from '../types';
import { clamp, snapPriority } from './labels';

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
  /** Extra points: scrolls, weekly, bounty, gem upgrades (0–MAX_SCROLLS). */
  scrolls: number;
  mainSkill: number | null;
  shielding: number | null;
  magicLevel: number | null;
  /** D51: knight's trained melee skill (null = any weapon type). */
  meleeSkill: MeleeSkill | null;
  /** Hunting spot: monsters with relative weights (empty = generic build). */
  monsters: MonsterEntry[];
  priority: number;
  mode: FightMode;
  /** D88: wheel variant ('current' = announced changes, 'live' = www.tibia.com). */
  wheel: WheelVariant;
}

export const FIGHT_MODES: readonly FightMode[] = ['hunt', 'boss'];

export const DEFAULT_INPUTS: InputState = {
  vocation: 'knight',
  points: 0,
  level: null,
  scrolls: 0,
  mainSkill: null,
  shielding: null,
  magicLevel: null,
  meleeSkill: null,
  monsters: [],
  priority: 50,
  mode: 'hunt',
  wheel: 'current',
};

export const contextOf = (s: Pick<InputState, 'mode'>): FightContext => ({ mode: s.mode });

/** Upper bound for point values: total wheel capacity (5 rings, 36 slices, 4000 points) for every vocation. */
export const MAX_POINTS = 4000;
export const MAX_LEVEL = 5000;
export const MAX_SKILL = 200;
export const MAX_SCROLLS = 1000;
export const MAX_MONSTERS = 10;
export const MIN_WEIGHT = 0.1;
export const MAX_WEIGHT = 99999;

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
  // D91: priority is one of five steps; older stored / linked values snap to the nearest.
  if (pr !== undefined) out.priority = snapPriority(clamp(pr, 0, 100));
  const sc = toInt(raw.scrolls);
  if (sc !== undefined) out.scrolls = clamp(sc, 0, MAX_SCROLLS);
  const lv = optionalInt(raw, 'level', 1, MAX_LEVEL);
  if (lv !== undefined) out.level = lv;
  for (const k of ['mainSkill', 'shielding', 'magicLevel'] as const) {
    const v = optionalInt(raw, k, 0, MAX_SKILL);
    if (v !== undefined) out[k] = v;
  }
  if (raw.meleeSkill === null || MELEE_SKILLS.includes(raw.meleeSkill as MeleeSkill)) out.meleeSkill = (raw.meleeSkill as MeleeSkill | null) ?? null;
  const monsters = sanitizeMonsters(raw.monsters);
  if (monsters) out.monsters = monsters;
  // Legacy (iteration 2) single monster.
  else if (typeof raw.monsterId === 'string' && MONSTER_ID.test(raw.monsterId.trim()))
    out.monsters = [{ id: raw.monsterId.trim(), weight: 1 }];
  if (FIGHT_MODES.includes(raw.mode as FightMode)) out.mode = raw.mode as FightMode;
  // D90: a variant no longer offered (old wheel after the update) falls back to the default.
  if (wheelVariants().includes(raw.wheel as WheelVariant)) out.wheel = raw.wheel as WheelVariant;
  else if (raw.wheel !== undefined) out.wheel = 'current';
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
  meleeSkill: 'ms',
  monsters: 'm',
  priority: 'prio',
  mode: 'f',
  wheel: 'w',
} as const;

/** Removed keys (hunt style, D20): ignored on read, dropped on write. */
const LEGACY_KEYS = ['h'] as const;

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
    meleeSkill: opt('meleeSkill'),
    priority: get('priority'),
    monsters: m === undefined ? undefined : decodeMonsters(m),
    mode: get('mode'),
    wheel: get('wheel') ?? (empty === null ? 'current' : undefined),
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
  opt('meleeSkill', state.vocation === 'knight' ? state.meleeSkill : null);
  q.set(KEYS.priority, String(state.priority));
  q.set(KEYS.mode, state.mode);
  opt('wheel', state.wheel === 'current' ? null : state.wheel);
  for (const k of LEGACY_KEYS) q.delete(k);
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
