/**
 * Curated metadata merged into src/data/damage/spell-formulas.json by datamine-tibiatools.mjs.
 * Things the TibiaTools API does not expose: real cooldowns, area class, healing formulas.
 *
 * Cooldowns: opentibiabr/canary spell scripts (data/scripts/spells), which track the official
 * client; 2026 spells (not in canary) are estimates from tibiapal rotation presets (`approx`).
 * Healing: canary `onGetFormulaValues` (level/magic level linear formulas), APPROXIMATE.
 */

/** API name (without stage suffix) -> { cd seconds, area, approx? } */
export const SPELL_META = {
  // knight
  'Fierce Berserk': { cd: 6, area: 'area' },
  Berserk: { cd: 4, area: 'area' },
  Groundshaker: { cd: 8, area: 'area' },
  'Front Sweep': { cd: 6, area: 'area' },
  "Executioner's Throw": { cd: 18, area: 'chain' },
  Annihilation: { cd: 30, area: 'single' },
  'Brutal Strike': { cd: 6, area: 'single' },
  'Whirlwind Throw': { cd: 6, area: 'single' },
  'Shield Bash': { cd: 6, area: 'single', approx: true },
  'Shield Slam': { cd: 6, area: 'area', approx: true },
  // paladin
  'Divine Caldera': { cd: 4, area: 'area' },
  'Divine Grenade': { cd: 26, area: 'area', approx: true },
  'Strong Ethereal Spear': { cd: 8, area: 'single' },
  'Ethereal Spear': { cd: 2, area: 'single' },
  'Divine Missile': { cd: 2, area: 'single' },
  'Ethereal Barrage': { cd: 4, area: 'area', approx: true },
  'Divine Barrage': { cd: 4, area: 'area', approx: true },
  // sorcerer
  'Energy Wave': { cd: 8, area: 'area' },
  'Great Fire Wave': { cd: 4, area: 'area' },
  "Hell's Core": { cd: 40, area: 'area' },
  'Rage of the Skies': { cd: 40, area: 'area' },
  'Great Energy Beam': { cd: 6, area: 'beam' },
  'Great Death Beam': { cd: 10, area: 'beam' },
  'Fire Wave': { cd: 4, area: 'area' },
  'Strong Flame Strike': { cd: 8, area: 'single' },
  'Strong Energy Strike': { cd: 8, area: 'single' },
  'Ultimate Flame Strike': { cd: 30, area: 'single' },
  'Ultimate Energy Strike': { cd: 30, area: 'single' },
  'Death Strike': { cd: 2, area: 'single' },
  'Energy Beam': { cd: 4, area: 'beam' },
  Lightning: { cd: 8, area: 'single' },
  'Death Echo': { cd: 4, area: 'area', approx: true },
  // druid
  'Terra Wave': { cd: 4, area: 'area' },
  'Ice Burst': { cd: 22, area: 'area' },
  'Terra Burst': { cd: 22, area: 'area' },
  'Eternal Winter': { cd: 40, area: 'area' },
  'Wrath of Nature': { cd: 40, area: 'area' },
  'Strong Ice Wave': { cd: 8, area: 'area' },
  'Strong Ice Strike': { cd: 8, area: 'single' },
  'Strong Terra Strike': { cd: 8, area: 'single' },
  'Ultimate Ice Strike': { cd: 30, area: 'single' },
  'Ultimate Terra Strike': { cd: 30, area: 'single' },
  'Physical Strike': { cd: 2, area: 'single' },
  'Ice Wave': { cd: 4, area: 'area' },
  'Forked Glacier': { cd: 4, area: 'chain', approx: true },
  'Forked Thorns': { cd: 4, area: 'chain', approx: true },
  // shared strikes
  'Flame Strike': { cd: 2, area: 'single' },
  'Energy Strike': { cd: 2, area: 'single' },
  'Ice Strike': { cd: 2, area: 'single' },
  'Terra Strike': { cd: 2, area: 'single' },
  // monk
  'Chained Penance': { cd: 4, area: 'chain' },
  'Greater Flurry of Blows': { cd: 16, area: 'area' },
  'Flurry of Blows': { cd: 4, area: 'area' },
  'Sweeping Takedown': { cd: 8, area: 'area' },
  'Spiritual Outburst': { cd: 24, area: 'chain' },
  'Mystic Repulse': { cd: 20, area: 'single' },
  'Forceful Uppercut': { cd: 60, area: 'single' },
  'Devastating Knockout': { cd: 24, area: 'single' },
  'Double Jab': { cd: 4, area: 'single' },
  'Greater Tiger Clash': { cd: 8, area: 'single' },
  'Thousand Fist Blows': { cd: 4, area: 'area', approx: true },
  // runes (2 s attack-rune group cooldown)
  'Avalanche Rune': { cd: 2, area: 'area' },
  'Great Fireball Rune': { cd: 2, area: 'area' },
  'Thunderstorm Rune': { cd: 2, area: 'area' },
  'Stone Shower Rune': { cd: 2, area: 'area' },
  'Sudden Death Rune': { cd: 2, area: 'single' },
  'Explosion Rune': { cd: 2, area: 'area' },
  'Icicle Rune': { cd: 2, area: 'single' },
  'Fireball Rune': { cd: 2, area: 'single' },
  'Stalagmite Rune': { cd: 2, area: 'single' },
  'Heavy Magic Missile Rune': { cd: 2, area: 'single' },
  'Light Magic Missile Rune': { cd: 2, area: 'single' },
  'Holy Missile Rune': { cd: 2, area: 'single' },
};

/** Healing spells relevant to the wheel (not covered by the API). avg = (min+max)/2 of canary formulas. */
export const HEALING = [
  { name: 'Intense Wound Cleansing', vocations: ['knight'], cd: 600, area: 'single', min: [0.2, 70, 438], max: [0.2, 92, 544] },
  { name: 'Fair Wound Cleansing', vocations: ['knight'], cd: 1, area: 'single', min: [0.4, 8, 50], max: [0.4, 15.9, 102] },
  { name: 'Salvation', vocations: ['paladin'], cd: 1, area: 'single', min: [0.2, 12, 75], max: [0.2, 20, 125] },
  { name: 'Ultimate Healing', vocations: ['sorcerer', 'druid'], cd: 1, area: 'single', min: [0.2, 6.8, 42], max: [0.2, 12.9, 90] },
  { name: 'Mass Healing', vocations: ['druid'], cd: 2, area: 'area', min: [0.2, 5.7, 26], max: [0.2, 10.43, 62] },
  { name: 'Heal Friend', vocations: ['druid'], cd: 1, area: 'single', min: [0.2, 10, 3], max: [0.2, 14, 5] },
  { name: "Nature's Embrace", vocations: ['druid'], cd: 60, area: 'single', min: [0.4, 20, 0], max: [0.4, 28, 0] },
  { name: 'Spirit Mend', vocations: ['monk'], cd: 1, area: 'single', min: [0.2, 7.22, 44], max: [0.2, 12.79, 79] },
  { name: 'Mass Spirit Mend', vocations: ['monk'], cd: 8, area: 'area', min: [0.2, 5.7, 26], max: [0.2, 10.43, 62], note: 'Scaled by Harmony in game.' },
];
