import { describe, expect, it } from 'vitest';
import { MONSTERS } from '../data';
import { getWeapon, type Perk } from '../data/proficiency';
import type { OptimizerInput } from '../types';
import { runOptimizer } from './optimizer';
import { applyLoadout, choosePerks, levelOptions, loadoutCharacter, type Loadout } from './proficiency';
import { buildSpellModel, castDamage, NO_BONUS, rotationTotal } from './spells';

const dragonLord = MONSTERS.find((m) => m.id === 'dragon-lord')!;
const epee = getWeapon('stellar-moonsilver-epee')!;
const char = { level: 1000, mainSkill: 130, magicLevel: 12, shielding: 120 };
const lo = (perks: Perk[], weapon = epee): Loadout => ({ weapon, perks });
const knight = (mode: 'hunt' | 'boss') => buildSpellModel('knight', { mode }, mode === 'hunt' ? dragonLord : null, char);
const groundshaker = (perks: Perk[], mode: 'hunt' | 'boss' = 'hunt') => {
  const m = applyLoadout(knight(mode), lo(perks));
  return castDamage(m, m.spells.get('Groundshaker')!, NO_BONUS);
};

const input = (extra: Partial<OptimizerInput> = {}): OptimizerInput =>
  ({ vocation: 'knight', level: 1000, points: 4000, priority: 50, context: { mode: 'boss' }, monster: null, ...extra }) as OptimizerInput;

describe('weapon proficiency model (D45)', () => {
  it('adds the skill of the weapon type and shielding', () => {
    const c = loadoutCharacter({ ...char, level: 1000 }, 'knight', lo([{ kind: 'skill', value: 2, skill: 'sword' }, { kind: 'skill', value: 1, skill: 'axe' }, { kind: 'skill', value: 2, skill: 'shielding' }]));
    // specials +6 sword, perk +2 sword; the axe perk does not apply to a sword.
    expect(c.mainSkill).toBe(138);
    expect(c.shielding).toBe(122);
  });

  it('values augments, crit and damage multipliers', () => {
    const base = groundshaker([]);
    expect(groundshaker([{ kind: 'augment', value: 0.18, spell: 'Groundshaker', augment: 'baseDamage' }])).toBeGreaterThan(base * 1.1);
    expect(groundshaker([{ kind: 'augment', value: 0.09, spell: 'Groundshaker', augment: 'critChance' }])).toBeGreaterThan(base);
    expect(groundshaker([{ kind: 'critDamage', value: 0.12 }])).toBeGreaterThan(base);
    expect(groundshaker([{ kind: 'augment', value: 0.18, spell: 'Front Sweep', augment: 'baseDamage' }])).toBeCloseTo(base);
  });

  it('applies bestiary perks only while hunting the class, boss perks only in boss mode', () => {
    expect(groundshaker([{ kind: 'bestiary', value: 0.05, bestiary: 'Dragon' }])).toBeCloseTo(groundshaker([]) * 1.05);
    expect(groundshaker([{ kind: 'bestiary', value: 0.05, bestiary: 'Human' }])).toBeCloseTo(groundshaker([]));
    expect(groundshaker([{ kind: 'boss', value: 0.05 }])).toBeCloseTo(groundshaker([]));
    expect(groundshaker([{ kind: 'boss', value: 0.05 }], 'boss')).toBeCloseTo(groundshaker([], 'boss') * 1.05);
  });

  it('raises the rotation with flat spell damage and auto-attack perks', () => {
    const t = (perks: Perk[]) => rotationTotal(applyLoadout(knight('boss'), lo(perks)), NO_BONUS);
    expect(t([{ kind: 'spellSkillScaling', value: 0.1, skill: 'sword' }])).toBeGreaterThan(t([]));
    expect(t([{ kind: 'autoCritChance', value: 0.1 }])).toBeGreaterThan(t([]));
    expect(t([{ kind: 'autoSkillScaling', value: 0.05, skill: 'fishing' }])).toBeCloseTo(t([]));
  });

  it('unlocks levels and replaces shaped slots', () => {
    const opts = levelOptions({ level: 3, shaped: [{ level: 2, replaces: 1, option: 'alphaStrike' }] }, epee);
    expect(opts.length).toBe(3);
    expect(opts[1][1]).toMatchObject({ kind: 'alphaStrike', value: 0.1 });
    expect(levelOptions({ level: 99 }, epee).length).toBe(epee.levels.length);
  });

  it('keeps manual perk choices', () => {
    const options = [[0, 5], [1, 2, 9]].map((l) => l.map((value) => ({ kind: 'attack' as const, value })));
    const score = (ch: number[]) => ch.reduce((a, c, i) => a + options[i][c].value, 0);
    expect(choosePerks(options, [], score)).toEqual([1, 2]);
    expect(choosePerks(options, [null, 0], score)).toEqual([1, 0]);
  });
});

describe('weapon choice in the optimizer (D45)', () => {
  it('leaves the build unchanged without weapons', () => {
    const a = runOptimizer(input());
    const b = runOptimizer(input({ weapons: [] }));
    expect(b.allocation).toEqual(a.allocation);
    expect(b.weapon).toBeUndefined();
  });

  it('ranks owned weapons and keeps manual perks', () => {
    const r = runOptimizer(input({
      weapons: [
        { weaponId: 'stellar-moonsilver-epee', level: 7, perks: [null, 2] },
        { weaponId: 'sanguine-cudgel', level: 7 },
        { weaponId: 'spike-sword', level: 7 },
      ].filter((w) => getWeapon(w.weaponId)),
    }));
    const w = r.weapon!;
    expect(w.ranking[0]).toBe(w.best);
    expect(w.ranking.slice(1).every((x) => x.delta <= 0.05)).toBe(true);
    if (w.best.weaponId === 'stellar-moonsilver-epee') expect(w.best.perks[1]).toBe(2);
    expect(w.reshapes.length).toBeLessThanOrEqual(3);
    expect(new Set(w.reshapes.map((x) => x.option)).size).toBe(w.reshapes.length);
  });

  it('offers no reshape when two slots are shaped, and suggests stronger unowned weapons', () => {
    const shaped = [{ level: 1, replaces: 0, option: 'alphaStrike' }, { level: 2, replaces: 0, option: 'omegaStrike' }];
    const r = runOptimizer(input({ weapons: [{ weaponId: 'sanguine-cudgel', level: 7, shaped }], suggestWeapons: true }));
    expect(r.weapon!.reshapes).toEqual([]);
    for (const s of r.weapon!.suggestions ?? []) {
      expect(s.weaponId).not.toBe('sanguine-cudgel');
      expect(s.delta).toBeGreaterThan(0);
    }
  });

  it('does not pair a two-handed weapon with the shield rotation', () => {
    const r = runOptimizer(input({ weapons: [{ weaponId: 'grand-sanguine-battleaxe', level: 7 }] }));
    expect(r.rotation?.spells.some((s) => s.name === 'Shield Slam')).toBe(false);
  });

  it('stays fast', () => {
    const t = performance.now();
    runOptimizer(input({
      context: { mode: 'hunt' },
      monster: dragonLord,
      weapons: ['stellar-moonsilver-epee', 'grand-sanguine-blade', 'grand-sanguine-battleaxe', 'sanguine-cudgel'].map((weaponId) => ({ weaponId, level: 7 })),
      suggestWeapons: true,
    }));
    expect(performance.now() - t).toBeLessThan(1500);
  });
});
