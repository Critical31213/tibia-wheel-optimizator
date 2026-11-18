import { avatar, GIFT_OF_LIFE } from './shared';
import type { VocationSpec } from './types';

export const sorcerer: VocationSpec = {
  vocation: 'sorcerer',
  hpPerPoint: 1,
  manaPerPoint: 6,
  capacityPerPoint: 2,
  skillName: 'Magic level',
  skillValue: 3,
  spells: {
    A: { name: 'Great Fire Wave', kind: 'damage', off: 4, elements: ['fire'] },
    B: { name: "Hell's Core / Rage of the Skies", kind: 'damage', off: 5, elements: ['fire', 'energy'] },
    C: { name: 'Magic Shield', kind: 'heal', def: 4 },
    D: { name: 'Energy Wave', kind: 'damage', off: 4, elements: ['energy'] },
    E: { name: 'Sap Strength', kind: 'support', def: 2, util: 1.5 },
  },
  passiveGreen: {
    name: 'Runic Mastery',
    description: 'Attack runes deal more damage (chance for increased damage).',
    category: 'offense',
    off: 3,
  },
  passivePurple: {
    name: 'Focus Mastery',
    description: "After casting a focus spell (Hell's Core / Rage of the Skies) the next attack spell deals increased damage.",
    category: 'offense',
    off: 5,
    offElements: ['fire', 'energy'],
  },
  revelations: {
    green: GIFT_OF_LIFE,
    red: {
      name: 'Beam Mastery',
      description: 'Strengthens Great Death Beam (more damage, reduced cooldown).',
      category: 'offense',
      off: 12,
      offElements: ['death'],
    },
    purple: avatar('Storm'),
    blue: {
      name: 'Drain Body',
      description: 'Some attack spells leech extra life and mana.',
      category: 'defense',
      off: 3,
      def: 8,
    },
  },
};
