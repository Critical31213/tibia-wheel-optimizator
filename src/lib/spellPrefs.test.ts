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
import { getExcludableSpells, getForceableSpells, getRevelationNames, getRotationPresets, getCustomRotationSpells, getStanceOptions } from './api';

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
      customRotation: [],
      excludedSpells: [],
      targets: {},
      minVessels: 0,
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
      customRotation: [{ name: 'Great Fire Wave', ratio: 3 }, { name: 'Energy Wave', ratio: 1 }],
      excludedSpells: ['Great Energy Beam', "Hell's Core"],
      targets: { "Hell's Core": 9.5, 'Great Fire Wave': 4 },
      minVessels: 5,
    };
    const XS = getExcludableSpells('sorcerer');
    const ST = getStanceOptions('sorcerer');
    const RV = getRevelationNames('sorcerer');
    const CS = getCustomRotationSpells('sorcerer');
    const search = spellPrefsToQuery(prefs, '?v=sorcerer&p=100');
    expect(new URLSearchParams(search).get('v')).toBe('sorcerer');
    expect(spellPrefsFromQuery(search, IDS, SPELLS, ST, RV, CS, XS)).toEqual(prefs);
    expect(parseSpellPrefs(JSON.stringify(prefs), IDS, SPELLS, ST, RV, CS, XS)).toEqual(prefs);
    // D92: excluded spells: known only, canonical casing, unique.
    expect(spellPrefsFromQuery('?xs=great+energy+beam,Nope,Great+Energy+Beam', IDS, SPELLS, ST, RV, CS, XS)?.excludedSpells).toEqual(['Great Energy Beam']);
    // D107: targets: known spells, canonical casing, 0.1 steps within 1..50.
    expect(spellPrefsFromQuery('?tg=great+fire+wave:3.14,Nope:3,Energy+Wave:0.2,Hell%27s+Core:99,Great+Energy+Beam:x', IDS, SPELLS, ST, RV, CS, XS)?.targets).toEqual({
      'Great Fire Wave': 3.1,
      'Energy Wave': 1,
      "Hell's Core": 50,
    });
    // Custom rotation: unknown / duplicate spells dropped, casts rounded and clamped.
    expect(spellPrefsFromQuery('?cr=great+fire+wave:2.6,Nope:3,Great+Fire+Wave:1,Energy+Wave:99,Energy+Beam:0', IDS, SPELLS, ST, RV, CS)?.customRotation).toEqual([
      { name: 'Great Fire Wave', ratio: 3 },
      { name: 'Energy Wave', ratio: 20 },
    ]);
    // Stage II only for forced spells; unknown revelations / stages dropped.
    expect(spellPrefsFromQuery('?fs2=Hell%27s+Core&fr=Nope:2,Beam+Mastery:4', IDS, SPELLS, ST, RV)).toMatchObject({ forcedStage2: [], forcedRevelations: [] });
    // D116: forced vessels: whole numbers 0..8, anything else auto.
    expect(spellPrefsFromQuery('?mv=9', IDS, SPELLS)?.minVessels).toBe(0);
    expect(spellPrefsFromQuery('?mv=2.5', IDS, SPELLS)?.minVessels).toBe(0);
    expect(spellPrefsFromQuery('?mv=3', IDS, SPELLS)?.minVessels).toBe(3);
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
