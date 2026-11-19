/**
 * D51: ammunition the engine picks from for bows and crossbows (tibiopedia.pl arrow / bolt tables).
 * Diamond Arrow hits a 5x5 area; the storm arrows deal all their damage in their element (no area listed).
 */
import type { Element } from '../../types';
import type { Weapon } from './types';

export interface Ammo {
  id: string;
  name: string;
  type: 'arrow' | 'bolt';
  attack: number;
  element: Element;
  area: boolean;
  minLevel: number;
}

export const AMMO: readonly Ammo[] = [
  { id: 'diamond-arrow', name: 'Diamond Arrow', type: 'arrow', attack: 37, element: 'physical', area: true, minLevel: 150 },
  { id: 'firestorm-arrow', name: 'Firestorm Arrow', type: 'arrow', attack: 21, element: 'fire', area: false, minLevel: 125 },
  { id: 'froststorm-arrow', name: 'Froststorm Arrow', type: 'arrow', attack: 21, element: 'ice', area: false, minLevel: 125 },
  { id: 'terrastorm-arrow', name: 'Terrastorm Arrow', type: 'arrow', attack: 21, element: 'earth', area: false, minLevel: 125 },
  { id: 'thunderstorm-arrow', name: 'Thunderstorm Arrow', type: 'arrow', attack: 21, element: 'energy', area: false, minLevel: 125 },
  { id: 'spectral-bolt', name: 'Spectral Bolt', type: 'bolt', attack: 78, element: 'physical', area: false, minLevel: 150 },
];

const AMMO_TYPE: Partial<Record<Weapon['type'], Ammo['type']>> = { bow: 'arrow', crossbow: 'bolt' };

/** Ammunition a weapon can fire at a character level (empty for other weapons). */
export const ammoFor = (w: Weapon, level: number): Ammo[] => AMMO.filter((a) => a.type === AMMO_TYPE[w.type] && a.minLevel <= level);

export const getAmmo = (id: string): Ammo | undefined => AMMO.find((a) => a.id === id);
