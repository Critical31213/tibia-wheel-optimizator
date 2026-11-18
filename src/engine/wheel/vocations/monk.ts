import { avatar, GIFT_OF_LIFE } from './shared';
import type { VocationSpec } from './types';

/** Monk (2025): approximate — slot mapping from canary; values and elements are estimates. */
export const monk: VocationSpec = {
  vocation: 'monk',
  approximate: true,
  hpPerPoint: 2,
  manaPerPoint: 2,
  capacityPerPoint: 5,
  skillName: 'Fist fighting',
  skillValue: 2,
  spells: {
    A: { name: 'Flurry of Blows', kind: 'damage', off: 4.5, elements: ['physical'], approximate: true },
    B: { name: 'Sweeping Takedown', kind: 'damage', off: 4, elements: ['physical'], approximate: true },
    C: { name: 'Mass Spirit Mend', kind: 'heal', def: 3.5, approximate: true },
    D: { name: 'Chained Penance', kind: 'damage', off: 3.5, elements: ['physical'], approximate: true },
    E: { name: 'Mystic Repulse', kind: 'support', def: 1.5, util: 2, approximate: true },
  },
  passiveGreen: {
    name: 'Guiding Presence',
    description: 'Supportive aura that helps nearby party members (approximate).',
    category: 'utility',
    def: 2,
    util: 2,
  },
  passivePurple: {
    name: 'Sanctuary',
    description: 'Defensive passive that reduces incoming damage under pressure (approximate).',
    category: 'defense',
    def: 4,
  },
  revelations: {
    green: GIFT_OF_LIFE,
    red: {
      name: 'Spiritual Outburst',
      description: 'Unlocks Spiritual Outburst, a strong area attack (approximate).',
      category: 'offense',
      off: 12,
      offElements: ['physical'],
    },
    purple: avatar('Balance'),
    blue: {
      name: 'Ascetic',
      description: 'Passive tied to the monk harmony resource, improving damage and sustain (approximate).',
      category: 'offense',
      off: 6,
      def: 4,
    },
  },
};
