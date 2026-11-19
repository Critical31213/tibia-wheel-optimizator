import { describe, expect, it } from 'vitest';
import { optimize, revelationOptions } from '.';
import { getWheel } from '.';

const BOSS = { vocation: 'paladin' as const, points: 800, monster: null, priority: 0, context: { mode: 'boss' as const }, alternatives: 0 };
const caldera = (r: ReturnType<typeof optimize>) => r.convictions.filter((c) => c.name.startsWith('Augmented Divine Caldera')).length;

describe('D35: forced augment stage and revelation stage', () => {
  it('stage II fills both augment slices; stage I at least one', () => {
    expect(caldera(optimize({ ...BOSS, forcedSpells: ['Divine Caldera'] }))).toBeGreaterThanOrEqual(1);
    expect(caldera(optimize({ ...BOSS, forcedSpells: ['Divine Caldera'], forcedStage2: ['Divine Caldera'] }))).toBe(2);
  });

  it('a reachable forced revelation stage is met; an unreachable one is reported', () => {
    const r = optimize({ ...BOSS, forcedRevelations: [{ name: 'Divine Grenade', stage: 2 }] });
    expect(r.revelations.find((x) => x.perk.name === 'Divine Grenade')!.stage).toBeGreaterThanOrEqual(2);
    const far = optimize({ ...BOSS, forcedRevelations: [{ name: 'Divine Grenade', stage: 3 }] });
    expect(far.rationaleMsgs?.some((m) => m.key === 'rationale.revelationBlocked')).toBe(true);
  });

  it('reach: stage III needs an RM gem at 800 points, is open at 900, out of reach at 600', () => {
    const at = (points: number) => revelationOptions({ vocation: 'paladin', points, gems: [] })[0].stages[2].status;
    expect(at(600)).toBe('impossible');
    expect(at(800)).toBe('gem');
    expect(at(900)).toBe('ok');
  });

  it('duplicate supreme mod names carry their effect', () => {
    const names = getWheel('paladin').mods.filter((m) => m.kind === 'supreme' && m.name.startsWith('Augmented Strong Ethereal Spear')).map((m) => m.name);
    expect(names).toEqual(expect.arrayContaining(['Augmented Strong Ethereal Spear (Base Damage)', 'Augmented Strong Ethereal Spear (Critical Damage)']));
  });
});
