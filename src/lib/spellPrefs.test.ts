import { describe, expect, it } from 'vitest';
import {
  EMPTY_SPELL_PREFS,
  MAX_FORCED_SPELLS,
  parseSpellPrefs,
  sanitizeSpellPrefs,
  spellPrefsFromQuery,
  spellPrefsStorageKey,
  spellPrefsToQuery,
} from './spellPrefs';
import { getStanceOptions, getForceableSpells, getRotationPresets } from './api';

const IDS = ['ms-gfw-echo', 'ms-gfw-geb'];
const SPELLS = ["Hell's Core", 'Great Fire Wave', 'Ultimate Healing'];

describe('spell prefs', () => {
  it('sanitizes: unknown rotation → auto, spells canonical, unique, capped', () => {
    expect(sanitizeSpellPrefs({ rotationId: 'ek-mas', forcedSpells: ['great fire wave', 'GREAT FIRE WAVE', 'Nope', 3] }, IDS, SPELLS)).toEqual({
      rotationId: null,
      forcedSpells: ['Great Fire Wave'],
      stance: null,
    });
    const many = Array.from({ length: 20 }, (_, i) => `s${i}`);
    expect(sanitizeSpellPrefs({ forcedSpells: many }, IDS, many).forcedSpells).toHaveLength(MAX_FORCED_SPELLS);
    expect(sanitizeSpellPrefs(null, IDS, SPELLS)).toEqual(EMPTY_SPELL_PREFS);
    expect(parseSpellPrefs('{bad', IDS, SPELLS)).toEqual(EMPTY_SPELL_PREFS);
  });

  it('round-trips through the URL and localStorage JSON', () => {
    const prefs = { rotationId: 'ms-gfw-geb', forcedSpells: ["Hell's Core", 'Ultimate Healing'], stance: 'Master of Flames+Aura of Exposed Weakness' };
    const ST = getStanceOptions('sorcerer');
    const search = spellPrefsToQuery(prefs, '?v=sorcerer&p=100');
    expect(new URLSearchParams(search).get('v')).toBe('sorcerer');
    expect(spellPrefsFromQuery(search, IDS, SPELLS, ST)).toEqual(prefs);
    expect(parseSpellPrefs(JSON.stringify(prefs), IDS, SPELLS, ST)).toEqual(prefs);
    expect(spellPrefsFromQuery('?st=', IDS, SPELLS, ST)?.stance).toBe('');
    expect(spellPrefsFromQuery('?st=Blood+Rage', IDS, SPELLS, ST)?.stance).toBeNull();
    expect(spellPrefsToQuery(EMPTY_SPELL_PREFS, search)).toBe('?v=sorcerer&p=100');
  });

  it('URL: none without r/fs/v; a full link without them means auto', () => {
    expect(spellPrefsFromQuery('?p=100', IDS, SPELLS)).toBeUndefined();
    expect(spellPrefsFromQuery('?v=sorcerer', IDS, SPELLS)).toEqual(EMPTY_SPELL_PREFS);
    expect(spellPrefsFromQuery('?r=ek-mas', IDS, SPELLS)).toEqual(EMPTY_SPELL_PREFS);
  });

  it('per-vocation storage keys and options from the wheel/rotation data', () => {
    expect(spellPrefsStorageKey('druid')).not.toBe(spellPrefsStorageKey('sorcerer'));
    expect(getRotationPresets('sorcerer').every((p) => p.vocation === 'sorcerer')).toBe(true);
    expect(getForceableSpells('paladin')).toContain('Divine Dazzle');
    expect(getForceableSpells('monk')).toContain('Mystic Repulse');
    expect(getForceableSpells('druid')).toContain('Heal Friend');
  });
});
