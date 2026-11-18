import { describe, expect, it } from 'vitest';
import type { OwnedGem } from '../types';
import { optimize } from './index';

const HUNT = { mode: 'hunt' } as const;
const gemOf = (id: string, r: { quality: OwnedGem['quality']; mods: { kind: string; modId: number; grade: number }[] }): OwnedGem => {
  const basics = r.mods.filter((m) => m.kind === 'basic');
  const sup = r.mods.find((m) => m.kind === 'supreme');
  const ref = (m?: { modId: number; grade: number }) => (m ? { modId: m.modId, grade: m.grade as 1 } : null);
  return { id, quality: r.quality, basic1: ref(basics[0]), basic2: ref(basics[1]), supreme: ref(sup) };
};

describe('gem steps: new gems at grade I, upgrades after vessels are full', () => {
  it('upgrades only once every unlocked vessel holds a gem', () => {
    const base = optimize({ vocation: 'sorcerer', points: 4000, monster: null, priority: 50, context: HUNT, alternatives: 0 });
    const greater = base.gemRecommendations.find((g) => g.quality === 'greater')!;
    const one = optimize({ vocation: 'sorcerer', points: 4000, monster: null, priority: 50, context: HUNT, alternatives: 0, gems: [gemOf('g0', greater)] });
    expect(one.vessels.some((v) => v.unlocked && !v.gem)).toBe(true);
    expect(one.upgradeRecommendations).toEqual([]);
    const all = Array.from({ length: 8 }, (_, i) => gemOf(`g${i}`, greater));
    const full = optimize({ vocation: 'sorcerer', points: 4000, monster: null, priority: 50, context: HUNT, alternatives: 0, gems: all });
    expect(full.vessels.every((v) => !v.unlocked || v.gem)).toBe(true);
    expect(full.upgradeRecommendations.length).toBeGreaterThan(0);
    expect(full.upgradeRecommendations.every((u) => u.toGrade === u.fromGrade + 1)).toBe(true);
  });

  it('Revelation Mastery gems are valued by re-optimizing the wheel', () => {
    const input = { vocation: 'knight' as const, points: 950, monster: null, priority: 0, character: { level: 1000 }, alternatives: 0 };
    const r = optimize(input);
    const rm = r.gemRecommendations.find((g) => g.mods.some((m) => m.name === "Revelation Mastery Executioner's Throw"))!;
    expect(rm.reasonMsg?.key).toBe('gem.rmReopt');
    expect(r.revelations.find((x) => x.perk.name === "Executioner's Throw")!.stage).toBe(2);
    const owned = optimize({ ...input, gems: [gemOf('rm', rm)] });
    expect(owned.revelations.find((x) => x.perk.name === "Executioner's Throw")!.stage).toBe(3);
    expect(r.gemRecommendations.some((g) => g.mods.some((m) => /Revelation Mastery Avatar/.test(m.name)))).toBe(false);
  });
});
