import { avatar, GIFT_OF_LIFE } from './shared';
import type { VocationSpec } from './types';

export const paladin: VocationSpec = {
  vocation: 'paladin',
  hpPerPoint: 2,
  manaPerPoint: 3,
  capacityPerPoint: 4,
  skillName: 'Distance fighting',
  skillValue: 2,
  spells: {
    A: { name: 'Divine Caldera', kind: 'damage', off: 4.5, elements: ['holy'] },
    B: { name: 'Sharpshooter', kind: 'damage', off: 3 },
    C: { name: 'Strong Ethereal Spear', kind: 'damage', off: 4, elements: ['physical'] },
    D: { name: 'Swift Foot', kind: 'support', def: 1.5, util: 2 },
    E: { name: 'Divine Dazzle', kind: 'support', def: 1, util: 2 },
  },
  passiveGreen: {
    name: 'Positional Tactics',
    description: 'Bonus damage when no monster is adjacent, bonus defense when one is.',
    category: 'offense',
    off: 2.5,
    def: 2,
  },
  passivePurple: {
    name: 'Ballistic Mastery',
    description: 'Ammunition gains critical extra damage / armor penetration.',
    category: 'offense',
    off: 5,
  },
  revelations: {
    green: GIFT_OF_LIFE,
    red: {
      name: 'Divine Grenade',
      description: 'Unlocks Divine Grenade, a delayed holy area explosion.',
      category: 'offense',
      off: 12,
      offElements: ['holy'],
    },
    purple: avatar('Light'),
    blue: {
      name: 'Divine Empowerment',
      description: 'Unlocks Divine Empowerment: a holy field that increases damage dealt while standing in it.',
      category: 'offense',
      off: 9,
    },
  },
};
