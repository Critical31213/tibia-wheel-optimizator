import { describe, expect, it } from 'vitest';
import { optimize } from '.';
import type { OptimizerInput } from '../types';
import { weightsFor } from './optimizer';
import { divineEmpowermentOff } from './values';

describe('D135 priority 0 = pure damage', () => {
  it('defense and utility only break ties', () => {
    expect(weightsFor(0)).toEqual({ off: 1, def: 1e-3, util: 1e-3 });
    expect(weightsFor(25).def).toBe(0.25);
  });

  it.each([
    ['knight', 900],
    ['druid', 600],
    ['sorcerer', 900],
    ['monk', 1200],
  ] as const)('%s %i: at least the damage of a build with some defense weight', (vocation, points) => {
    const input = { vocation, points, monster: null, monsters: [], context: { mode: 'hunt' }, alternatives: 0 } as unknown as OptimizerInput;
    const dmg = (priority: number) => {
      const e = optimize({ ...input, priority }).wheelEffect!;
      return e.dmg + (e.other ?? 0);
    };
    expect(dmg(0)).toBeGreaterThanOrEqual(dmg(25) - 1e-9);
  });
});

describe('D135 Divine Empowerment uptime', () => {
  it('3 turns of 2 s per cast, cast at 80 % of the cooldown rate', () => {
    expect(divineEmpowermentOff(1)).toBeCloseTo(8 * (6 / 40), 9);
    expect(divineEmpowermentOff(3)).toBeCloseTo(2.4, 9);
    expect(divineEmpowermentOff(3, 6)).toBeCloseTo(12 * (6 / 22.5), 9);
    expect(divineEmpowermentOff(3, 100)).toBeCloseTo(12 * (6 / (5 / 0.8)), 9);
    expect(divineEmpowermentOff(0)).toBe(0);
  });
});
