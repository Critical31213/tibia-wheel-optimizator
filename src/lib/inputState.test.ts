import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUTS, fromQuery, sanitize, toQuery } from './inputState';

describe('inputState', () => {
  it('round-trips through the query string', () => {
    const state = { vocation: 'druid' as const, points: 420, monsterId: 'demon', priority: 75 };
    expect(fromQuery(toQuery(state))).toEqual(state);
  });

  it('drops the monster param for a generic build and keeps unrelated params', () => {
    const q = toQuery({ ...DEFAULT_INPUTS, monsterId: null }, '?demo=1&m=rat');
    const params = new URLSearchParams(q);
    expect(params.get('demo')).toBe('1');
    expect(params.has('m')).toBe(false);
  });

  it('ignores invalid values and clamps ranges', () => {
    expect(fromQuery('?v=wizard&p=abc&prio=500')).toEqual({ priority: 100 });
    expect(sanitize({ points: -5, monsterId: '  ' })).toEqual({ points: 0 });
  });
});
