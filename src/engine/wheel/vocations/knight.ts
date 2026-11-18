import { avatar, GIFT_OF_LIFE } from './shared';
import type { VocationSpec } from './types';

export const knight: VocationSpec = {
  vocation: 'knight',
  hpPerPoint: 3,
  manaPerPoint: 1,
  capacityPerPoint: 5,
  skillName: 'Melee skill',
  skillValue: 2,
  spells: {
    A: { name: 'Fierce Berserk', kind: 'damage', off: 4.5, elements: ['physical'] },
    B: { name: 'Front Sweep', kind: 'damage', off: 3.5, elements: ['physical'] },
    C: { name: 'Groundshaker', kind: 'damage', off: 4, elements: ['physical'] },
    D: { name: 'Intense Wound Cleansing', kind: 'heal', def: 3.5 },
    E: { name: 'Chivalrous Challenge', kind: 'support', def: 1, util: 2 },
  },
  passiveGreen: {
    name: 'Battle Instinct',
    description: 'Bonus shielding and melee skill when surrounded by several monsters.',
    category: 'defense',
    off: 1.5,
    def: 4,
  },
  passivePurple: {
    name: 'Battle Healing',
    description: 'Heals the knight automatically when hit points fall low.',
    category: 'defense',
    def: 5,
  },
  revelations: {
    green: GIFT_OF_LIFE,
    red: {
      name: "Executioner's Throw",
      description: "Unlocks Executioner's Throw, a strong physical attack with bonus damage on low-health targets.",
      category: 'offense',
      off: 12,
      offElements: ['physical'],
    },
    purple: avatar('Steel'),
    blue: {
      name: 'Combat Mastery',
      description: 'Shield users gain defense; two-handed weapon users gain critical extra damage.',
      category: 'defense',
      off: 5,
      def: 6,
    },
  },
};
