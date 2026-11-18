import { describe, expect, it } from 'vitest';
import type { Element } from '../types';
import {
  MONSTERS,
  getBestAttackElement,
  getModifier,
  getMonsterById,
  getStrongestElements,
  getWeakestElements,
  normalizeText,
  searchMonsters,
} from './index';

const ELEMENTS: Element[] = [
  'physical', 'fire', 'earth', 'energy', 'ice', 'holy', 'death',
  'lifeDrain', 'manaDrain', 'drown', 'healing',
];

describe('monsters.json shape', () => {
  it('has a substantial number of monsters', () => {
    expect(MONSTERS.length).toBeGreaterThan(500);
  });

  it('every record matches the Monster contract', () => {
    const ids = new Set<string>();
    for (const m of MONSTERS) {
      expect(m.id, m.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(ids.has(m.id), `duplicate id ${m.id}`).toBe(false);
      ids.add(m.id);
      expect(typeof m.name).toBe('string');
      expect(m.name.trim().length).toBeGreaterThan(0);
      for (const key of ['hitpoints', 'experience', 'maxDamage'] as const) {
        const v = m[key];
        if (v !== undefined) {
          expect(Number.isInteger(v), `${m.id}.${key}`).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
      }
      if (m.hitpoints !== undefined) expect(m.hitpoints, `${m.id}.hitpoints`).toBeGreaterThan(0);
      expect(typeof m.elementModifiers).toBe('object');
      for (const [k, v] of Object.entries(m.elementModifiers)) {
        expect(ELEMENTS, `${m.id} modifier key`).toContain(k);
        expect(typeof v).toBe('number');
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(300);
      }
      expect(Array.isArray(m.damageTypes)).toBe(true);
      for (const d of m.damageTypes) expect(ELEMENTS).toContain(d);
      expect(new Set(m.damageTypes).size).toBe(m.damageTypes.length);
      if (m.imageUrl !== undefined) expect(m.imageUrl).toMatch(/^https:\/\//);
      expect(m.sourceUrl).toMatch(/^https:\/\/tibiopedia\.pl\/monsters\//);
    }
  });

  it('is sorted by name', () => {
    const names = MONSTERS.map((m) => m.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en'));
    expect(names).toEqual(sorted);
  });
});

describe('well-known monsters (spot checks against Tibia knowledge)', () => {
  it('Dragon', () => {
    const m = getMonsterById('dragon')!;
    expect(m).toBeDefined();
    expect(m.hitpoints).toBe(1000);
    expect(m.experience).toBe(700);
    expect(m.elementModifiers.fire).toBe(0);
    expect(m.elementModifiers.earth).toBe(20);
    expect(m.elementModifiers.ice).toBe(110);
    expect(m.damageTypes).toEqual(expect.arrayContaining(['physical', 'fire']));
  });

  it('Dragon Lord is fire immune and weak to ice', () => {
    const m = getMonsterById('dragon-lord')!;
    expect(m.hitpoints).toBe(1900);
    expect(m.experience).toBe(2100);
    expect(m.elementModifiers.fire).toBe(0);
    expect(getModifier(m, 'ice')).toBeGreaterThan(100);
    expect(getBestAttackElement(m)).toBe('ice');
  });

  it('Demon is fire immune and weak to holy/ice', () => {
    const m = getMonsterById('demon')!;
    expect(m.hitpoints).toBe(8200);
    expect(m.experience).toBe(6000);
    expect(m.elementModifiers.fire).toBe(0);
    expect(getModifier(m, 'holy')).toBeGreaterThan(100);
    expect(m.damageTypes).toEqual(expect.arrayContaining(['fire', 'energy']));
  });

  it('Hydra is earth immune and weak to energy', () => {
    const m = getMonsterById('hydra')!;
    expect(m.hitpoints).toBe(2350);
    expect(m.experience).toBe(2100);
    expect(m.elementModifiers.earth).toBe(0);
    expect(getModifier(m, 'energy')).toBeGreaterThan(100);
  });

  it('Grim Reaper resists death and is weak to holy and fire', () => {
    const m = getMonsterById('grim-reaper')!;
    expect(m.hitpoints).toBe(3900);
    expect(m.experience).toBe(5500);
    expect(m.elementModifiers.death).toBe(20);
    expect(getModifier(m, 'holy')).toBeGreaterThan(100);
    expect(getModifier(m, 'fire')).toBeGreaterThan(100);
  });
});

describe('searchMonsters', () => {
  it('returns nothing for empty / whitespace queries', () => {
    expect(searchMonsters('')).toEqual([]);
    expect(searchMonsters('   ')).toEqual([]);
  });

  it('ranks exact match first', () => {
    expect(searchMonsters('dragon')[0].name).toBe('Dragon');
    expect(searchMonsters('DRAGON LORD')[0].name).toBe('Dragon Lord');
  });

  it('ranks prefix matches before word-prefix and substring matches', () => {
    const names = searchMonsters('dragon', 50).map((m) => m.name);
    const firstNonPrefix = names.findIndex((n) => !n.toLowerCase().startsWith('dragon'));
    const lastPrefix = names.map((n) => n.toLowerCase().startsWith('dragon')).lastIndexOf(true);
    if (firstNonPrefix !== -1) expect(lastPrefix).toBeLessThan(firstNonPrefix);
    // "Elder Dragon"-style names (word-prefix) still appear
    expect(names.some((n) => /\s[Dd]ragon/.test(n))).toBe(true);
  });

  it('matches word prefixes ("lord" → Dragon Lord) before plain substrings', () => {
    const res = searchMonsters('lord', 200).map((m) => m.name);
    expect(res).toContain('Dragon Lord');
  });

  it('is case- and diacritic-insensitive', () => {
    expect(searchMonsters('DéMöN')[0].name).toBe('Demon');
    expect(normalizeText('Świętość Łódź')).toBe('swietosc lodz');
  });

  it('respects the limit', () => {
    expect(searchMonsters('a', 5)).toHaveLength(5);
    expect(searchMonsters('a', 0)).toEqual([]);
  });

  it('ignores spaces as a last resort', () => {
    expect(searchMonsters('dragonlord').map((m) => m.name)).toContain('Dragon Lord');
  });

  it('returns nothing for gibberish', () => {
    expect(searchMonsters('zzqqxx')).toEqual([]);
  });
});

describe('getMonsterById', () => {
  it('returns undefined for unknown ids', () => {
    expect(getMonsterById('definitely-not-a-monster')).toBeUndefined();
    expect(getMonsterById('')).toBeUndefined();
  });
});

describe('element helpers', () => {
  const fake = {
    id: 'fake',
    name: 'Fake',
    elementModifiers: { fire: 0, ice: 120, earth: 80, holy: 120 },
    damageTypes: [],
  };

  it('getModifier defaults to 100', () => {
    expect(getModifier(fake, 'energy')).toBe(100);
  });

  it('getWeakestElements sorts by damage taken and drops immunities', () => {
    const res = getWeakestElements(fake);
    expect(res[0]).toEqual({ element: 'ice', modifier: 120 });
    expect(res[1]).toEqual({ element: 'holy', modifier: 120 });
    expect(res.find((r) => r.element === 'fire')).toBeUndefined();
    expect(res.at(-1)).toEqual({ element: 'earth', modifier: 80 });
  });

  it('getStrongestElements lists only resistances, strongest first', () => {
    expect(getStrongestElements(fake)).toEqual([
      { element: 'fire', modifier: 0 },
      { element: 'earth', modifier: 80 },
    ]);
  });
});
