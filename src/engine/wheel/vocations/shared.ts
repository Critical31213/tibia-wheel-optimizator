import type { RevelationDef } from '../perks';

export const GIFT_OF_LIFE: RevelationDef = {
  name: 'Gift of Life',
  description:
    'When receiving lethal damage, the hit is negated and hit points are partially restored (long cooldown).',
  category: 'defense',
  def: 14,
};

export function avatar(name: string): RevelationDef {
  return {
    name: `Avatar of ${name}`,
    description: 'Avatar spell: damage reduction and guaranteed critical hits for a short time.',
    category: 'offense',
    off: 9,
    def: 9,
  };
}
