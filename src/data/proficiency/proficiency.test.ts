import { describe, expect, it } from 'vitest';
import { BESTIARY_CLASSES, VOCATIONS } from '../../types';
import { MONSTERS } from '..';
import formulas from '../damage/spell-formulas.json';
import { SHAPING_OPTIONS, WEAPONS, getWeapon, searchWeapons, shapingOptions, shapingValue, weaponsFor } from '.';

/** Augmented spells without a damage/healing formula (low level, avatars, support): their augments are worth 0. */
const UNMODELLED = new Set([
  "Apprentice's Strike", 'Avatar of Balance', 'Avatar of Light', 'Avatar of Nature', 'Avatar of Steel', 'Avatar of Storm',
  'Buzz', 'Chill Out', 'Divine Dazzle', 'Divine Empowerment', 'Divine Healing', 'Inflict Wound', 'Intense Healing',
  'Lesser Ethereal Spear', 'Lesser Front Sweep', 'Light Healing', 'Scorch', 'Wound Cleansing',
]);

describe('proficiency data', () => {
  it('has unique ids and complete trees', () => {
    expect(WEAPONS.length).toBeGreaterThan(400);
    expect(new Set(WEAPONS.map((w) => w.id)).size).toBe(WEAPONS.length);
    for (const w of WEAPONS) {
      expect(w.vocations.length, w.name).toBeGreaterThan(0);
      expect(w.levels.length, w.name).toBeGreaterThanOrEqual(3);
      expect(w.levels.length, w.name).toBeLessThanOrEqual(7);
      for (const level of w.levels) {
        expect(level.length, w.name).toBeGreaterThanOrEqual(1);
        expect(level.length, w.name).toBeLessThanOrEqual(3);
        for (const p of level) expect(Number.isFinite(p.value), `${w.name} ${p.kind}`).toBe(true);
      }
    }
  });

  it('names only known spells and bestiary classes', () => {
    const known = new Set([...formulas.spells.map((s) => s.name), ...formulas.healing.map((s) => s.name)]);
    const perks = [...WEAPONS.flatMap((w) => w.levels.flat()), ...SHAPING_OPTIONS];
    const unknown = new Set(perks.filter((p) => p.spell && !known.has(p.spell) && !UNMODELLED.has(p.spell)).map((p) => p.spell));
    expect([...unknown]).toEqual([]);
    const classes = new Set<string>(BESTIARY_CLASSES);
    expect(perks.filter((p) => p.bestiary && !classes.has(p.bestiary))).toEqual([]);
  });

  it('offers weapons and shaping options to every vocation', () => {
    for (const v of VOCATIONS) {
      expect(weaponsFor(v).length, v).toBeGreaterThan(10);
      expect(shapingOptions(v).filter((o) => o.group === v).length, v).toBe(30);
    }
    expect(shapingOptions('knight').length).toBe(34 + 30);
  });

  it('reads stats and trees of a known weapon', () => {
    const w = getWeapon('stellar-moonsilver-epee');
    expect(w).toMatchObject({ type: 'sword', vocations: ['knight'], minLevel: 1000, elementAttack: { element: 'earth' } });
    expect(w?.levels[2].some((p) => p.spell === 'Groundshaker' && p.augment === 'baseDamage')).toBe(true);
    expect(searchWeapons('moonsilver', 'knight')[0].name).toMatch(/Moonsilver/);
  });

  it('interpolates shaping ranks linearly', () => {
    const o = SHAPING_OPTIONS.find((s) => s.kind === 'alphaStrike')!;
    expect(shapingValue(o, 0)).toBeCloseTo(0.02);
    expect(shapingValue(o, 5)).toBeCloseTo(0.06);
    expect(shapingValue(o, 10)).toBeCloseTo(0.1);
  });

  it('gives almost every monster a bestiary class', () => {
    const classes = new Set<string>(BESTIARY_CLASSES);
    expect(MONSTERS.filter((m) => m.bestiaryClass && !classes.has(m.bestiaryClass))).toEqual([]);
    expect(MONSTERS.filter((m) => m.bestiaryClass).length / MONSTERS.length).toBeGreaterThan(0.95);
    expect(MONSTERS.find((m) => m.id === 'dragon-lord')?.bestiaryClass).toBe('Dragon');
  });
});
