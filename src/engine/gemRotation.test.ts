import { describe, expect, it } from 'vitest';
import { optimize } from '.';
import type { OptimizerInput, OwnedGem } from '../types';
import { autoBase, critEV, NO_STAGES, withAutoCrit } from './spells';

const base: OptimizerInput = { vocation: 'paladin', points: 1000, monster: null, priority: 0, context: { mode: 'hunt' }, alternatives: 0, rotationId: 'rp-caldera-ethereal' };
const gem = (supreme: number | null): OwnedGem[] => [{ id: 'g', quality: 'greater' as const, basic1: { modId: 30, grade: 1 as const }, basic2: { modId: 12, grade: 1 as const }, supreme: supreme ? { modId: supreme, grade: 1 as const } : null }];

describe('D125: gem supreme spell mods in the rotation damage table', () => {
  it('a placed Divine Caldera base-damage gem raises the Caldera row', () => {
    const plain = optimize({ ...base, gems: gem(null) });
    const r = optimize({ ...base, gems: gem(28) });
    expect(r.vessels.some((v) => v.gem?.supreme?.modId === 28)).toBe(true);
    const caldera = (x: typeof r) => x.rotation!.spells.find((s) => s.name === 'Divine Caldera')!.damage!.perCast;
    expect(caldera(r)).toBeGreaterThan(caldera(plain));
  });
});

describe('D127: gem Critical Extra Damage also on auto attacks', () => {
  it('raises the auto-attack row', () => {
    // A small crit gem alone does not pay for a greater vessel: force the vessels.
    const plain = optimize({ ...base, minVessels: 3, gems: gem(null) });
    const r = optimize({ ...base, minVessels: 3, gems: gem(1) });
    expect(r.vessels.some((v) => v.gem?.supreme?.modId === 1)).toBe(true);
    expect(r.rotation!.window!.autoAttack).toBeGreaterThan(plain.rotation!.window!.autoAttack);
  });

  it('autoBase scales only the critting share; withAutoCrit keeps it consistent', () => {
    const m = { base: 100, autoCrit: { chance: 10, extra: 10, share: 0.5 }, passives: new Map<string, number>() };
    const k = critEV(10, 30) / critEV(10, 10);
    expect(autoBase(m, { stages: NO_STAGES, critExtra: 20 })).toBeCloseTo(100 * (0.5 + 0.5 * k), 9);
    const moved = withAutoCrit(m, 10, 30);
    expect(moved.base).toBeCloseTo(autoBase(m, { stages: NO_STAGES, critExtra: 20 }), 9);
    expect(withAutoCrit(moved, 10, 10).base).toBeCloseTo(100, 9);
  });
});

describe('D130: the build damage % is the rotation table gain', () => {
  it.each([
    ['knight', 'hunt'],
    ['paladin', 'hunt'],
    ['sorcerer', 'boss'],
  ] as const)('%s %s: dmg = window vs the empty wheel', (vocation, mode) => {
    // The level is set: by default it follows the points.
    const inp: OptimizerInput = { vocation, points: 1000, monster: null, priority: 30, context: { mode }, alternatives: 0, character: { level: 1000 } };
    const r = optimize(inp);
    // Same rotation and stances on the empty wheel.
    const empty = optimize({ ...inp, points: 0, rotationId: r.rotation!.presetId, stances: r.stances });
    const gain = 100 * (r.rotation!.window!.total / empty.rotation!.window!.total - 1);
    expect(Math.abs(r.wheelEffect!.dmg - gain)).toBeLessThan(0.05);
  });
});
