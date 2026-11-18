/**
 * Internal perk model with a numeric scoring vector.
 *
 * Value units: 1 unit ≈ +1 % effective damage output (off) or +1 % effective
 * survivability (def). Magnitudes are engine estimates, not game data — see
 * docs/modules/engine.md.
 */
import type { Element, Perk, PerkCategory, RevelationPerk } from '../../types';

export interface PerkValue {
  off: number;
  def: number;
  util: number;
  /** Elements the offense part deals (scaled by monster elementModifiers). */
  offElements?: readonly Element[];
  /** Elements the defense part protects against (scaled by monster damageTypes). */
  defElements?: readonly Element[];
}

/** Raw in-game numbers a perk contributes (for the stats summary). */
export interface PerkStats {
  hp?: number;
  mana?: number;
  capacity?: number;
  mitigation?: number;
  lifeLeech?: number;
  manaLeech?: number;
  skill?: number;
  flatDamage?: number;
  flatHealing?: number;
}

export interface EnginePerk extends Perk {
  value: PerkValue;
  stats?: PerkStats;
  /** Spell name when the perk is a spell augmentation (graded I/II). */
  spell?: string;
  approximate?: boolean;
}

export interface EngineRevelation extends RevelationPerk {
  /** Value per stage (index 0 = stage 1), already including the flat bonus. */
  stageValues: [PerkValue, PerkValue, PerkValue];
  approximate?: boolean;
}

/** Domain-point thresholds for revelation stages 1/2/3 (canary WheelStagePointsEnum_t). */
export const REVELATION_THRESHOLDS: readonly number[] = [250, 500, 1000];

/** Flat +damage and +healing granted by each revelation stage (canary io_wheel.hpp). */
export const REVELATION_FLAT_BONUS: readonly number[] = [0, 4, 9, 20];

/** Value units per point of flat damage/healing from revelation stages. */
const FLAT_VALUE = 0.25;

export const ZERO: PerkValue = { off: 0, def: 0, util: 0 };

/** Definition of a spell augmentation as written in the per-vocation files. */
export interface SpellDef {
  name: string;
  kind: 'damage' | 'heal' | 'support';
  off?: number;
  def?: number;
  util?: number;
  elements?: Element[];
  approximate?: boolean;
}

export interface PassiveDef {
  name: string;
  description: string;
  category: PerkCategory;
  off?: number;
  def?: number;
  util?: number;
  offElements?: Element[];
  defElements?: Element[];
}

export interface RevelationDef extends PassiveDef {
  /** Stage-3 value (stages 1/2 scale by REVELATION_STAGE_SCALE). */
  approximate?: boolean;
}

const REVELATION_STAGE_SCALE = [0.35, 0.6, 1] as const;

export function spellPerk(id: string, s: SpellDef): EnginePerk {
  const category: PerkCategory = s.kind === 'damage' ? 'offense' : s.kind === 'heal' ? 'defense' : 'utility';
  const effect =
    s.kind === 'damage'
      ? `+damage${s.elements?.length ? ` (${s.elements.join('/')})` : ''}`
      : s.kind === 'heal'
        ? '+healing'
        : '-cooldown / stronger effect';
  return {
    id,
    name: `${s.name} augment`,
    description: `Spell augmentation for ${s.name}: ${effect}. First filled slice grants grade I, second grants grade II.`,
    category,
    spell: s.name,
    approximate: s.approximate,
    value: { off: s.off ?? 0, def: s.def ?? 0, util: s.util ?? 0, offElements: s.elements },
  };
}

export function passivePerk(id: string, p: PassiveDef, approximate = true): EnginePerk {
  return {
    id,
    name: p.name,
    description: p.description,
    category: p.category,
    approximate,
    value: {
      off: p.off ?? 0,
      def: p.def ?? 0,
      util: p.util ?? 0,
      offElements: p.offElements,
      defElements: p.defElements,
    },
  };
}

export function skillPerk(id: string, skillName: string, off: number): EnginePerk {
  return {
    id,
    name: `${skillName} +1`,
    description: `+1 ${skillName}.`,
    category: 'offense',
    value: { off, def: 0, util: 0 },
    stats: { skill: 1 },
  };
}

export function lifeLeechPerk(id: string): EnginePerk {
  return {
    id,
    name: 'Life Leech +0.75%',
    description: '+0.75% life leech.',
    category: 'defense',
    value: { off: 0, def: 2.5, util: 0 },
    stats: { lifeLeech: 0.75 },
  };
}

export function manaLeechPerk(id: string): EnginePerk {
  return {
    id,
    name: 'Mana Leech +0.25%',
    description: '+0.25% mana leech.',
    category: 'utility',
    value: { off: 1, def: 1, util: 0.5 },
    stats: { manaLeech: 0.25 },
  };
}

/** Vessel Resonance: activates one modifier of the gem socketed in this domain. */
export function vesselPerk(id: string, domainLabel: string): EnginePerk {
  return {
    id,
    name: `Vessel Resonance (${domainLabel})`,
    description: `Activates one more modifier of the gem socketed in the ${domainLabel} vessel (gem mods include elemental resistances, damage and healing).`,
    category: 'utility',
    approximate: true,
    value: {
      off: 1,
      def: 1,
      util: 2,
      defElements: ['fire', 'earth', 'energy', 'ice', 'holy', 'death'],
    },
  };
}

export function revelationPerk(
  id: string,
  domain: RevelationPerk['domain'],
  r: RevelationDef,
): EngineRevelation {
  const stageValues = REVELATION_STAGE_SCALE.map((m, i) => {
    const flat = REVELATION_FLAT_BONUS[i + 1] * FLAT_VALUE;
    return {
      off: (r.off ?? 0) * m + flat,
      def: (r.def ?? 0) * m + flat,
      util: (r.util ?? 0) * m,
      offElements: r.offElements,
      defElements: r.defElements,
    };
  }) as [PerkValue, PerkValue, PerkValue];
  return {
    id,
    name: r.name,
    description: `${r.description} Each stage also adds flat +damage/+healing (4/9/20).`,
    category: r.category,
    domain,
    thresholds: [...REVELATION_THRESHOLDS],
    stageValues,
    approximate: r.approximate ?? true,
  };
}
