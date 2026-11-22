/**
 * D93: offensive charms (TibiaWiki, checked 2026-11-22). Each charm can be assigned to one creature; an attack on that
 * creature rolls the charm. Auto attacks with area ammunition roll charms on the main target only (Vocation
 * Adjustments 2026); critical hits from Low Blow / Savage Blow still apply to every target the attack hits.
 */
import type { CharmId, Element } from '../types';

export type CharmStage = 1 | 2 | 3;

export interface CharmDef {
  id: CharmId;
  name: string;
  /**
   * `element`: chance per attack to deal `pct` % of the creature's max HP as `element` damage, capped at `levelCap` ×
   * level before resistances. `player`: chance per attack to deal `pct` % of the player's max HP / mana, neutral,
   * capped at `creatureCap` % of the creature's max HP. `kill`: chance on a kill to deal `pct` % of its max HP as
   * physical damage around it (capped at `levelCap` × level). `crit`: + crit chance / extra damage (pp).
   */
  kind: 'element' | 'player' | 'kill' | 'crit';
  /** Trigger chance (%) or crit bonus (pp) per stage. */
  values: readonly [number, number, number];
  element?: Element;
  pct?: number;
  levelCap?: number;
  creatureCap?: number;
  resource?: 'hp' | 'mana';
  crit?: 'chance' | 'extra';
  /** Charm points per stage (display only). */
  cost: readonly [number, number, number];
}

const ELEMENTAL: readonly [CharmId, string, Element, readonly [number, number, number]][] = [
  ['wound', 'Wound', 'physical', [240, 360, 1200]],
  ['enflame', 'Enflame', 'fire', [400, 600, 2000]],
  ['poison', 'Poison', 'earth', [240, 360, 1200]],
  ['freeze', 'Freeze', 'ice', [320, 480, 1600]],
  ['zap', 'Zap', 'energy', [320, 480, 1600]],
  ['curse', 'Curse', 'death', [360, 540, 1800]],
  ['divineWrath', 'Divine Wrath', 'holy', [600, 900, 3000]],
];

export const CHARMS: readonly CharmDef[] = [
  ...ELEMENTAL.map(([id, name, element, cost]): CharmDef => ({ id, name, kind: 'element', values: [5, 10, 11], element, pct: 5, levelCap: 2, cost })),
  { id: 'overpower', name: 'Overpower', kind: 'player', values: [5, 10, 11], pct: 5, resource: 'hp', creatureCap: 8, cost: [600, 900, 3000] },
  { id: 'overflux', name: 'Overflux', kind: 'player', values: [5, 10, 11], pct: 2.5, resource: 'mana', creatureCap: 8, cost: [600, 900, 3000] },
  { id: 'carnage', name: 'Carnage', kind: 'kill', values: [10, 20, 22], pct: 15, levelCap: 6, cost: [600, 900, 3000] },
  { id: 'lowBlow', name: 'Low Blow', kind: 'crit', values: [4, 8, 9], crit: 'chance', cost: [800, 1200, 4000] },
  { id: 'savageBlow', name: 'Savage Blow', kind: 'crit', values: [20, 40, 44], crit: 'extra', cost: [800, 1200, 4000] },
];

export const CHARM_IDS: readonly CharmId[] = CHARMS.map((c) => c.id);

const byId = new Map(CHARMS.map((c) => [c.id, c]));
export const getCharm = (id: string): CharmDef | undefined => byId.get(id as CharmId);

/** Creatures next to a killed one that Carnage hits while hunting (cross-shaped area, no diagonals). */
export const CARNAGE_NEIGHBOURS = 2;
