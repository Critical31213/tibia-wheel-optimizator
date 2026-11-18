import { describe, expect, it } from 'vitest';
import { en } from './en';
import { detectLang, format, translator } from './lang';
import { pl } from './pl';

describe('i18n dictionaries', () => {
  it('PL and EN have identical keys and no empty strings', () => {
    expect(Object.keys(pl).sort()).toEqual(Object.keys(en).sort());
    for (const v of [...Object.values(en), ...Object.values(pl)]) expect(v.trim()).not.toBe('');
  });

  it('PL and EN use the same placeholders per key', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(ph(pl[k]), k).toEqual(ph(en[k]));
  });
});

describe('i18n helpers', () => {
  it('detects Polish from navigator.language', () => {
    expect(detectLang('pl-PL')).toBe('pl');
    expect(detectLang('PL')).toBe('pl');
    expect(detectLang('en-US')).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });

  it('interpolates placeholders', () => {
    expect(format('{a} of {b}', { a: 1, b: 'x' })).toBe('1 of x');
    expect(format('{a} {missing}', { a: 1 })).toBe('1 {missing}');
    expect(translator('pl')('gems.gemN', { n: 2 })).toBe('Gem 2');
    expect(translator('en')('results.pointsUsed', { used: 5, total: 10 })).toBe('5 of 10 points used.');
  });
});
