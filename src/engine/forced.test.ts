import { describe, expect, it } from 'vitest';
import { optimize, revelationOptions } from '.';
import { getWheel } from '.';
import { VOCATIONS } from '../types';

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

  it('D38: an RM gem only helps once its greater vessel is unlocked (275 points: no stage II from a gem; D73: RM in ring 2 makes it possible at 300)', () => {
    expect(revelationOptions({ vocation: 'paladin', points: 275, gems: [] })[0].stages[1].status).toBe('impossible');
  });

  it.each(VOCATIONS)('D38: %s: every revelation at stage III, at the fewest points reach calls ok (with and without an RM gem IV), is met', (vocation) => {
    const mods = getWheel(vocation).mods.filter((m) => m.kind === 'supreme' && m.name.startsWith('Revelation Mastery '));
    for (const rev of getWheel(vocation).revelations) {
      const mod = mods.find((m) => m.name === `Revelation Mastery ${rev.name}`);
      for (const gems of [[], mod ? [{ id: 'g', quality: 'greater' as const, basic1: null, basic2: null, supreme: { modId: mod.id, grade: 4 as const } }] : []]) {
        const ok = (points: number) => revelationOptions({ vocation, points, gems }).find((x) => x.name === rev.name)!.stages[2].status === 'ok';
        let points = 500;
        while (!ok(points)) points += 25;
        const r = optimize({ ...BOSS, vocation, points, gems, forcedRevelations: [{ name: rev.name, stage: 3 }] });
        expect(r.revelations.find((x) => x.perk.name === rev.name)!.stage, `${rev.name} @${points} gems=${gems.length}`).toBe(3);
      }
    }
  });

  it('duplicate supreme mod names carry their effect', () => {
    const names = getWheel('paladin').mods.filter((m) => m.kind === 'supreme' && m.name.startsWith('Augmented Strong Ethereal Spear')).map((m) => m.name);
    expect(names).toEqual(expect.arrayContaining(['Augmented Strong Ethereal Spear (Base Damage)', 'Augmented Strong Ethereal Spear (Critical Damage)']));
  });
});
