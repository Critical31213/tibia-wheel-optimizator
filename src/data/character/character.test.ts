import { describe, expect, it } from 'vitest';
import { VOCATIONS } from '../../types';
import {
  capacity,
  defaultCharacterStats,
  maxHitPoints,
  maxMana,
  mitigationBreakEvenPercent,
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

describe('mitigation calibration', () => {
  it('Royal Paladin around mid levels is about 1 %', () => {
    for (const l of [500, 700, 900]) {
      const m = mitigationPercent('paladin', l);
      expect(m).toBeGreaterThan(0.7);
      expect(m).toBeLessThan(1.3);
    }
  });

  it('knights are highest, mages lowest; grows slowly with level', () => {
    for (const l of [200, 800, 1500]) {
      expect(mitigationPercent('knight', l)).toBeGreaterThan(mitigationPercent('paladin', l));
      expect(mitigationPercent('paladin', l)).toBeGreaterThan(mitigationPercent('sorcerer', l));
    }
    expect(mitigationPercent('knight', 1500)).toBeGreaterThan(mitigationPercent('knight', 200));
    expect(mitigationPercent('knight', 1200)).toBeLessThan(4);
  });

  it('wheel multiplier is multiplicative; two-handed knights get less', () => {
    const base = mitigationPercent('knight', 1000);
    expect(mitigationPercent('knight', 1000, { wheelMultiplierPct: 30 })).toBeCloseTo(base * 1.3);
    expect(mitigationPercent('knight', 1000, { wielding: 'twoHanded' })).toBeLessThan(base);
  });

  it('as pure effective HP a Mitigation point never beats an HP point at 200-1500', () => {
    for (const l of [200, 800, 1200, 1500]) {
      expect(mitigationBreakEvenPercent('knight', l, 3)).toBeGreaterThan(mitigationPercent('knight', l, { wheelMultiplierPct: 30 }));
      expect(mitigationBreakEvenPercent('paladin', l, 2)).toBeGreaterThan(mitigationPercent('paladin', l, { wheelMultiplierPct: 30 }));
    }
  });
});
