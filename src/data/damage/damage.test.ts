import { describe, expect, it } from 'vitest';
import { VOCATIONS } from '../../types';
import { SPELLS } from '../wheel';
import samples from './__fixtures__/api-samples.json';
import {
  DAMAGE_SPELLS,
  levelTerm,
  HEALING_SPELLS,
  critMultiplier,
  defaultTargets,
  getDamageSpell,
  getDamageSpells,
  healingAverage,
  isSingleTarget,
  recommendedRotation,
  spellAverageHit,
  spellCooldownTurns,
  spellVariant,
  weaponBracket,
} from './index';
import type { Coefficients } from './types';

interface Sample {
  vocation: string;
  stats: { level: number; skill: number; magicLevel: number; attack: number; shielding: number; shieldDefense: number };
  raw: Record<string, number>;
}

const evalC = (c: Coefficients, s: Sample['stats']) =>
  c.const +
  (c.levelTerm ?? 0) * levelTerm(s.level) +
  ((c.levelSkillAttack ?? 0) * levelTerm(s.level) * s.skill * s.attack) / 1000 +
  (c.magicLevel ?? 0) * s.magicLevel +
  (c.skill ?? 0) * s.skill +
  (c.attack ?? 0) * s.attack +
  (c.skillAttack ?? 0) * s.skill * s.attack +
  (c.shielding ?? 0) * s.shielding +
  (c.shieldDefense ?? 0) * s.shieldDefense +
  (c.shieldingDefense ?? 0) * s.shielding * s.shieldDefense;

const variantById = new Map(DAMAGE_SPELLS.flatMap((s) => s.variants.map((v) => [v.apiId, { spell: s, v }] as const)));

describe('damage dataset', () => {
  it('has damage spells for every vocation and sane coefficients', () => {
    for (const v of VOCATIONS) expect(getDamageSpells(v).filter((s) => s.spellType === 'spell').length).toBeGreaterThan(5);
    for (const s of DAMAGE_SPELLS) {
      expect(s.variants.length).toBeGreaterThan(0);
      expect(s.cooldownSeconds).toBeGreaterThan(0);
      for (const v of s.variants) {
        expect(v.fit.maxRelErr).toBeLessThan(0.02);
        expect(v.avg.levelTerm).toBeGreaterThan(0);
        expect(v.bonusFactor).toBeGreaterThan(0);
      }
    }
  });

  it('flags single-target spells (D16) for every damage spell', () => {
    for (const s of DAMAGE_SPELLS) {
      expect(typeof s.singleTarget).toBe('boolean');
      expect(s.singleTarget).toBe(s.area === 'single');
    }
    for (const n of ['Annihilation', 'Divine Missile', 'Strong Ethereal Spear', 'Lightning', 'Strong Flame Strike', 'Ultimate Ice Strike', 'Forceful Uppercut', 'Mystic Repulse', 'Sudden Death'])
      expect(isSingleTarget(n)).toBe(true);
    for (const n of ['Fierce Berserk', 'Divine Caldera', "Hell's Core", 'Eternal Winter', 'Thousand Fist Blows', "Executioner's Throw", 'Great Death Beam', 'Forked Thorns'])
      expect(isSingleTarget(n)).toBe(false);
  });

  it('covers every wheel damage spell', () => {
    for (const s of SPELLS.filter((x) => x.kind === 'damage')) {
      const d = getDamageSpell(s.name);
      expect(d, s.name).toBeDefined();
      expect(d!.singleTarget, s.name).toBe(s.area === 'single');
    }
    for (const s of SPELLS.filter((x) => x.kind === 'healing')) expect(HEALING_SPELLS.some((h) => h.name === s.name), s.name).toBe(true);
  });

  it.each(samples as unknown as Sample[])('fits reproduce cached API responses ($vocation, level $stats.level)', (sample) => {
    let checked = 0;
    for (const [id, raw] of Object.entries(sample.raw)) {
      const hit = variantById.get(Number(id));
      if (!hit) continue;
      const pred = evalC(hit.v.avg, sample.stats);
      expect(Math.abs(pred - raw), `${hit.spell.name} ${hit.v.label ?? ''}`).toBeLessThanOrEqual(Math.max(2, raw * (hit.v.avg.levelSkillAttack ? 0.015 : 0.01)));
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });
});

describe('loader API', () => {
  const sorc = { level: 800, magicLevel: 120 };

  it('spellAverageHit scales with level/mlvl and applies base damage % and flat bonus', () => {
    const base = spellAverageHit('Great Fire Wave', sorc);
    expect(base).toBeGreaterThan(300);
    expect(spellAverageHit('Great Fire Wave', { level: 1000, magicLevel: 120 })).toBeGreaterThan(base);
    expect(spellAverageHit('Great Fire Wave', { level: 800, magicLevel: 140 })).toBeGreaterThan(base);
    // API probe (level 800, mlvl 120): 655 -> 705 with +10 % base damage, +40 with bonus 40
    expect(spellAverageHit('Great Fire Wave', sorc, { baseDamagePct: 10 }) - base).toBeCloseTo(50, -0.5);
    expect(spellAverageHit('Great Fire Wave', sorc, { flatBonus: 20 })).toBeCloseTo(base + 20, 6);
    expect(spellAverageHit('Great Death Beam', sorc, { stage: 1, part: 'extra', flatBonus: 40 }) - spellAverageHit('Great Death Beam', sorc, { stage: 1, part: 'extra' })).toBeCloseTo(10, 6);
    expect(levelTerm(500)).toBe(100);
    expect(levelTerm(1100)).toBe(200);
    expect(spellAverageHit('Unknown spell', sorc)).toBe(0);
  });

  it('weapon spells depend on attack and skill', () => {
    const k = { level: 800, mainSkill: 120 };
    const a = spellAverageHit('Fierce Berserk', k, { attack: 50 });
    expect(spellAverageHit('Fierce Berserk', k, { attack: 60 })).toBeGreaterThan(a);
    expect(spellAverageHit('Fierce Berserk', { level: 800, mainSkill: 130 }, { attack: 50 })).toBeGreaterThan(a);
    expect(spellAverageHit('Fierce Berserk', { level: 800 })).toBeGreaterThan(0);
  });

  it('staged spells grow with revelation stage', () => {
    const p = { level: 800, magicLevel: 30 };
    const s1 = spellAverageHit('Divine Grenade', p, { stage: 1 });
    const s3 = spellAverageHit('Divine Grenade', p, { stage: 3 });
    expect(s3).toBeGreaterThan(s1);
    const gdb = getDamageSpell('Great Death Beam')!;
    expect(spellVariant(gdb, 0, 'extra')).toBeUndefined();
    expect(spellAverageHit('Great Death Beam', sorc, { stage: 3, part: 'extra' })).toBeGreaterThan(spellAverageHit('Great Death Beam', sorc, { stage: 1, part: 'extra' }));
  });

  it('cooldowns, crit, targets, rotations, healing, brackets', () => {
    expect(spellCooldownTurns("Hell's Core")).toBe(20);
    expect(spellCooldownTurns('Great Fire Wave')).toBe(2);
    expect(spellCooldownTurns('Groundshaker', 2)).toBe(3);
    expect(critMultiplier(10, 50)).toBeCloseTo(1.05);
    expect(critMultiplier()).toBeCloseTo(1.05);
    expect(defaultTargets("Hell's Core")).toBeCloseTo(13.7);
    expect(defaultTargets('Annihilation')).toBe(1);
    expect(defaultTargets('Great Death Beam', true)).toBeCloseTo(3.7);
    const rot = recommendedRotation('sorcerer');
    expect(Object.values(rot).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(healingAverage('Salvation', { level: 600, magicLevel: 30 })).toBeGreaterThan(500);
    expect(healingAverage('Intense Wound Cleansing', { level: 1000, magicLevel: 12 })).toBeGreaterThan(1000);
    expect(weaponBracket('knight', 650).attack).toBeGreaterThan(40);
    expect(weaponBracket('paladin', 100).weapon).toBeTruthy();
  });
});
