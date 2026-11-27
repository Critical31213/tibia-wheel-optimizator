import { describe, expect, it } from 'vitest';
import { optimize } from '.';
import type { OptimizerInput } from '../types';
import { gearEffects } from './gear';
import { autoBase, NO_STAGES } from './spells';

describe('D131 Ascetic and mantra', () => {
  it('sums the mantra of the worn items', () => {
    const g = gearEffects({ pieces: { armor: { itemId: 'soulgarb' }, helmet: { itemId: 'ethereal-coned-hat' }, boots: { itemId: 'soulsoles' } }, weapon: null }, 'monk', null);
    expect(g.mantra).toBe(29);
  });

  it('adds stage × mantra to each auto-attack hit, crit included', () => {
    const m = { base: 100, autoCrit: { chance: 10, extra: 10, share: 1 }, passives: new Map([['Ascetic', 2]]), mantraShare: 0.1 };
    expect(autoBase(m, { stages: [0, 0, 2, 0] })).toBeCloseTo(120, 9);
    expect(autoBase(m, { stages: NO_STAGES })).toBeCloseTo(100, 9);
    expect(autoBase(m, { stages: [0, 0, 2, 0], critExtra: 20 })).toBeCloseTo(1.2 * autoBase(m, { stages: NO_STAGES, critExtra: 20 }), 9);
  });

  it('a monk with mantra gear gets more auto-attack damage at the same build', () => {
    const base: OptimizerInput = {
      vocation: 'monk',
      points: 750,
      monsters: [],
      priority: 0,
      context: { mode: 'hunt' },
      character: { level: 800, mainSkill: 112 },
      alternatives: 0,
      forcedRevelations: [{ name: 'Ascetic', stage: 2 }],
    } as unknown as OptimizerInput;
    const gear = { pieces: { armor: [{ itemId: 'soulgarb' }], helmet: [{ itemId: 'ethereal-coned-hat' }] }, weapon: null };
    const plain = optimize(base).rotation!.window!.autoAttack;
    const withMantra = optimize({ ...base, gear } as unknown as OptimizerInput).rotation!.window!.autoAttack;
    expect(withMantra).toBeGreaterThan(plain * 1.1);
  });
});

describe('D131 revelation spells checked with the exact rotation', () => {
  it('keeps a build whose rotation table beats the one with the revelation spell', () => {
    const input = {
      vocation: 'knight',
      points: 743,
      monsters: [],
      priority: 0,
      context: { mode: 'hunt' },
      character: { level: 793, mainSkill: 120, shielding: 120 },
      meleeSkill: 'sword',
      alternatives: 0,
      gems: [
        { id: 'a', quality: 'lesser', basic1: { modId: 31, grade: 1 }, basic2: null, supreme: null },
        { id: 'b', quality: 'lesser', basic1: { modId: 38, grade: 1 }, basic2: null, supreme: null },
        { id: 'c', quality: 'lesser', basic1: { modId: 38, grade: 1 }, basic2: null, supreme: null },
        { id: 'd', quality: 'greater', basic1: { modId: 3, grade: 1 }, basic2: { modId: 15, grade: 1 }, supreme: { modId: 10, grade: 1 } },
        { id: 'e', quality: 'greater', basic1: { modId: 3, grade: 1 }, basic2: { modId: 15, grade: 1 }, supreme: { modId: 20, grade: 1 } },
        { id: 'f', quality: 'regular', basic1: { modId: 39, grade: 1 }, basic2: { modId: 2, grade: 1 }, supreme: null },
      ],
    } as unknown as OptimizerInput;
    const auto = optimize(input).rotation!.window!.total;
    const without = optimize({ ...input, excludedSpells: ["Executioner's Throw"] }).rotation!.window!.total;
    expect(auto).toBeGreaterThanOrEqual(without);
  });
});
