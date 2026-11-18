import { describe, expect, it } from 'vitest';
import { getStance, stanceCombos } from '../data/damage/stances';
import { pierceDamageMod } from '../data/damage';
import { resolveCharacterStats } from '../data/character';
import { optimize } from '.';
import { valuationFor } from './optimizer';
import { stancedCharacter, stanceDefense, stanceElementMl } from './stances';

const st = (n: string) => getStance(n)!;

describe('D24 stances', () => {
  it('combos: one stance, sorcerer element + aura', () => {
    expect(stanceCombos('knight').map((c) => c.map((s) => s.name))).toEqual([[], ['Blood Rage'], ['Protector']]);
    expect(stanceCombos('sorcerer')).toHaveLength(12);
    expect(stanceCombos('druid').some((c) => c[0]?.name === 'Channeled Preservation')).toBe(false);
  });

  it('character: skill / shielding / element magic level', () => {
    const c = resolveCharacterStats('knight', { level: 500, mainSkill: 120, shielding: 110 });
    expect(stancedCharacter(c, [st('Blood Rage')]).mainSkill).toBe(150);
    expect(stancedCharacter(c, [st('Protector')]).shielding).toBe(143);
    const m = resolveCharacterStats('monk', { level: 500, mainSkill: 125 });
    expect(stancedCharacter(m, [st('Virtue of Justice')]).mainSkill).toBe(143); // 125 × 1.144
    const p = resolveCharacterStats('paladin', { level: 500, mainSkill: 120 });
    expect(stanceElementMl(p, [st('Divine Defiance')])).toEqual({ holy: 7, healing: 7 });
  });

  it('defense: damage taken, dodge vs non-adjacent (30 %)', () => {
    const v = valuationFor({ vocation: 'knight', points: 500, monster: null });
    const c = resolveCharacterStats('knight', { level: 550 });
    expect(stanceDefense(v.model, c, [st('Protector')], 0.5)).toBeCloseTo(100 * (1 / 0.85 - 1), 6);
    expect(stanceDefense(v.model, c, [st('Blood Rage')], 0.5)).toBeCloseTo(100 * (1 / 1.15 - 1), 6);
    const pv = valuationFor({ vocation: 'paladin', points: 500, monster: null });
    const pc = resolveCharacterStats('paladin', { level: 550 });
    expect(stanceDefense(pv.model, pc, [st('Divine Defiance')], 0)).toBeCloseTo(100 * (1 / (1 - 0.036) - 1), 6);
  });

  it('elemental pierce at most doubles the sensitivity', () => {
    expect(pierceDamageMod(0.96, 8)).toBeCloseTo(1.02, 9);
    expect(pierceDamageMod(0.04, 20)).toBeCloseTo(0.08, 9);
    expect(pierceDamageMod(0, 20)).toBe(0);
  });

  it('auto pick follows the priority', () => {
    const k = (p: number) => optimize({ vocation: 'knight', points: 700, monster: null, priority: p, character: { level: 600 } }).stances;
    expect(k(0)).toEqual(['Blood Rage']);
    expect(k(100)).toEqual(['Protector']);
    const s = optimize({ vocation: 'sorcerer', points: 700, monster: null, priority: 0, character: { level: 600 } });
    expect(s.stances).toHaveLength(2);
    expect(s.stances).toContain('Aura of Exposed Weakness');
    const rat = s.rationaleMsgs!.find((m) => m.key === 'rationale.stances');
    expect(rat?.params?.stances).toBe(s.stances!.join(' + '));
  });

  it('monk presets carry their virtue', () => {
    const r = optimize({ vocation: 'monk', points: 700, monster: null, priority: 0, rotationId: 'em-voj', character: { level: 600 } });
    expect(r.stances).toEqual(['Virtue of Justice']);
  });
});
