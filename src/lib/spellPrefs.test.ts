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
import { getForceableSpells, getRevelationNames, getRotationPresets, getStanceOptions } from './api';

const IDS = ['ms-gfw-echo', 'ms-gfw-geb'];
const SPELLS = ["Hell's Core", 'Great Fire Wave', 'Ultimate Healing'];

describe('spell prefs', () => {
  it('sanitizes: unknown rotation → auto, spells canonical, unique, capped', () => {
    expect(sanitizeSpellPrefs({ rotationId: 'ek-mas', forcedSpells: ['great fire wave', 'GREAT FIRE WAVE', 'Nope', 3] }, IDS, SPELLS)).toEqual({
      rotationId: null,
      forcedSpells: ['Great Fire Wave'],
      forcedStage2: [],
      forcedRevelations: [],
      stance: null,
    });
    const many = Array.from({ length: 20 }, (_, i) => `s${i}`);
    expect(sanitizeSpellPrefs({ forcedSpells: many }, IDS, many).forcedSpells).toHaveLength(MAX_FORCED_SPELLS);
    expect(sanitizeSpellPrefs(null, IDS, SPELLS)).toEqual(EMPTY_SPELL_PREFS);
    expect(parseSpellPrefs('{bad', IDS, SPELLS)).toEqual(EMPTY_SPELL_PREFS);
  });

  it('round-trips through the URL and localStorage JSON', () => {
    const prefs = {
      rotationId: 'ms-gfw-geb',
      forcedSpells: ["Hell's Core", 'Ultimate Healing'],
      forcedStage2: ["Hell's Core"],
      forcedRevelations: [{ name: 'Beam Mastery', stage: 2 as const }],
      stance: 'Master of Flames+Aura of Exposed Weakness',
    };
    const ST = getStanceOptions('sorcerer');
    const RV = getRevelationNames('sorcerer');
    const search = spellPrefsToQuery(prefs, '?v=sorcerer&p=100');
    expect(new URLSearchParams(search).get('v')).toBe('sorcerer');
    expect(spellPrefsFromQuery(search, IDS, SPELLS, ST, RV)).toEqual(prefs);
    expect(parseSpellPrefs(JSON.stringify(prefs), IDS, SPELLS, ST, RV)).toEqual(prefs);
    // Stage II only for forced spells; unknown revelations / stages dropped.
    expect(spellPrefsFromQuery('?fs2=Hell%27s+Core&fr=Nope:2,Beam+Mastery:4', IDS, SPELLS, ST, RV)).toMatchObject({ forcedStage2: [], forcedRevelations: [] });
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
