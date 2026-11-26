import { describe, expect, it } from 'vitest';
import { optimize } from '.';
import type { OptimizerInput, OwnedGem } from '../types';

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
