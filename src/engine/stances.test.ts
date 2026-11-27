import { describe, expect, it } from 'vitest';
import { getStance, stanceCombos } from '../data/damage/stances';
import { pierceDamageMod } from '../data/damage';
import { resolveCharacterStats } from '../data/character';
import { optimize } from '.';
import { presetById, valuationFor } from './optimizer';
import { spellCooldown } from './spells';
import { stancedCharacter, stanceDefense, stanceElementMl } from './stances';
import { getEngineWheel } from './wheel/build';
import { augmentParts, revelationParts } from './values';

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
    expect(stancedCharacter(m, [st('Virtue of Justice')]).mainSkill).toBe(145); // 125 × 1.16 (serene)
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

describe('D24 Lord of Destruction follows the elemental stance', () => {
  const lod = (stances: string[]) => {
    const v = valuationFor({ vocation: 'sorcerer', points: 850, monster: null }, null, undefined, stances.map(st));
    const w = getEngineWheel('sorcerer');
    const r = w.revelations.find((x) => x.data.name === 'Lord of Destruction')!;
    return revelationParts(v, r, 3).off - revelationParts(v, r, 0).off;
  };
  it('worthless without an elemental stance, crit damage with Master of Decay', () => {
    const none = lod([]);
    expect(lod(['Master of Decay'])).toBeGreaterThan(none + 1);
    expect(lod(['Master of Flames'])).toBeGreaterThan(none);
  });
  it('850 points, offense: Lord of Destruction instead of Gift of Life', () => {
    const r = optimize({ vocation: 'sorcerer', points: 850, monster: null, priority: 0 });
    const names = r.revelations.filter((x) => x.stage > 0).map((x) => x.perk.name);
    expect(names).toContain('Lord of Destruction');
    expect(names).not.toContain('Gift of Life');
    // Augment pair look-ahead: stage I (-2 s cooldown) is worth 0 here, stage II (+12 % base damage) needs both copies.
    expect(r.allocation.QTR2).toBe(100);
    expect(r.allocation.QBL2).toBe(100);
  });
});

describe('D25 TibiaWiki cooldowns', () => {
  it('Death Echo 6 s: its -2 s augment is what lets the DE – EW – DE – GDB rotation cast it every 4 s', () => {
    expect(spellCooldown('Death Echo')).toBe(6);
    expect(spellCooldown('Great Death Beam')).toBe(6);
    const v = valuationFor({ vocation: 'sorcerer', points: 850, monster: null }, presetById('sorcerer', 'ms-echo-gdb'), undefined, [st('Master of Decay')]);
    const tile = getEngineWheel('sorcerer').slices.find((s) => s.tile.conviction.name === 'Augmented Death Echo')!.tile;
    expect(augmentParts(v, tile)[0].off).toBeGreaterThan(3);
    const r = optimize({ vocation: 'sorcerer', points: 850, monster: null, priority: 0 });
    expect(r.rotation!.spells.find((s) => s.name === 'Death Echo')!.ratio).toBeGreaterThan(14);
  });
});

describe('D32: manual stance', () => {
  it('overrides the automatic pick, [] = none', () => {
    const input = { vocation: 'knight' as const, points: 600, monster: null, priority: 50, alternatives: 0 };
    expect(optimize({ ...input, stances: ['Protector'] }).stances).toEqual(['Protector']);
    expect(optimize({ ...input, stances: [] }).stances).toEqual([]);
  });
});
