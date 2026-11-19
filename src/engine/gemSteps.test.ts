import { describe, expect, it } from 'vitest';
import type { OwnedGem } from '../types';
import { getWheelData } from '../data/wheel';
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

describe('D43: recommended gems have room and are used', () => {
  it.each([
    ['knight', 1000, 'boss'],
    ['sorcerer', 1500, 'boss'],
    ['paladin', 2500, 'hunt'],
    ['druid', 2500, 'boss'],
  ] as const)('%s %i %s: every recommendation, once owned, sits in a vessel (4 steps)', (vocation, points, mode) => {
    const base = { vocation, points, monster: null, priority: 50, context: { mode }, alternatives: 0 } as const;
    let gems: OwnedGem[] = [];
    for (let step = 0; step < 4; step++) {
      const r = optimize({ ...base, gems });
      if (!r.gemRecommendations.length) break;
      for (const [k, rec] of r.gemRecommendations.entries()) {
        const gem = gemOf(`s${step}r${k}`, rec);
        const after = optimize({ ...base, gems: [...gems, gem] });
        expect(after.vessels.some((v) => v.gem?.id === gem.id), `step ${step}: ${rec.mods.map((m) => m.name).join(' + ')}`).toBe(true);
      }
      gems = [...gems, gemOf(`s${step}`, r.gemRecommendations[0])];
    }
  });
});

describe('D71: gem mod swaps', () => {
  const sorc = { vocation: 'sorcerer' as const, points: 4000, monster: null, priority: 50, context: HUNT, alternatives: 0 };
  const drain = getWheelData('sorcerer').mods.basic.find((m) => m.slots.includes(2) && m.name === 'Mana Drain Resistance / Life Drain Resistance')!;

  it('proposes the best mod for a weak slot, at the character grade on the new mod', () => {
    const base = optimize(sorc);
    const set = fullSet(base);
    const i = set.findIndex((g) => g.quality === 'greater' && g.basic2);
    const best = set[i].basic2!;
    const weak = { ...set[i], id: 'weak', basic2: { modId: drain.id, grade: 2 as const } };
    const r = optimize({ ...sorc, gems: [...set.filter((_, j) => j !== i), weak] });
    const s = r.modSwaps.find((x) => x.gemId === 'weak' && x.slot === 'basic2')!;
    expect(s.from).toMatchObject({ modId: drain.id, grade: 2 });
    expect(s.to.modId).toBe(best.modId);
    expect(s.gain).toBeGreaterThan(0);
    expect(r.modSwaps.every((x) => x.gain > 0 && x.from.modId !== x.to.modId)).toBe(true);
    expect(s.to.grade).toBe(1);
    // An unplaced owned gem shows the best mod at grade III: the character has grade III on it.
    const spare: OwnedGem = { id: 'spare', quality: 'regular', basic1: null, basic2: { ...best, grade: 3 }, supreme: null };
    const graded = optimize({ ...sorc, gems: [...set.filter((_, j) => j !== i), weak, spare] });
    const s3 = graded.modSwaps.find((x) => x.gemId === 'weak' && x.slot === 'basic2')!;
    expect(s3.to).toMatchObject({ modId: best.modId, grade: 3 });
    expect(s3.gain).toBeGreaterThan(s.gain);
    // Never proposes the gem's other basic mod.
    for (const x of r.modSwaps) {
      const g = r.vessels.find((v) => v.gem?.id === x.gemId)!.gem!;
      const other = x.slot === 'basic1' ? g.basic2 : x.slot === 'basic2' ? g.basic1 : null;
      expect(x.to.modId).not.toBe(other?.modId);
    }
  });
});

describe('D72: idle mods, no supreme swaps', () => {
  it('flags an RM gem below the next stage and never proposes a supreme swap', () => {
    const rm: OwnedGem = { id: 'rm', quality: 'greater', basic1: { modId: 4, grade: 1 }, basic2: { modId: 16, grade: 1 }, supreme: { modId: 39, grade: 1 } };
    const r = optimize({ vocation: 'paladin', points: 1000, monster: null, priority: 50, context: HUNT, alternatives: 0, gems: [rm] });
    const v = r.vessels.find((x) => x.gem?.id === 'rm')!;
    const idle = v.idle?.find((x) => x.slot === 'supreme');
    expect(idle?.reasonMsg).toMatchObject({ key: 'gem.idleRm', params: { revelation: 'Avatar of Light', next: 250 } });
    expect(r.modSwaps.some((s) => s.slot === 'supreme')).toBe(false);
  });
});
