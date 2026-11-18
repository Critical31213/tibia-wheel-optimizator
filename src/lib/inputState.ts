/** Serialisation of the user's inputs (URL query string + localStorage). Pure. */
import { VOCATIONS } from '../types';
import type { Vocation } from '../types';
import { clamp } from './labels';

export interface InputState {
  vocation: Vocation;
  points: number;
  monsterId: string | null;
  priority: number;
}

export const DEFAULT_INPUTS: InputState = {
  vocation: 'knight',
  points: 0,
  monsterId: null,
  priority: 50,
};

/** Upper bound for typed point values before the wheel capacity is known. */
export const MAX_POINTS = 100_000;

const isVocation = (v: unknown): v is Vocation =>
  typeof v === 'string' && (VOCATIONS as readonly string[]).includes(v);

function toInt(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/** Validate an untrusted partial state, dropping invalid fields. */
export function sanitize(raw: Record<string, unknown>): Partial<InputState> {
  const out: Partial<InputState> = {};
  if (isVocation(raw.vocation)) out.vocation = raw.vocation;
  const p = toInt(raw.points);
  if (p !== undefined) out.points = clamp(p, 0, MAX_POINTS);
  const pr = toInt(raw.priority);
  if (pr !== undefined) out.priority = clamp(pr, 0, 100);
  if (typeof raw.monsterId === 'string' && raw.monsterId.trim()) out.monsterId = raw.monsterId.trim();
  else if (raw.monsterId === null) out.monsterId = null;
  return out;
}

/** Query param names: short so shared links stay tidy. */
const KEYS = { vocation: 'v', points: 'p', monsterId: 'm', priority: 'prio' } as const;

export function fromQuery(search: string): Partial<InputState> {
  const q = new URLSearchParams(search);
  return sanitize({
    vocation: q.get(KEYS.vocation) ?? undefined,
    points: q.get(KEYS.points) ?? undefined,
    priority: q.get(KEYS.priority) ?? undefined,
    monsterId: q.get(KEYS.monsterId) ?? undefined,
  });
}

/** Writes the state into `search`, preserving unrelated params (e.g. `?demo`). */
export function toQuery(state: InputState, search = ''): string {
  const q = new URLSearchParams(search);
  q.set(KEYS.vocation, state.vocation);
  q.set(KEYS.points, String(state.points));
  q.set(KEYS.priority, String(state.priority));
  if (state.monsterId) q.set(KEYS.monsterId, state.monsterId);
  else q.delete(KEYS.monsterId);
  return `?${q.toString()}`;
}
