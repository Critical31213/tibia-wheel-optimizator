import { describe, expect, it } from 'vitest';
import monsters from '../data/monsters.json';
import type { Monster, OptimizerInput } from '../types';
import { incomingShares } from './values';
import { wearBest } from './optimizer';

const get = (id: string) => (monsters as Monster[]).find((m) => m.id === id)!;

describe('D140 monster damage from TibiaWiki', () => {
  it('Cobra Vizier deals death too, weighted by its attacks', () => {
    const m = get('cobra-vizier');
    expect(m.damageTypes).toEqual(['physical', 'earth', 'death']);
    const s = incomingShares([{ monster: m, weight: 1 }]);
    expect(s.death!).toBeGreaterThan(s.earth!);
    expect(Object.values(s).reduce((a, x) => a + x!, 0)).toBeCloseTo(1, 6);
  });

  it('equal split without shares', () => {
    const m: Monster = { id: 'x', name: 'x', elementModifiers: {}, damageTypes: ['fire', 'ice'] };
    expect(incomingShares([{ monster: m, weight: 1 }])).toEqual({ fire: 0.5, ice: 0.5 });
  });

  it('Moon Mirror beats Scarab Ocarina on Cobra Vizier', () => {
    const input = {
      vocation: 'paladin', points: 600, priority: 50, monster: null, monsters: [{ monster: get('cobra-vizier'), weight: 1 }], character: { level: 600 },
      gear: { pieces: { trinket: [{ itemId: 'scarab-ocarina' }, { itemId: 'moon-mirror' }, { itemId: 'bone-fiddle' }] }, weapon: null },
    } as unknown as OptimizerInput;
    expect(wearBest(input)!.gear.wornIds).toEqual({ trinket: 'moon-mirror' });
  });
});
