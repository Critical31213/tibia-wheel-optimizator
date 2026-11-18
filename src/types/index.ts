/**
 * Shared type contract between the Data, Engine and UI modules.
 *
 * This file is the single source of truth for cross-module types.
 * Changes here must be recorded in WORKLOG.md and ARCHITECTURE.md,
 * because all three modules depend on it.
 */

// ---------------------------------------------------------------------------
// Vocations
// ---------------------------------------------------------------------------

export type Vocation = 'knight' | 'paladin' | 'sorcerer' | 'druid' | 'monk';

export const VOCATIONS: readonly Vocation[] = [
  'knight',
  'paladin',
  'sorcerer',
  'druid',
  'monk',
] as const;

// ---------------------------------------------------------------------------
// Elements / damage types
// ---------------------------------------------------------------------------

export type Element =
  | 'physical'
  | 'fire'
  | 'earth'
  | 'energy'
  | 'ice'
  | 'holy'
  | 'death'
  | 'lifeDrain'
  | 'manaDrain'
  | 'drown'
  | 'healing';

/** Elements that players can actually deal as damage (used for offense). */
export const ATTACK_ELEMENTS: readonly Element[] = [
  'physical',
  'fire',
  'earth',
  'energy',
  'ice',
  'holy',
  'death',
] as const;

// ---------------------------------------------------------------------------
// Monsters (owned by the Data module: src/data)
// ---------------------------------------------------------------------------

export interface Monster {
  /** Stable slug, e.g. "dragon-lord". */
  id: string;
  /** Display name, e.g. "Dragon Lord". */
  name: string;
  hitpoints?: number;
  experience?: number;
  /**
   * Percentage of damage the monster TAKES from each element.
   * 100 = neutral, 0 = immune, >100 = weakness, <100 = resistance.
   * Missing keys are treated as 100.
   */
  elementModifiers: Partial<Record<Element, number>>;
  /** Damage types the monster DEALS to the player. */
  damageTypes: Element[];
  /** Estimated max damage per turn, if known. */
  maxDamage?: number;
  imageUrl?: string;
  /** Page the data was taken from (tibiopedia.pl). */
  sourceUrl?: string;
}

// ---------------------------------------------------------------------------
// Wheel of Destiny model (owned by the Engine module: src/engine)
// ---------------------------------------------------------------------------

/** The four quadrants of the wheel. */
export type Domain = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

export type SliceId = string;

export type PerkCategory = 'offense' | 'defense' | 'utility';

export interface Perk {
  id: string;
  name: string;
  description: string;
  category: PerkCategory;
}

export interface Slice {
  id: SliceId;
  domain: Domain;
  /** 1 = innermost ring, increasing outward. */
  ring: number;
  /**
   * Position of the slice within its ring, counted clockwise starting
   * from 12 o'clock. Used by the UI to compute geometry.
   */
  indexInRing: number;
  /** Number of slices in this ring (for angle calculation in the UI). */
  slicesInRing: number;
  /** Maximum promotion points this slice can hold. */
  capacity: number;
  /** Slices that physically border this one (both directions). */
  adjacent: SliceId[];
  /** Conviction perk granted when the slice is completely filled. */
  conviction: Perk;
  /** Short label for the dedication bonus (granted per point invested). */
  dedicationLabel: string;
}

export interface RevelationPerk extends Perk {
  domain: Domain;
  /** Domain-point thresholds for stage 1/2/3. */
  thresholds: number[];
}

export interface WheelDefinition {
  vocation: Vocation;
  slices: Slice[];
  revelations: RevelationPerk[];
  /** Total capacity of the whole wheel. */
  totalCapacity: number;
}

// ---------------------------------------------------------------------------
// Optimizer I/O
// ---------------------------------------------------------------------------

export interface OptimizerInput {
  vocation: Vocation;
  /** Available promotion points. */
  points: number;
  /** Selected monster, or null for a generic build. */
  monster: Monster | null;
  /** 0 = maximum DPS, 100 = maximum survivability. */
  priority: number;
}

export interface StatLine {
  label: string;
  value: string;
  category: PerkCategory;
}

export interface ActivatedRevelation {
  perk: RevelationPerk;
  /** 0 = not active, 1..3 = stage reached. */
  stage: number;
  domainPoints: number;
}

export interface OptimizerResult {
  /** Points invested per slice (only slices with > 0 points). */
  allocation: Record<SliceId, number>;
  /** Order in which slices should be filled in-game. */
  path: SliceId[];
  pointsUsed: number;
  pointsTotal: number;
  /** Points spent per domain. */
  domainPoints: Record<Domain, number>;
  revelations: ActivatedRevelation[];
  /** Conviction perks unlocked by completely filled slices. */
  convictions: Perk[];
  /** Human-readable summary of resulting stats. */
  stats: StatLine[];
  offenseScore: number;
  defenseScore: number;
  /** Short explanations of why the engine chose this build. */
  rationale: string[];
}
