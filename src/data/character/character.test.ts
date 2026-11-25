import { describe, expect, it } from 'vitest';
import { VOCATIONS } from '../../types';
import {
  capacity,
  defaultCharacterStats,
  maxHitPoints,
  maxMana,
  DEFAULT_OFFHAND,
  defaultOffhandDefense,
  effectiveHp,
  mitigationBreakEvenPercent,
  mitigationBreakdown,
  mitigationPercent,
  resolveCharacterStats,
} from './index';

describe('character formulas', () => {
  it('HP / mana / capacity by level', () => {
    expect(maxHitPoints('knight', 8)).toBe(185);
    expect(maxHitPoints('knight', 100)).toBe(185 + 92 * 15);
    expect(maxMana('sorcerer', 500)).toBe(90 + 492 * 30);
    expect(maxHitPoints('paladin', 1000)).toBe(185 + 992 * 10);
    expect(capacity('knight', 300)).toBe(470 + 292 * 25);
    expect(maxHitPoints('druid', 1)).toBe(150);
  });

  it.each(VOCATIONS)('%s default skills are monotonic in level 200-1500', (v) => {
    let prev = defaultCharacterStats(v, 200);
    for (let l = 250; l <= 1500; l += 50) {
      const s = defaultCharacterStats(v, l);
      expect(s.mainSkill).toBeGreaterThanOrEqual(prev.mainSkill);
      expect(s.magicLevel).toBeGreaterThanOrEqual(prev.magicLevel);
      expect(s.shielding).toBeGreaterThanOrEqual(prev.shielding);
      prev = s;
    }
    expect(defaultCharacterStats(v, 100).shielding).toBeGreaterThan(0);
  });

  it('resolveCharacterStats keeps user values', () => {
    expect(resolveCharacterStats('paladin', { level: 700, magicLevel: 40 }).magicLevel).toBe(40);
    expect(resolveCharacterStats('paladin', { level: 700 }).mainSkill).toBeGreaterThan(100);
  });
});

describe('mitigation (D19, calibrated on in-game Cyclopedia values)', () => {
  const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(0.05);

  it('D108: Royal Paladin 108 shielding + quiver 1.18 %; 110 shielding + Gnome Shield 1.21 % + 1.28 %', () => {
    const near2 = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.005);
    near2(mitigationBreakdown('paladin', 855, { shielding: 108, offhand: 'quiver' }).total, 1.18);
    const s = mitigationBreakdown('paladin', 855, { shielding: 110, offhand: 'shield', offhandDefense: 50 });
    near2(s.shielding, 1.21);
    near2(s.offhand, 1.28);
  });

  it('D110: Elder Druid 36 shielding 0.38 %; Spellbook of Mind Control (def 26) adds 0.61 %; level 781 defaults 0.40 %', () => {
    const near2 = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.005);
    near2(mitigationBreakdown('druid', 96, { shielding: 36, offhand: 'none' }).total, 0.38);
    const d = mitigationBreakdown('druid', 96, { shielding: 36, offhand: 'spellbook', offhandDefense: 26 });
    near2(d.shielding, 0.38);
    near2(d.offhand, 0.61);
    near(mitigationBreakdown('druid', 781).shielding, 0.4);
    expect(mitigationPercent('druid', 781)).toBeCloseTo(mitigationBreakdown('druid', 781).total, 10);
  });

  it("Elite Knight 119 shielding: 1.34 %; Ectoplasmic Shield (def 49) adds 1.27 %", () => {
    near(mitigationBreakdown("knight", 1000, { shielding: 119, offhand: "none" }).shielding, 1.34);
    near(mitigationBreakdown("knight", 1000, { shielding: 119, offhand: "shield", offhandDefense: 49 }).offhand, 1.27);
  });

  it('defaults: paladin quiver, mages spellbook, knight/monk none; bracket offhand defense', () => {
    expect(DEFAULT_OFFHAND).toEqual({ knight: 'none', paladin: 'quiver', sorcerer: 'spellbook', druid: 'spellbook', monk: 'none' });
    expect(mitigationBreakdown('knight', 800).offhand).toBe(0);
    expect(mitigationBreakdown('paladin', 800).offhand).toBe(0);
    expect(mitigationBreakdown('sorcerer', 800).offhand).toBeGreaterThan(0.8);
    expect(defaultOffhandDefense('shield', 150)).toBe(46);
    expect(defaultOffhandDefense('shield', 1500)).toBe(55);
    expect(defaultOffhandDefense('spellbook', 799)).toBe(34);
    expect(defaultOffhandDefense('quiver', 800)).toBe(0);
    expect(mitigationPercent('knight', 1000, { offhand: 'shield' })).toBeGreaterThan(mitigationPercent('knight', 1000) + 1);
  });

  it('small at 200-1500 and grows slowly with level', () => {
    for (const v of VOCATIONS)
      for (const l of [200, 800, 1500]) {
        expect(mitigationPercent(v, l)).toBeGreaterThan(0.2);
        expect(mitigationPercent(v, l, { offhand: 'shield' })).toBeLessThan(4);
      }
    expect(mitigationPercent('knight', 1500)).toBeGreaterThan(mitigationPercent('knight', 200));
  });

  it('wheel multiplier is multiplicative', () => {
    const base = mitigationPercent('knight', 1000);
    expect(mitigationPercent('knight', 1000, { wheelMultiplierPct: 30 })).toBeCloseTo(base * 1.3);
  });

  it('effectiveHp = HP / (1 - mitigation)', () => {
    expect(effectiveHp(10000, 0)).toBe(10000);
    expect(effectiveHp(10000, 2)).toBeCloseTo(10000 / 0.98, 8);
  });

  it('as pure effective HP a Mitigation point never beats an HP point at 200-1500', () => {
    for (const l of [200, 800, 1200, 1500]) {
      expect(mitigationBreakEvenPercent('knight', l, 3)).toBeGreaterThan(mitigationPercent('knight', l, { offhand: 'shield', wheelMultiplierPct: 30 }));
      expect(mitigationBreakEvenPercent('paladin', l, 2)).toBeGreaterThan(mitigationPercent('paladin', l, { wheelMultiplierPct: 30 }));
    }
  });
});
