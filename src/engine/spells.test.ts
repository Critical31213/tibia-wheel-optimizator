import { describe, expect, it } from 'vitest';
import type { FightContext, Monster, Vocation } from '../types';
import { getSpell, getWheelSpellNames } from '../data/wheel';
import { optimize } from './index';
import { valuationFor } from './optimizer';
import {
  BOSS_AREA_TARGETS,
  buildSpellModel,
  cooldownGain,
  damageShare,
  expectedTargets,
  outerBeamTargets,
} from './spells';
import { augmentParts, avatarParts, flatParts, parseEffects, revelationParts, supremeModParts } from './values';
import { getEngineWheel, REVELATION_FLAT_BONUS } from './wheel/build';

const HUNT: FightContext = { mode: 'hunt' };
const BOSS: FightContext = { mode: 'boss' };

const monster = (id: string, mods: Monster['elementModifiers'], damageTypes: Monster['damageTypes'] = ['physical']): Monster => ({
  id,
  name: id,
  elementModifiers: mods,
  damageTypes,
  maxDamage: 500,
});
const energyImmune = monster('energy-immune', { energy: 0 }, ['energy']);

describe('expected targets per context', () => {
  const meta = (n: string) => getSpell(n)!;

  it('single-target spells always hit 1', () => {
    for (const ctx of [HUNT, BOSS]) {
      expect(expectedTargets(meta('Annihilation'), ctx)).toBe(1);
      expect(expectedTargets(meta('Strong Energy Strike'), ctx)).toBe(1);
    }
  });

  it('hunt uses the tibiapal averages capped by maxTargets, boss ~1.2', () => {
    const fb = meta('Fierce Berserk');
    expect(expectedTargets(fb, HUNT)).toBe(Math.min(fb.maxTargets, fb.avgHitsHunt!));
    expect(expectedTargets(fb, BOSS)).toBe(BOSS_AREA_TARGETS);
    expect(expectedTargets(fb, { mode: 'hunt', huntStyle: 'teamBox' })).toBe(expectedTargets(fb, HUNT));
  });

  it('boss never values an area spell above hunt', () => {
    for (const s of ['knight', 'paladin', 'sorcerer', 'druid', 'monk'] as Vocation[]) {
      for (const name of getWheelSpellNames(s)) {
        const m = getSpell(name);
        if (!m || m.kind !== 'damage') continue;
        expect(expectedTargets(m, BOSS)).toBeLessThanOrEqual(expectedTargets(m, HUNT));
      }
    }
  });

  it('beams split central and outer targets; no outer targets in boss mode', () => {
    const b = meta('Great Energy Beam');
    expect(expectedTargets(b, HUNT)).toBe(b.avgHitsHunt);
    expect(outerBeamTargets(b, HUNT)).toBe(b.avgHitsHuntOuter);
    expect(outerBeamTargets(b, BOSS)).toBe(0);
  });
});

describe('spell shares', () => {
  it('area spells count more targets while hunting than against a boss', () => {
    for (const [voc, area] of [
      ['knight', 'Fierce Berserk'],
      ['sorcerer', 'Energy Wave'],
    ] as const) {
      const hunt = buildSpellModel(voc, HUNT, null);
      const boss = buildSpellModel(voc, BOSS, null);
      expect(hunt.spells.get(area)!.targets).toBeGreaterThan(boss.spells.get(area)!.targets);
    }
  });

  it('D16: single-target spells are worthless while hunting, used against bosses', () => {
    for (const voc of ['knight', 'paladin', 'sorcerer', 'druid', 'monk'] as const) {
      for (const ctx of [HUNT]) {
        const hunt = buildSpellModel(voc, ctx, null);
        for (const s of hunt.spells.values()) {
          if (!s.singleTarget) continue;
          expect(s.usable).toBe(false);
          expect(damageShare(hunt, s.name)).toBe(0);
        }
      }
      const boss = buildSpellModel(voc, BOSS, null);
      for (const s of boss.spells.values()) if (s.dmg) expect(s.usable && s.targets <= BOSS_AREA_TARGETS + 1e-9).toBe(true);
    }
    expect(damageShare(buildSpellModel('knight', BOSS, null), 'Annihilation')).toBeGreaterThan(0);
    const v = valuationFor({ vocation: 'knight', points: 1500, monster: null, context: HUNT });
    const aug = getEngineWheel('knight').slices.find((s) => s.tile.conviction.name === 'Augmented Annihilation');
    if (aug) expect(augmentParts(v, aug.tile).every((p) => p.off === 0)).toBe(true);
    const r = optimize({ vocation: 'knight', points: 1500, monster: null, priority: 50, context: HUNT });
    expect(r.convictions.some((c) => c.name === 'Augmented Annihilation')).toBe(false);
    expect(r.rationaleMsgs?.some((m) => m.key === 'rationale.singleTarget')).toBe(true);
  });

  it('an immune monster makes that element\'s spells useless', () => {
    const model = buildSpellModel('sorcerer', HUNT, energyImmune);
    expect(damageShare(model, 'Energy Wave')).toBe(0);
    expect(damageShare(model, 'Great Fire Wave')).toBeGreaterThan(0);
    const v = valuationFor({ vocation: 'sorcerer', points: 800, monster: energyImmune, context: HUNT });
    const w = getEngineWheel('sorcerer');
    const tile = w.slices.find((s) => s.tile.conviction.name === 'Augmented Energy Wave')!.tile;
    const [one, two] = augmentParts(v, tile);
    expect(one.off + two.off).toBe(0);
    const facts = { stages: [3, 3, 3, 3], revPoints: [1000, 1000, 1000, 1000], wheelEffects: new Map() };
    const dmgMod = w.supremeMods.find((m) => m.spell === 'Energy Wave' && m.category === 'augDamage')!;
    expect(supremeModParts(v, w.revelations, facts, dmgMod, 4).off).toBe(0);

    // D24: with an elemental stance Energy Wave is converted, so it stays useful.
    const r = optimize({ vocation: 'sorcerer', points: 800, monster: energyImmune, priority: 0 });
    expect(r.stances?.some((s) => s.startsWith('Master of') && s !== 'Master of Thunder')).toBe(true);
    expect(r.spells.find((s) => s.name === 'Energy Wave')!.useful).toBe(true);
  });

  it('lists every spell the wheel can augment with a reason', () => {
    for (const voc of ['knight', 'paladin', 'sorcerer', 'druid', 'monk'] as Vocation[]) {
      const r = optimize({ vocation: voc, points: 600, monster: null, priority: 50 });
      expect(r.spells.map((s) => s.name).sort()).toEqual([...getWheelSpellNames(voc)].sort());
      for (const s of r.spells) {
        expect(s.reason.length).toBeGreaterThan(0);
        expect(s.reasonMsg?.key).toMatch(/^spell\./);
        expect(s.expectedTargets).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('avatar, cooldowns, effects', () => {
  it('Avatar is worth 0 in hunt and > 0 in boss (revelation and supreme mods)', () => {
    for (const voc of ['knight', 'paladin', 'sorcerer', 'druid', 'monk'] as Vocation[]) {
      const w = getEngineWheel(voc);
      const avatar = w.revelations.find((r) => r.data.isAvatar)!;
      const facts = { stages: [3, 3, 3, 3], revPoints: [1000, 1000, 1000, 1000], wheelEffects: new Map() };
      const cdMod = w.supremeMods.find((m) => m.category === 'augCooldown' && m.spell === avatar.data.name)!;
      for (const stage of [1, 2, 3]) {
        const hunt = valuationFor({ vocation: voc, points: 1000, monster: null, context: HUNT });
        const boss = valuationFor({ vocation: voc, points: 1000, monster: null, context: BOSS });
        const flat = flatParts(hunt, REVELATION_FLAT_BONUS[stage]);
        const h = revelationParts(hunt, avatar, stage);
        expect(h.off).toBeCloseTo(flat.off);
        expect(h.def).toBeCloseTo(flat.def);
        expect(revelationParts(boss, avatar, stage).off).toBeGreaterThan(flatParts(boss, REVELATION_FLAT_BONUS[stage]).off);
        expect(avatarParts(hunt, stage)).toEqual({ off: 0, def: 0, util: 0 });
        expect(supremeModParts(hunt, w.revelations, facts, cdMod, 4)).toEqual({ off: 0, def: 0, util: 0 });
        expect(supremeModParts(boss, w.revelations, facts, cdMod, 4).off).toBeGreaterThan(0);
      }
      const r = optimize({ vocation: voc, points: 1000, monster: null, priority: 50 });
      expect(r.spells.find((s) => s.name === avatar.data.name)!.useful).toBe(false);
      const rb = optimize({ vocation: voc, points: 1000, monster: null, priority: 50, context: BOSS });
      expect(rb.spells.find((s) => s.name === avatar.data.name)!.useful).toBe(true);
    }
  });

  it('cooldowns cannot drop below 50 % of the base cooldown', () => {
    expect(cooldownGain(10, 2)).toBeCloseTo(0.25);
    expect(cooldownGain(10, 5)).toBeCloseTo(1);
    expect(cooldownGain(10, 8)).toBeCloseTo(1);
    expect(cooldownGain(10, 0)).toBe(0);
  });

  it('momentum: cooldown mods gain value per grade only through momentum', () => {
    const w = getEngineWheel('paladin');
    const v = valuationFor({ vocation: 'paladin', points: 1500, monster: null, context: HUNT });
    const facts = { stages: [3, 3, 3, 3], revPoints: [1000, 1000, 1000, 1000], wheelEffects: new Map() };
    const mod = w.supremeMods.find((m) => m.category === 'augCooldown' && m.spell === 'Divine Grenade')!;
    const g = [1, 2, 3, 4].map((grade) => supremeModParts(v, w.revelations, facts, mod, grade).off);
    expect(g[0]).toBeGreaterThan(0);
    for (let k = 1; k < 4; k++) expect(g[k]).toBeGreaterThan(g[k - 1]);
    expect(g[3] - g[0]).toBeCloseTo(1 * 0.5);
  });

  it('parses augment effect texts', () => {
    expect(parseEffects('+40% Base Damage')).toEqual([{ kind: 'dmg', amount: 40 }]);
    expect(parseEffects('-4s Cooldown; Focus secondary group cooldown -4s for X')).toEqual([{ kind: 'cd', amount: 4 }]);
    expect(parseEffects('Adds 15% life leech to this spell')).toEqual([{ kind: 'leech', amount: 15 }]);
    expect(parseEffects('Expanded Shape')).toEqual([{ kind: 'area', amount: 1 }]);
    expect(parseEffects('Jumps to +2 additional targets')).toEqual([{ kind: 'jumps', amount: 2 }]);
    expect(parseEffects('-30 Mana Cost')).toEqual([{ kind: 'mana', amount: 30 }]);
  });

  it('augment stage II is valued on top of stage I (twins have the same values)', () => {
    const w = getEngineWheel('knight');
    const v = valuationFor({ vocation: 'knight', points: 1000, monster: null, context: HUNT });
    const fs = w.slices.filter((s) => s.tile.conviction.name === 'Augmented Front Sweep');
    const [a1, a2] = augmentParts(v, fs[0].tile);
    expect(augmentParts(v, fs[1].tile)).toEqual([a1, a2]);
    expect(a1.off).toBeGreaterThan(0);
    expect(a2.off).toBeGreaterThan(0);
    const [, bossII] = augmentParts(valuationFor({ vocation: 'knight', points: 1000, monster: null, context: BOSS }), fs[0].tile);
    expect(bossII.off).toBe(0);
  });
});
