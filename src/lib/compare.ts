/** D89: the player's own wheel from a planner code or link. Pure. */
import type { Vocation, WheelVariant } from '../types';
import { decodePlannerCode, sliceIdForGrid } from '../data/wheel/plannerCode';

export interface OwnWheel {
  vocation: Vocation;
  variant: WheelVariant;
  /** Points per slice id. */
  points: Record<string, number>;
}

export const MAX_COMPARE_CODE = 300;

/** Planner code, or the `code` parameter of a planner link. */
export function codeFromText(text: string): string {
  const s = text.trim();
  const m = /[?&]code=([^&#\s]+)/.exec(s);
  return m ? decodeURIComponent(m[1]) : s;
}

/** Own wheel from a code / link; null when it is not a planner code. */
export function parseOwnWheel(text: string): OwnWheel | null {
  const code = codeFromText(text);
  if (!code) return null;
  try {
    const d = decodePlannerCode(code);
    const points: Record<string, number> = {};
    for (const [grid, pts] of Object.entries(d.points)) if (pts > 0) points[sliceIdForGrid(Number(grid), d.vocation)] = pts;
    return { vocation: d.vocation, variant: d.variant ?? 'current', points };
  } catch {
    return null;
  }
}

export const compareStorageKey = (vocation: Vocation) => `wheel-optimizer:compare:v1:${vocation}`;

export function parseCompareCode(json: string | null): string {
  try {
    const v: unknown = json === null ? '' : JSON.parse(json);
    return typeof v === 'string' ? v.slice(0, MAX_COMPARE_CODE) : '';
  } catch {
    return '';
  }
}
