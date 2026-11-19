import { describe, expect, it } from 'vitest';
import { type Monster, type OptimizerResult, VOCATIONS } from '../types';
import { getRotationPresets } from '../data/damage/rotations';
import { optimize } from './index';
import { planSpecs, valuationFor } from './optimizer';
import { augmentParts } from './values';
import { getEngineWheel } from './wheel/build';
import { buildSpellModel, targetsAt } from './spells';

const HUNT = { mode: 'hunt' } as const;
const at = (level: number) => ({ points: Math.max(0, level - 50), character: { level } });
const gemNames = (r: OptimizerResult) => r.gemRecommendations.flatMap((g) => g.mods.map((m) => m.name));
const revStage = (r: OptimizerResult, name: string) => r.revelations.find((x) => x.perk.name === name)?.stage ?? 0;
const rotationNames = (r: OptimizerResult) => r.rotation?.spells.map((s) => s.name) ?? [];

describe('D18 defense = effective HP', () => {
  it('RP 600 hunt: lesser gem is Hit Points; never capacity or max mana', () => {
    const r = optimize({ vocation: 'paladin', ...at(600), monster: null, priority: 50, context: HUNT });
    expect(r.gemRecommendations.find((g) => g.quality === 'lesser')?.mods[0].name).toBe('Hit Points');
    for (const n of gemNames(r)) expect(n).not.toMatch(/\b(Capacity|Mana)\b(?! Drain)/);
  });

  it('Mitigation Multiplier never beats Hit Points (levels 200–1500, priority 50)', () => {
    for (const vocation of VOCATIONS) {
      for (const level of [200, 600, 1000, 1500]) {
        const r = optimize({ vocation, ...at(level), monster: null, priority: 50, context: HUNT });
        expect(r.gemRecommendations.find((g) => g.quality === 'lesser')?.mods[0].name, `${vocation} ${level}`).toBe('Hit Points');
        expect(r.rationaleMsgs!.map((m) => m.key)).not.toContain('rationale.mitigationOverHp');
      }
    }
  });

  it('healing supreme gems are never recommended for mages', () => {
    for (const vocation of ['druid', 'sorcerer'] as const) {
      const healing = new Set(
        getEngineWheel(vocation)
          .supremeMods.filter((m) => m.category === 'augHealing' || /Healing|Embrace/.test(m.name))
          .map((m) => m.id),
      );
      for (const priority of [0, 50, 100]) {
        for (const context of [HUNT, { mode: 'boss' } as const]) {
          const r = optimize({ vocation, ...at(1000), monster: null, priority, context });
          for (const g of r.gemRecommendations)
            for (const m of g.mods) if (m.kind === 'supreme') expect(healing.has(m.modId), m.name).toBe(false);
        }
      }
    }
  });
});

describe('D20 rotations', () => {
  it('a low-level sorcerer uses a non-beam rotation; beams only with Beam Mastery', () => {
    const requires = new Map(getRotationPresets('sorcerer').map((p) => [p.id, p.requires?.revelation]));
    const low = optimize({ vocation: 'sorcerer', ...at(250), monster: null, priority: 50, context: HUNT });
    expect(requires.get(low.rotation!.presetId)).toBeUndefined();
    let beam = 0;
    for (const level of [250, 400, 600, 900, 1200, 2000]) {
      for (const priority of [0, 20, 50]) {
        const r = optimize({ vocation: 'sorcerer', ...at(level), monster: null, priority, context: HUNT });
        const req = requires.get(r.rotation!.presetId);
        if (req) {
          beam++;
          expect(revStage(r, req), `${level}/${priority}`).toBeGreaterThan(0);
        }
      }
    }
    expect(beam).toBeGreaterThan(0);
  });

  it('a druid casts Wrath of Nature instead of Eternal Winter vs an ice-resistant, earth-weak spot', () => {
    const m: Monster = { id: 'x', name: 'X', elementModifiers: { ice: 50, earth: 130 }, damageTypes: ['physical'], maxDamage: 500 };
    const r = optimize({ vocation: 'druid', ...at(1000), monster: m, priority: 50, context: HUNT });
    expect(rotationNames(r)).toContain('Wrath of Nature');
    expect(rotationNames(r)).not.toContain('Eternal Winter');
  });

  it('Divine Grenade joins the rotation while its revelation is active', () => {
    let seen = 0;
    for (const priority of [0, 10, 20, 50]) {
      for (const level of [600, 800]) {
        const r = optimize({ vocation: 'paladin', ...at(level), monster: null, priority, context: HUNT });
        const inRotation = r.rotation!.spells.find((s) => s.name === 'Divine Grenade');
        expect(Boolean(inRotation?.fromRevelation)).toBe(revStage(r, 'Divine Grenade') > 0);
        seen += inRotation ? 1 : 0;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('a manual rotation is reported and used', () => {
    const r = optimize({ vocation: 'paladin', ...at(600), monster: null, priority: 50, context: HUNT, rotationId: 'rp-barrages' });
    expect(r.rotation).toMatchObject({ presetId: 'rp-barrages', auto: false });
    expect(rotationNames(r)).toEqual(expect.arrayContaining(['Divine Barrage', 'Ethereal Barrage']));
    for (const a of r.alternatives ?? []) expect(a.result.rotation?.presetId).toBe('rp-barrages');
  });
});

describe('transit slices and forced spells', () => {
  const input = { vocation: 'paladin', ...at(600), monster: null, priority: 50, context: HUNT, rotationId: 'rp-caldera-ethereal' } as const;

  it('augments of spells outside the rotation are worth 0', () => {
    const r = optimize(input);
    const transit = new Set(r.spells.filter((s) => s.reasonMsg?.key === 'spell.notInRotation').map((s) => s.name));
    expect(transit.size).toBeGreaterThan(0);
    const v = valuationFor(input);
    let checked = 0;
    for (const sl of getEngineWheel('paladin').slices) {
      const a = sl.tile.conviction.augment;
      if (!a || !a.spells.every((s) => transit.has(s))) continue;
      checked++;
      for (const p of augmentParts(v, sl.tile)) expect(p.off + p.def + p.util, a.spells.join()).toBe(0);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('a forced spell gets at least its stage I augment', () => {
    const r = optimize({ ...input, forcedSpells: ['Divine Dazzle'] });
    const keys = r.rationaleMsgs!.map((m) => m.key);
    expect(keys).toContain('rationale.forced');
    expect(keys).not.toContain('rationale.forcedImpossible');
    expect(r.spells.find((s) => s.name === 'Divine Dazzle')?.reasonMsg?.key).toBe('spell.forced');
    const slices = getEngineWheel('paladin').slices.filter((sl) => sl.tile.conviction.augment?.spells.includes('Divine Dazzle'));
    expect(slices.some((sl) => (r.allocation[sl.slice.id] ?? 0) >= sl.capacity)).toBe(true);
    const tiny = optimize({ ...input, points: 5, forcedSpells: ['Divine Dazzle'] });
    expect(tiny.rationaleMsgs!.map((m) => m.key)).toContain('rationale.forcedImpossible');
  });
});

describe('D22: area augments and near-equal gem substitutes', () => {
  it('a spell with its wheel area augment uses the community hunt average; without it fewer targets', () => {
    const m = buildSpellModel('knight', { mode: 'hunt' }, null, { level: 1250 });
    const fs = m.spells.get('Front Sweep')!;
    expect(fs.areaGap).toBeGreaterThan(0);
    expect(targetsAt(m, fs, 0, 1)).toBeCloseTo(fs.targets + fs.areaGap);
  });

  it('EK 1200 pts max DPS: greater gem lists near-equal substitutes', () => {
    const r = optimize({ vocation: 'knight', points: 1200, monster: null, priority: 0, context: { mode: 'hunt' } });
    const greater = r.gemRecommendations.find((g) => g.quality === 'greater' && !g.mods.some((m) => /Revelation Mastery/.test(m.name)))!;
    const sup = greater.mods.find((x) => x.kind === 'supreme')!;
    for (const s of greater.similar ?? []) expect(s.relative).toBeGreaterThanOrEqual(90);
    // Grade I (new gem): Executioner's Throw's cooldown mod edges out Fierce Berserk.
    expect(['Augmented Fierce Berserk', "Augmented Executioner's Throw"]).toContain(sup.name);
  });
});

describe('iteration 4 follow-up', () => {
  const sorc = (points: number, priority: number, rotationId?: string) =>
    optimize({ vocation: 'sorcerer', points, character: { level: 300 }, monster: null, priority, context: HUNT, alternatives: 0, rotationId });

  it('auto mode finds Beam Mastery for a 250–300 point sorcerer when the objective prefers it (priority 20)', () => {
    for (const points of [250, 300]) {
      const r = sorc(points, 20);
      expect(revStage(r, 'Beam Mastery'), `${points}`).toBe(1);
      expect(r.rotation?.presetId).toBe('ms-echo-gdb');
      expect(r.rotation?.auto).toBe(true);
    }
  });

  it('manual and auto mode share the offense reference', () => {
    for (const context of [HUNT, { mode: 'boss' } as const]) {
      const input = { vocation: 'sorcerer' as const, points: 300, monster: null, priority: 50, context };
      const auto = planSpecs(input)[0].reference;
      expect(auto).toBeGreaterThan(1);
      for (const rotationId of ['ms-echo-gdb', 'ms-gfw-echo']) expect(planSpecs({ ...input, rotationId })[0].reference).toBe(auto);
    }
  });

  it('alternative labels never use a "-" placeholder', () => {
    for (const vocation of VOCATIONS) {
      for (const points of [100, 250, 400]) {
        const r = optimize({ vocation, points, monster: null, priority: 50, context: HUNT, alternatives: 5 });
        for (const a of r.alternatives ?? []) {
          expect(a.label).not.toMatch(/^-|\s-\s/);
          expect(a.labelMsg?.params?.revelation ?? 'x').not.toBe('');
        }
      }
    }
  });
});
