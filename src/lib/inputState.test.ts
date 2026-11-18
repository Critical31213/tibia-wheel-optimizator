import { describe, expect, it } from 'vitest';
import {
  characterOf,
  contextOf,
  decodeMonsters,
  DEFAULT_INPUTS,
  encodeMonsters,
  fromQuery,
  MAX_MONSTERS,
  normalizeWeight,
  sanitize,
  toQuery,
  withKnownMonsters,
} from './inputState';

describe('inputState', () => {
  it('round-trips through the query string', () => {
    const state = {
      ...DEFAULT_INPUTS,
      vocation: 'druid' as const,
      points: 420,
      level: 470,
      scrolls: 30,
      magicLevel: 110,
      monsters: [
        { id: 'demon', weight: 1 },
        { id: 'dragon-lord', weight: 2.5 },
      ],
      priority: 75,
    };
    expect(fromQuery(toQuery(state))).toEqual(state);
  });

  it('drops empty optional params and keeps unrelated params', () => {
    const params = new URLSearchParams(toQuery(DEFAULT_INPUTS, '?demo=1&m=rat&lv=9'));
    expect(params.get('demo')).toBe('1');
    for (const k of ['m', 'lv', 'sc', 'sk', 'sh', 'ml']) expect(params.has(k), k).toBe(false);
  });

  it('ignores invalid values and clamps ranges', () => {
    expect(fromQuery('?p=abc&prio=500')).toEqual({ priority: 100 });
    expect(fromQuery('?v=wizard').vocation).toBeUndefined();
    expect(fromQuery('?v=knight')).toEqual({ vocation: 'knight', level: null, scrolls: 0, mainSkill: null, shielding: null, magicLevel: null, monsters: [] });
    expect(sanitize({ points: -5, monsterId: '  ' })).toEqual({ points: 0 });
    expect(fromQuery('?lv=0&sk=999&sc=80')).toEqual({ level: null, mainSkill: 200, scrolls: 50 });
    expect(sanitize({ level: null, shielding: 'x' })).toEqual({ level: null });
  });

  it('persists the fight context', () => {
    const state = { ...DEFAULT_INPUTS, mode: 'boss' as const };
    expect(new URLSearchParams(toQuery(state)).get('f')).toBe('boss');
    expect(fromQuery(toQuery(state))).toMatchObject({ mode: 'boss' });
    expect(fromQuery('?f=raid&h=duo')).toEqual({});
    expect(contextOf(DEFAULT_INPUTS)).toEqual({ mode: 'hunt' });
  });

  it('ignores the removed hunt style (h) and drops it from links', () => {
    expect(fromQuery('?f=boss&h=teamBox')).toEqual({ mode: 'boss' });
    expect(sanitize({ huntStyle: 'teamLure' })).toEqual({});
    expect(new URLSearchParams(toQuery(DEFAULT_INPUTS, '?h=solo&x=1')).has('h')).toBe(false);
  });
});

describe('monster list persistence', () => {
  it('encodes compactly and decodes with validation', () => {
    const list = [
      { id: 'demon', weight: 1 },
      { id: 'dragon-lord', weight: 2 },
    ];
    expect(encodeMonsters(list)).toBe('demon_dragon-lord*2');
    expect(decodeMonsters('demon_dragon-lord*2')).toEqual(list);
    expect(decodeMonsters('demon*0_bad id_demon*3_rat*abc_bat*1000')).toEqual([
      { id: 'demon', weight: 1 },
      { id: 'rat', weight: 1 },
      { id: 'bat', weight: 100 },
    ]);
    expect(decodeMonsters('')).toEqual([]);
  });

  it('migrates the legacy single monster and caps the list', () => {
    expect(fromQuery('?m=demon')).toEqual({ monsters: [{ id: 'demon', weight: 1 }] });
    expect(sanitize({ monsterId: 'demon' })).toEqual({ monsters: [{ id: 'demon', weight: 1 }] });
    const many = Array.from({ length: 15 }, (_, i) => ({ id: `m${i}`, weight: 1 }));
    expect(sanitize({ monsters: many }).monsters).toHaveLength(MAX_MONSTERS);
  });

  it('normalizes weights and drops unknown ids', () => {
    expect(normalizeWeight('0.55')).toBe(0.6);
    expect(normalizeWeight(0)).toBeUndefined();
    expect(normalizeWeight('')).toBeUndefined();
    const state = { monsters: [{ id: 'demon', weight: 1 }, { id: 'gone', weight: 2 }] };
    expect(withKnownMonsters(state, (id) => id === 'demon')).toEqual({ monsters: [{ id: 'demon', weight: 1 }] });
    expect(withKnownMonsters(state, () => true)).toBe(state);
  });
});

describe('characterOf', () => {
  it('returns undefined when nothing was entered', () => {
    expect(characterOf(DEFAULT_INPUTS)).toBeUndefined();
  });

  it('keeps only the vocation skill fields', () => {
    const s = { ...DEFAULT_INPUTS, points: 300, mainSkill: 120, shielding: 110, magicLevel: 30 };
    expect(characterOf({ ...s, vocation: 'knight' })).toEqual({ level: 350, mainSkill: 120, shielding: 110 });
    expect(characterOf({ ...s, vocation: 'sorcerer', level: 400 })).toEqual({ level: 400, magicLevel: 30 });
    expect(characterOf({ ...s, vocation: 'monk' })).toEqual({ level: 350, mainSkill: 120, magicLevel: 30 });
    expect(characterOf({ ...DEFAULT_INPUTS, vocation: 'druid', level: 200, mainSkill: 50 })).toEqual({ level: 200 });
  });
});
