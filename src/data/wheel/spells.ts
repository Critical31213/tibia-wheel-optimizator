/**
 * Metadata of every spell referenced by wheel augments, revelations and supreme mods.
 * avgHitsHunt: tibiapal.com "spell average hits" (real hunting data).
 * isNew: introduced by the 2026 "Vocation Adjustments" update (tibia.com news, June 2026).
 * Entries marked `approximate` contain estimated values (mostly maxTargets / monk elements).
 */
import type { SpellMeta } from './types';

type S = Omit<SpellMeta, 'isNew' | 'isAvatar'> & Partial<Pick<SpellMeta, 'isNew' | 'isAvatar'>>;

const avatar = (name: string, vocation: SpellMeta['vocations'][number]): S => ({
  name, vocations: [vocation], element: null, kind: 'support', area: 'single', maxTargets: 1, isAvatar: true,
  note: 'Avatar: 15 s of damage reduction and guaranteed critical hits; valued in boss mode only.',
});

const LIST: S[] = [
  // Knight
  { name: 'Shield Slam', vocations: ['knight'], element: 'physical', kind: 'damage', area: 'area', maxTargets: 8, isNew: true, approximate: true, note: 'Hits all adjacent enemies; requires a shield.' },
  { name: 'Front Sweep', vocations: ['knight'], element: 'physical', kind: 'damage', area: 'area', avgHitsHunt: 4.0, maxTargets: 5, approximate: true, note: 'Frontal arc; augment II expands the shape.' },
  { name: 'Fierce Berserk', vocations: ['knight'], element: 'physical', kind: 'damage', area: 'area', avgHitsHunt: 6.0, maxTargets: 8 },
  { name: 'Berserk', vocations: ['knight'], element: 'physical', kind: 'damage', area: 'area', avgHitsHunt: 6.3, maxTargets: 8 },
  { name: 'Groundshaker', vocations: ['knight'], element: 'physical', kind: 'damage', area: 'area', avgHitsHunt: 6.3, maxTargets: 20, approximate: true },
  { name: 'Annihilation', vocations: ['knight'], element: 'physical', kind: 'damage', area: 'single', avgHitsHunt: 1.0, maxTargets: 1 },
  { name: "Executioner's Throw", vocations: ['knight'], element: 'physical', kind: 'damage', area: 'chain', avgHitsHunt: 3.2, maxTargets: 5, note: 'Jumps to 2/3/4 nearby enemies by revelation stage.' },
  { name: 'Intense Wound Cleansing', vocations: ['knight'], element: 'healing', kind: 'healing', area: 'single', maxTargets: 1 },
  { name: 'Fair Wound Cleansing', vocations: ['knight'], element: 'healing', kind: 'healing', area: 'single', maxTargets: 1 },
  avatar('Avatar of Steel', 'knight'),
  // Paladin
  { name: 'Divine Barrage', vocations: ['paladin'], element: 'holy', kind: 'damage', area: 'area', avgHitsHunt: 6.5, maxTargets: 13, isNew: true, approximate: true, note: 'Hits the target and the area around it.' },
  { name: 'Ethereal Barrage', vocations: ['paladin'], element: 'physical', kind: 'damage', area: 'area', avgHitsHunt: 6.5, maxTargets: 13, isNew: true, approximate: true, note: 'Hits the target and the area around it.' },
  { name: 'Divine Caldera', vocations: ['paladin'], element: 'holy', kind: 'damage', area: 'area', avgHitsHunt: 7.3, maxTargets: 21, approximate: true },
  { name: 'Divine Grenade', vocations: ['paladin'], element: 'holy', kind: 'damage', area: 'area', avgHitsHunt: 7.5, maxTargets: 13, approximate: true },
  { name: 'Divine Missile', vocations: ['paladin'], element: 'holy', kind: 'damage', area: 'single', avgHitsHunt: 1.0, maxTargets: 1 },
  { name: 'Ethereal Spear', vocations: ['paladin'], element: 'physical', kind: 'damage', area: 'single', maxTargets: 1 },
  { name: 'Strong Ethereal Spear', vocations: ['paladin'], element: 'physical', kind: 'damage', area: 'single', avgHitsHunt: 1.0, maxTargets: 1 },
  { name: 'Divine Dazzle', vocations: ['paladin'], element: null, kind: 'support', area: 'chain', maxTargets: 5, approximate: true, note: 'Challenges/dazzles targets; augment I adds 2 jumps.' },
  { name: 'Divine Empowerment', vocations: ['paladin'], element: null, kind: 'support', area: 'single', maxTargets: 1, note: 'Damage-increasing field.' },
  { name: 'Salvation', vocations: ['paladin'], element: 'healing', kind: 'healing', area: 'single', maxTargets: 1 },
  avatar('Avatar of Light', 'paladin'),
  // Sorcerer
  { name: 'Lightning', vocations: ['sorcerer'], element: 'energy', kind: 'damage', area: 'single', maxTargets: 1 },
  { name: 'Strong Energy Strike', vocations: ['sorcerer'], element: 'energy', kind: 'damage', area: 'single', maxTargets: 1 },
  { name: 'Strong Flame Strike', vocations: ['sorcerer'], element: 'fire', kind: 'damage', area: 'single', maxTargets: 1 },
  { name: "Hell's Core", vocations: ['sorcerer'], element: 'fire', kind: 'damage', area: 'area', avgHitsHunt: 13.7, maxTargets: 37, approximate: true },
  { name: 'Rage of the Skies', vocations: ['sorcerer'], element: 'energy', kind: 'damage', area: 'area', avgHitsHunt: 15.5, maxTargets: 37, approximate: true },
  { name: 'Energy Wave', vocations: ['sorcerer'], element: 'energy', kind: 'damage', area: 'area', avgHitsHunt: 6.4, maxTargets: 17, approximate: true },
  { name: 'Great Fire Wave', vocations: ['sorcerer'], element: 'fire', kind: 'damage', area: 'area', avgHitsHunt: 6.3, maxTargets: 17, approximate: true },
  { name: 'Death Echo', vocations: ['sorcerer'], element: 'death', kind: 'damage', area: 'area', avgHitsHunt: 5.9, maxTargets: 25, isNew: true, note: '5x5 area; hits again after 1 s for 50% damage.' },
  { name: 'Great Death Beam', vocations: ['sorcerer'], element: 'death', kind: 'damage', area: 'beam', avgHitsHunt: 2.4, avgHitsHuntOuter: 3.7, maxTargets: 7, approximate: true },
  { name: 'Great Energy Beam', vocations: ['sorcerer'], element: 'energy', kind: 'damage', area: 'beam', avgHitsHunt: 2.4, avgHitsHuntOuter: 3.7, maxTargets: 7, approximate: true },
  { name: 'Ultimate Healing', vocations: ['sorcerer', 'druid'], element: 'healing', kind: 'healing', area: 'single', maxTargets: 1 },
  avatar('Avatar of Storm', 'sorcerer'),
  // Druid
  { name: 'Forked Thorns', vocations: ['druid'], element: 'earth', kind: 'damage', area: 'chain', avgHitsHunt: 6.7, maxTargets: 7, isNew: true, note: 'Target + up to 5 nearby targets (+1 with Augmented Forked Spells II).' },
  { name: 'Forked Glacier', vocations: ['druid'], element: 'ice', kind: 'damage', area: 'chain', avgHitsHunt: 7.5, maxTargets: 8, isNew: true, note: 'Target + up to 6 nearby targets (+1 with Augmented Forked Spells II).' },
  { name: 'Terra Wave', vocations: ['druid'], element: 'earth', kind: 'damage', area: 'area', avgHitsHunt: 5.8, maxTargets: 17, approximate: true },
  { name: 'Strong Ice Wave', vocations: ['druid'], element: 'ice', kind: 'damage', area: 'area', avgHitsHunt: 5.3, maxTargets: 13, approximate: true },
  { name: 'Ice Burst', vocations: ['druid'], element: 'ice', kind: 'damage', area: 'area', avgHitsHunt: 9.5, maxTargets: 21, approximate: true, note: 'Twin Bursts revelation; shares cooldown with Terra Burst.' },
  { name: 'Terra Burst', vocations: ['druid'], element: 'earth', kind: 'damage', area: 'area', avgHitsHunt: 9.5, maxTargets: 21, approximate: true, note: 'Twin Bursts revelation; shares cooldown with Ice Burst.' },
  { name: 'Eternal Winter', vocations: ['druid'], element: 'ice', kind: 'damage', area: 'area', avgHitsHunt: 13.7, maxTargets: 37, approximate: true },
  { name: 'Mass Healing', vocations: ['druid'], element: 'healing', kind: 'healing', area: 'area', maxTargets: 20, approximate: true },
  { name: 'Heal Friend', vocations: ['druid'], element: 'healing', kind: 'healing', area: 'single', maxTargets: 1 },
  { name: "Nature's Embrace", vocations: ['druid'], element: 'healing', kind: 'healing', area: 'single', maxTargets: 1 },
  avatar('Avatar of Nature', 'druid'),
  // Monk (spell elements not verified: assumed physical)
  { name: 'Chained Penance', vocations: ['monk'], element: 'physical', kind: 'damage', area: 'chain', avgHitsHunt: 5.0, maxTargets: 5, approximate: true },
  { name: 'Flurry of Blows', vocations: ['monk'], element: 'physical', kind: 'damage', area: 'area', avgHitsHunt: 4.3, maxTargets: 9, approximate: true },
  { name: 'Greater Flurry of Blows', vocations: ['monk'], element: 'physical', kind: 'damage', area: 'area', avgHitsHunt: 5.8, maxTargets: 13, approximate: true },
  { name: 'Thousand Fist Blows', vocations: ['monk'], element: 'physical', kind: 'damage', area: 'area', avgHitsHunt: 7.1, maxTargets: 13, isNew: true, approximate: true, note: 'Hits the target and the area around it.' },
  { name: 'Sweeping Takedown', vocations: ['monk'], element: 'physical', kind: 'damage', area: 'area', avgHitsHunt: 6.4, maxTargets: 12, approximate: true, note: '3x2 box plus a following 3x2 box at 75%.' },
  { name: 'Mystic Repulse', vocations: ['monk'], element: 'physical', kind: 'damage', area: 'single', avgHitsHunt: 1.0, maxTargets: 1, approximate: true },
  { name: 'Forceful Uppercut', vocations: ['monk'], element: 'physical', kind: 'damage', area: 'single', avgHitsHunt: 1.0, maxTargets: 1, approximate: true },
  { name: 'Spiritual Outburst', vocations: ['monk'], element: 'physical', kind: 'damage', area: 'chain', avgHitsHunt: 5.9, maxTargets: 8, approximate: true, note: 'Chains to 7 additional enemies; consumes Harmony.' },
  { name: 'Spirit Mend', vocations: ['monk'], element: 'healing', kind: 'healing', area: 'single', maxTargets: 1 },
  { name: 'Mass Spirit Mend', vocations: ['monk'], element: 'healing', kind: 'healing', area: 'area', maxTargets: 10, approximate: true },
  { name: 'Focus Serenity', vocations: ['monk'], element: null, kind: 'support', area: 'single', maxTargets: 1 },
  { name: 'Focus Harmony', vocations: ['monk'], element: null, kind: 'support', area: 'single', maxTargets: 1 },
  avatar('Avatar of Balance', 'monk'),
];

export const SPELLS: readonly SpellMeta[] = LIST.map((s) => ({ isNew: false, isAvatar: false, ...s }));
