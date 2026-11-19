import { describe, expect, it } from 'vitest';
import type { Monster } from '../types';
import { combinedDamageTypes, combinedModifiers, resolveMonsters } from './monsters';
import { PLANNER_URL, plannerUrl } from './planner';

const mon = (id: string, mods: Monster['elementModifiers'], damageTypes: Monster['damageTypes'] = []): Monster => ({
  id,
  name: id,
  elementModifiers: mods,
  damageTypes,
});

const a = mon('a', { fire: 0, ice: 120 }, ['fire', 'physical']);
const b = mon('b', { fire: 100, ice: 80, holy: 50 }, ['death', 'physical']);

describe('hunting spot helpers', () => {
  it('weights the element modifiers (missing = 100)', () => {
    const avg = combinedModifiers([
      { monster: a, weight: 3 },
      { monster: b, weight: 1 },
    ]);
    expect(avg.fire).toBe(25);
    expect(avg.ice).toBe(110);
    expect(avg.holy).toBe(88);
    expect(avg.earth).toBe(100);
  });

  it('is neutral for an empty or zero-weight list', () => {
    expect(combinedModifiers([]).fire).toBe(100);
    expect(combinedModifiers([{ monster: a, weight: 0 }]).fire).toBe(100);
  });

  it('merges damage types by weight', () => {
    expect(
      combinedDamageTypes([
        { monster: a, weight: 1 },
        { monster: b, weight: 2 },
      ]),
    ).toEqual(['physical', 'death', 'fire']);
  });

  it('resolves entries, skipping unknown ids', () => {
    const lookup = (id: string) => (id === 'a' ? a : undefined);
    expect(resolveMonsters([{ id: 'a', weight: 2 }, { id: 'x', weight: 1 }], lookup)).toEqual([{ monster: a, weight: 2 }]);
  });
});

describe('planner link', () => {
  it('appends the encoded code', () => {
    expect(plannerUrl(' AB+c/= ')).toBe(`${PLANNER_URL}&code=AB%2Bc%2F%3D`);
    expect(PLANNER_URL).toBe('https://www.test.tibia.com/community/?subtopic=wheelofdestinyplanner');
  });
});
