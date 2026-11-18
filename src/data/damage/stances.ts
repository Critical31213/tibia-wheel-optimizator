import type { Element, Vocation } from '../../types';

/**
 * Stances (Vocation Adjustments 2026, TibiaWiki, patch 7 July 2026). One stance at a time;
 * sorcerers: one 'element' + one 'aura'. Values in %.
 */
export interface StanceDef {
  name: string;
  vocation: Vocation;
  group: 'main' | 'element' | 'aura';
  /** Main skill (melee / distance / fist) +%; total skill. */
  skillPct?: number;
  shieldingPct?: number;
  /** All damage you deal. */
  damageDonePct?: number;
  /** Damage you take (Sapped Strength: damage of affected monsters). */
  damageTakenPct?: number;
  /** Extra magic level for some elements: `pct` % of the main skill or magic level. */
  elementMagicLevel?: { pct: number; of: 'skill' | 'magicLevel'; elements: Element[] };
  /** Dodge vs non-adjacent enemies. */
  dodgeNonAdjacentPct?: number;
  /** Self-healing (`all`: all healing of the vocation's spells incl. party heals). */
  healingPct?: number;
  healingAll?: boolean;
  /** Sorcerer elemental stance: natural spells of the element; casts convert the next other-element spell. */
  element?: { element: Element; baseDamagePct?: number; critChancePct?: number; critExtraPct?: number };
  /** Elemental pierce applied to targets. */
  piercePct?: number;
  /** Monk: Harmony base bonus +percentage points. */
  harmonyBasePct?: number;
  /** Monk virtues: effect doubled while serene. */
  serene?: boolean;
  /** No solo value (party healing only). */
  partyOnly?: boolean;
}

/** Share of time a monk is serene (user, D24). */
export const SERENE_UPTIME = 0.8;
/** Share of incoming damage from non-adjacent enemies (user, D24). */
export const NON_ADJACENT_SHARE = 0.3;

export const STANCES: readonly StanceDef[] = [
  { name: 'Blood Rage', vocation: 'knight', group: 'main', skillPct: 25, damageTakenPct: 15 },
  { name: 'Protector', vocation: 'knight', group: 'main', shieldingPct: 30, damageTakenPct: -15, damageDonePct: -15 },

  { name: 'Sharpshooter', vocation: 'paladin', group: 'main', skillPct: 32 },
  { name: 'Divine Defiance', vocation: 'paladin', group: 'main', elementMagicLevel: { pct: 6, of: 'skill', elements: ['holy', 'healing'] }, dodgeNonAdjacentPct: 12 },

  { name: 'Master of Flames', vocation: 'sorcerer', group: 'element', element: { element: 'fire', baseDamagePct: 4 } },
  { name: 'Master of Thunder', vocation: 'sorcerer', group: 'element', element: { element: 'energy', critChancePct: 4 } },
  { name: 'Master of Decay', vocation: 'sorcerer', group: 'element', element: { element: 'death', critExtraPct: 30 } },
  { name: 'Aura of Exposed Weakness', vocation: 'sorcerer', group: 'aura', piercePct: 8 },
  { name: 'Aura of Sapped Strength', vocation: 'sorcerer', group: 'aura', damageTakenPct: -10 },

  { name: 'Elemental Synthesis', vocation: 'druid', group: 'main', elementMagicLevel: { pct: 10, of: 'magicLevel', elements: ['ice', 'earth'] } },
  { name: 'Shared Conservation', vocation: 'druid', group: 'main', healingPct: 10 },
  { name: 'Rejuvenation', vocation: 'druid', group: 'main', healingPct: 10 },
  { name: 'Channeled Preservation', vocation: 'druid', group: 'main', partyOnly: true },

  { name: 'Virtue of Justice', vocation: 'monk', group: 'main', skillPct: 8, serene: true },
  { name: 'Virtue of Harmony', vocation: 'monk', group: 'main', harmonyBasePct: 3, serene: true },
  { name: 'Virtue of Sustain', vocation: 'monk', group: 'main', healingPct: 35, healingAll: true, serene: true },
];

export function getStances(vocation: Vocation): StanceDef[] {
  return STANCES.filter((s) => s.vocation === vocation);
}

export function getStance(name: string): StanceDef | undefined {
  return STANCES.find((s) => s.name === name);
}

/** Effect multiplier of a virtue: doubled while serene (SERENE_UPTIME). */
export function sereneFactor(s: StanceDef): number {
  return s.serene ? 1 + SERENE_UPTIME : 1;
}

/** Valid stance sets: one 'main' stance, or (sorcerer) up to one 'element' + one 'aura'; [] = none. */
export function stanceCombos(vocation: Vocation): StanceDef[][] {
  const all = getStances(vocation).filter((s) => !s.partyOnly);
  const main = all.filter((s) => s.group === 'main');
  if (main.length) return [[], ...main.map((s) => [s])];
  const el = [null, ...all.filter((s) => s.group === 'element')];
  const au = [null, ...all.filter((s) => s.group === 'aura')];
  return el.flatMap((e) => au.map((a) => [e, a].filter((x): x is StanceDef => !!x)));
}
