import { describe, expect, it } from 'vitest';
import type { OptimizerInput } from '../types';
import { encodePlannerCode, gridForSliceId, PLANNER_URL } from '../data/wheel/plannerCode';
import { codeFromText, parseOwnWheel } from '../lib/compare';
import { optimize } from './index';

/** D89: comparison with the player's own wheel. */
const base: OptimizerInput = { vocation: 'sorcerer', points: 600, monster: null, priority: 50, context: { mode: 'hunt' }, gems: [], alternatives: 0 };

describe('D89: compare with your wheel', () => {
  const best = optimize(base);

  it('the optimal wheel itself is equal', () => {
    const c = optimize({ ...base, compareWith: best.allocation }).comparison!;
    expect(c).toMatchObject({ verdict: 'equal', relative: 100, items: [], invalid: [], pointsUsed: best.pointsUsed });
  });

  it('a weaker wheel is explained by what it lacks', () => {
    const own = { ...best.allocation };
    const big = Object.keys(own).sort((a, b) => own[b] - own[a])[0];
    delete own[big];
    const c = optimize({ ...base, compareWith: own }).comparison!;
    expect(['close', 'worse']).toContain(c.verdict);
    expect(c.relative).toBeLessThan(100);
    expect(c.score).toBeGreaterThan(0);
    expect(c.items.some((x) => x.id === big && x.best > x.own)).toBe(true);
    expect(c.reasonMsgs.map((m) => m.key)).toEqual(expect.arrayContaining(['compare.points', 'compare.gains', 'compare.same']));
  });

  it('points on slices that are not unlocked or over capacity are ignored', () => {
    const c = optimize({ ...base, compareWith: { QTL0: 50, QTL8: 999 } }).comparison!;
    expect(c.invalid).toContain('QTL8');
    expect(c.allocation.QTL8).toBeUndefined();
  });

  it('reads a planner code or link', () => {
    const points: Record<number, number> = {};
    for (const [id, pts] of Object.entries(best.allocation)) points[gridForSliceId(id)] = pts;
    const code = encodePlannerCode({ vocation: 'sorcerer', points, vessels: [] });
    expect(codeFromText(`${PLANNER_URL}&code=${encodeURIComponent(code)}`)).toBe(code);
    expect(parseOwnWheel(code)).toEqual({ vocation: 'sorcerer', variant: 'current', points: best.allocation });
    expect(parseOwnWheel('K0Y2AgDP4jAQA')).toMatchObject({ vocation: 'knight', variant: 'live' });
    expect(parseOwnWheel('hello')).toBeNull();
    expect(parseOwnWheel('')).toBeNull();
  });
});
