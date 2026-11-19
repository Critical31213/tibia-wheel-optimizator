import { describe, expect, it } from 'vitest';
import type { OwnedGem } from '../types';
import { optimize } from './index';

const HUNT = { mode: 'hunt' } as const;
/** One recommended gem per vessel, each of the vessel's quality (D28). */
const fullSet = (r: ReturnType<typeof optimize>): OwnedGem[] =>
  r.vessels.map((v, i) => gemOf(`v${i}`, r.gemRecommendations.find((g) => g.quality === v.quality)!));
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
    const all = fullSet(base);
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

describe('D27: shared mod grades, cooldown gems in a full rotation', () => {
  const sorc = { vocation: 'sorcerer' as const, points: 4000, monster: null, priority: 50, context: HUNT, alternatives: 0 };
  const greaterRec = () => optimize(sorc).gemRecommendations.find((g) => g.quality === 'greater')!;

  it('a mod has the highest owned grade in every gem; upgrades are per mod', () => {
    const rec = greaterRec();
    const b = gemOf('b', { ...rec, mods: rec.mods.map((m) => ({ ...m, grade: m.kind === 'basic' ? 3 : 1 })) });
    const r = optimize({ ...sorc, gems: [b, ...fullSet(optimize(sorc))] });
    const hp = rec.mods.find((m) => m.kind === 'basic')!;
    for (const v of r.vessels) if (v.gem?.basic1?.modId === hp.modId) expect(v.gem.basic1.grade).toBe(3);
    const up = r.upgradeRecommendations.filter((u) => u.kind === 'basic' && u.modId === hp.modId);
    expect(up).toHaveLength(1);
    expect(up[0].fromGrade).toBe(3);
    expect(up[0].gems).toBeGreaterThan(1);
    // A recommended gem carries the character's grade.
    // D30: greater vessels are full, so a greater recommendation only replaces the weakest gem.
    const again = r.gemRecommendations.find((g) => g.quality === 'greater');
    if (again) expect(again.replaces).toBe(true);
    const hpRec = again?.mods.find((m) => m.kind === 'basic' && m.modId === hp.modId);
    if (hpRec) expect(hpRec.grade).toBe(3);
  });

  it('a cooldown gem adds nothing when the preset rotation is already full', () => {
    const r = optimize({ vocation: 'sorcerer', points: 950, monster: null, priority: 0, character: { level: 1000 }, alternatives: 0 });
    expect(r.rotation?.presetId).toBe('ms-echo-gdb');
    expect(r.gemRecommendations.some((g) => g.mods.some((m) => m.kind === 'supreme' && m.name.startsWith('Augmented Energy Wave') && /cooldown/i.test(g.reason)))).toBe(false);
  });
});

describe('D30: recommendations need a free vessel', () => {
  it('with every vessel of a quality holding the recommended gem, the same gem is not recommended again', () => {
    const sorc = { vocation: 'sorcerer' as const, points: 4000, monster: null, priority: 50, context: HUNT, alternatives: 0 };
    const r = optimize({ ...sorc, gems: fullSet(optimize(sorc)) });
    expect(r.vessels.every((v) => !v.unlocked || v.gem)).toBe(true);
    for (const g of r.gemRecommendations) {
      expect(g.replaces).toBe(true);
      expect(g.gain).toBeGreaterThan(0);
    }
    const free = optimize(sorc);
    expect(free.gemRecommendations.some((g) => g.replaces)).toBe(false);
  });
});

describe('D34: augment pairs valued mostly at stage II', () => {
  it('boss paladin takes both Strong Ethereal Spear augments at a low budget', () => {
    const r = optimize({ vocation: 'paladin', points: 600, monster: null, priority: 0, context: { mode: 'boss' }, character: { level: 800 }, alternatives: 0 });
    expect(r.convictions.filter((c) => c.name.startsWith('Augmented Strong Ethereal Spear'))).toHaveLength(2);
    expect(r.rotation?.spells[0].name).toBe('Strong Ethereal Spear');
  });
});
