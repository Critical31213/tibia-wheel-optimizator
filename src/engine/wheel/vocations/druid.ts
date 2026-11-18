import { avatar, GIFT_OF_LIFE } from './shared';
import type { VocationSpec } from './types';

export const druid: VocationSpec = {
  vocation: 'druid',
  hpPerPoint: 1,
  manaPerPoint: 6,
  capacityPerPoint: 2,
  skillName: 'Magic level',
  skillValue: 3,
  spells: {
    A: { name: 'Heal Friend', kind: 'heal', def: 2.5, util: 1 },
    B: { name: 'Strong Ice Wave', kind: 'damage', off: 4.5, elements: ['ice'] },
    C: { name: 'Mass Healing', kind: 'heal', def: 3.5 },
    D: { name: 'Terra Wave', kind: 'damage', off: 4, elements: ['earth'] },
    E: { name: "Nature's Embrace", kind: 'heal', def: 3 },
  },
  passiveGreen: {
    name: 'Healing Link',
    description: 'Healing a friend also heals the druid for part of the amount.',
    category: 'defense',
    def: 3,
    util: 1,
  },
  passivePurple: {
    name: 'Runic Mastery',
    description: 'Attack runes deal more damage (chance for increased damage).',
    category: 'offense',
    off: 3,
  },
  revelations: {
    green: GIFT_OF_LIFE,
    red: {
      name: 'Blessing of the Grove',
      description: "Healing spells heal more the lower the target's hit points are.",
      category: 'defense',
      def: 10,
    },
    purple: avatar('Nature'),
    blue: {
      name: 'Twin Burst',
      description: 'Unlocks Terra Burst and Ice Burst, strong earth/ice area spells sharing a cooldown.',
      category: 'offense',
      off: 12,
      offElements: ['earth', 'ice'],
    },
  },
};
