import { describe, expect, it } from 'vitest';
import { consumableBonus, consumablesFor } from './consumables';
import { EMPTY_GEAR, sanitizeGear, setConsumable, toggleFood } from '../lib/gear';
import { optimize } from '../engine';
import type { OptimizerInput } from '../types';

describe('D136 food and potions', () => {
  it('bonus per vocation; a stronger food beats a potion of the same skill', () => {
    expect(consumableBonus(['bullseye-potion'], 'paladin')).toEqual({ main: 5, magic: 0, shielding: -10 });
    expect(consumableBonus(['carrot-cake', 'bullseye-potion'], 'paladin')).toEqual({ main: 10, magic: 0, shielding: 0 });
    expect(consumableBonus(['roasted-dragon-wings', 'bullseye-potion'], 'paladin')).toEqual({ main: 5, magic: 0, shielding: 0 });
    expect(consumableBonus(['delicatessen-salad', 'transcendence-potion'], 'monk')).toEqual({ main: 4, magic: 0, shielding: 0 });
    expect(consumableBonus(['veggie-casserole', 'berserk-potion'], 'knight', 'club')).toEqual({ main: 10, magic: 0, shielding: 0 });
    expect(consumableBonus(['tropical-fried-terrorbird', 'mastermind-potion'], 'druid')).toEqual({ main: 0, magic: 5, shielding: 0 });
    expect(consumableBonus(['berserk-potion'], 'paladin')).toEqual({ main: 0, magic: 0, shielding: 0 });
  });

  it('D141: foods of different skills stack, the same skill does not', () => {
    let g = toggleFood(EMPTY_GEAR, 'carrot-cake');
    g = toggleFood(g, 'tropical-fried-terrorbird');
    g = toggleFood(g, 'roasted-dragon-wings');
    expect(g.consumables).toEqual(['carrot-cake', 'tropical-fried-terrorbird', 'roasted-dragon-wings']);
    expect(consumableBonus(g.consumables, 'paladin')).toEqual({ main: 10, magic: 5, shielding: 10 });
    g = toggleFood(g, 'carrot-pie');
    expect(g.consumables).toEqual(['tropical-fried-terrorbird', 'roasted-dragon-wings', 'carrot-pie']);
    expect(toggleFood(g, 'carrot-pie').consumables).toEqual(['tropical-fried-terrorbird', 'roasted-dragon-wings']);
    expect(consumableBonus(['carrot-cake', 'carrot-pie'], 'paladin').main).toBe(10);
    expect(consumableBonus(['carrot-pie', 'tropical-fried-terrorbird', 'bullseye-potion'], 'paladin')).toEqual({ main: 7, magic: 5, shielding: 0 });
    expect(consumableBonus(['tropical-fried-terrorbird', 'bullseye-potion'], 'paladin')).toEqual({ main: 5, magic: 5, shielding: -10 });
    expect(sanitizeGear({ consumables: ['carrot-cake', 'lemon-cupcake', 'tropical-marinated-tiger', 'bullseye-potion'] }, 'paladin').consumables).toEqual(['carrot-cake', 'tropical-marinated-tiger', 'bullseye-potion']);
    expect(setConsumable(g, 'food', null).consumables).toBeUndefined();
  });

  it('lists only what the vocation can use', () => {
    const ids = consumablesFor('sorcerer').map((c) => c.id);
    expect(ids).toContain('mastermind-potion');
    expect(ids).not.toContain('bullseye-potion');
    expect(ids).not.toContain('carrot-cake');
  });

  it('one food and one potion are stored', () => {
    let g = setConsumable(EMPTY_GEAR, 'food', 'carrot-cake');
    g = setConsumable(g, 'food', 'carrot-pie');
    g = setConsumable(g, 'potion', 'bullseye-potion');
    expect(g.consumables).toEqual(['carrot-pie', 'bullseye-potion']);
    expect(sanitizeGear({ consumables: ['carrot-cake', 'lemon-cupcake', 'berserk-potion', 'x'] }, 'paladin').consumables).toEqual(['carrot-cake']);
    expect(setConsumable(setConsumable(EMPTY_GEAR, 'food', 'carrot-cake'), 'food', null)).toEqual(EMPTY_GEAR);
  });

  it('a skill potion raises the rotation damage', () => {
    const input = { vocation: 'paladin', points: 600, priority: 50, monster: null, monsters: [], context: { mode: 'hunt' }, alternatives: 0, character: { level: 600, mainSkill: 120 } } as unknown as OptimizerInput;
    const total = (i: OptimizerInput) => optimize(i).rotation!.window!.total;
    expect(total({ ...input, consumables: ['bullseye-potion'] })).toBeGreaterThan(total(input));
  });
});
