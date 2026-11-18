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
  /** Gem vessels (8), unlocked one by one by filling Gem Vessel slices. */
  vessels: VesselDefinition[];
  /** Gem mods available to this vocation. */
  mods: ModDefinition[];
}

// ---------------------------------------------------------------------------
// Fight context
// ---------------------------------------------------------------------------

/** 'boss' = single target; only here Avatar spells are valued. */
export type FightMode = 'hunt' | 'boss';

/** @deprecated Ignored since D20 (hunt targets = tibiapal averages); kept for old URLs. */
export type HuntStyle = 'solo' | 'teamLure' | 'teamBox';

export interface FightContext {
  mode: FightMode;
  /** @deprecated Ignored (D20). */
  huntStyle?: HuntStyle;
}

// ---------------------------------------------------------------------------
// Rotations (D20)

export interface RotationSpell {
  name: string;
  /** Relative number of casts. */
  ratio: number;
  /** Element alternatives; the engine uses the best one vs the spot. */
  or?: string[];
}

export interface RotationPreset {
  id: string;
  vocation: Vocation;
  name: string;
  /** Short hint when the rotation is used (English). */
  note?: string;
  /** Only valid when the build reaches this revelation / the player wears a shield. */
  requires?: { revelation?: string; shield?: boolean };
  spells: RotationSpell[];
}

/** `RotationUsage.presetId` of the engine's greedy boss plan (no preset). */
export const GREEDY_ROTATION_ID = 'boss';

export interface RotationUsage {
  presetId: string;
  /** True when the engine picked it (no manual choice). */
  auto: boolean;
  /** Spells actually cast incl. revelation-unlocked ones and resolved element alternatives; share in %. */
  spells: { name: string; ratio: number; share: number; fromRevelation?: boolean }[];
}

// ---------------------------------------------------------------------------
// Gems
// ---------------------------------------------------------------------------

/** Lesser = 1 basic mod, regular = 2 basic mods, greater = 2 basic + 1 supreme. */
export type GemQuality = 'lesser' | 'regular' | 'greater';

/** Mod grade I–IV. */
export type ModGrade = 1 | 2 | 3 | 4;

export type ModKind = 'basic' | 'supreme';

export interface ModDefinition {
  /** Id within its kind (basic and supreme ids overlap). */
  id: number;
  kind: ModKind;
  name: string;
  category: PerkCategory;
  /** Display value per grade, index 0 = grade I. */
  gradeValues: string[];
  /** Basic mods only: which basic slot(s) may hold it. */
  slots?: (1 | 2)[];
  /** Supreme mods: spell or revelation it augments, if any. */
  target?: string;
}

export interface GemModRef {
  modId: number;
  grade: ModGrade;
}

export interface OwnedGem {
  id: string;
  quality: GemQuality;
  basic1: GemModRef | null;
  basic2: GemModRef | null;
  supreme: GemModRef | null;
}

export interface VesselDefinition {
  id: number;
  /** Highest gem quality whose mods are all active in this vessel. */
  quality: GemQuality;
  /** Number of filled Gem Vessel slices required to unlock it (1..8). */
  unlockOrder: number;
}

export interface VesselAssignment {
  vesselId: number;
  quality: GemQuality;
  unlocked: boolean;
  gem: OwnedGem | null;
  source: 'owned' | 'recommended' | 'empty';
}

export interface GemRecommendation {
  quality: GemQuality;
  mods: { kind: ModKind; modId: number; name: string; grade: ModGrade }[];
  /** Relative score gain (same units as offense/defense scores). */
  gain: number;
  reason: string;
  reasonMsg?: EngineMessage;
}

export interface UpgradeRecommendation {
  gemId: string;
  slot: 'basic1' | 'basic2' | 'supreme';
  modId: number;
  name: string;
  fromGrade: ModGrade;
  toGrade: ModGrade;
  gain: number;
  /** Gain of upgrading straight to grade IV. */
  gainToMax?: number;
}

/**
 * Translatable engine message: `key` is looked up in the UI i18n
 * dictionary (`engine.<key>`), `params` fill `{name}` placeholders.
 * The plain-English string fields stay as a fallback.
 */
export interface EngineMessage {
  key: string;
  params?: Record<string, string | number>;
}

/** How the engine valued a spell (augment) in the current context. */
export interface SpellUsage {
  name: string;
  expectedTargets: number;
  /** Estimated share (%) of total damage/healing output in this context. */
  share?: number;
  useful: boolean;
  reason: string;
  reasonMsg?: EngineMessage;
}

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------

/**
 * Per-vocation fields (UI shows only the relevant ones):
 * knight: level, mainSkill (melee), shielding · paladin: level, mainSkill
 * (distance), shielding, magicLevel · sorcerer/druid: level, magicLevel ·
 * monk: level, mainSkill (fist), magicLevel. Missing values are estimated
 * from level.
 */
export interface CharacterStats {
  level: number;
  mainSkill?: number;
  shielding?: number;
  magicLevel?: number;
}

export interface WeightedMonster {
  monster: Monster;
  /** Relative share of kills/damage at the spot (any positive scale). */
  weight: number;
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
  /** Defaults to { mode: 'hunt', huntStyle: 'solo' }. */
  context?: FightContext;
  /** Gems the player owns; empty/undefined = recommend only. */
  gems?: OwnedGem[];
  /** Character stats; defaults estimated from points + 50 as level. */
  character?: CharacterStats;
  /** Hunting spot with several monsters; takes precedence over `monster`. */
  monsters?: WeightedMonster[];
  /** Number of alternative builds to return (default 2). */
  alternatives?: number;
  /** Rotation preset id; undefined = engine picks the best. */
  rotationId?: string;
  /** Spells whose wheel augment must be taken (e.g. utility spells needed at a spot). */
  forcedSpells?: string[];
}

export interface StatLine {
  label: string;
  labelMsg?: EngineMessage;
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
  /** Same as `rationale`, translatable. */
  rationaleMsgs?: EngineMessage[];
  /** Vessel contents: owned gems placed optimally, else recommendations. */
  vessels: VesselAssignment[];
  /** Best gems to look for / invest in, best first. */
  gemRecommendations: GemRecommendation[];
  /** Most valuable grade upgrades of owned gem mods, best first. */
  upgradeRecommendations: UpgradeRecommendation[];
  /** Spells considered and how useful they are in this context. */
  spells: SpellUsage[];
  /** Export code for the official Wheel of Destiny planner (incl. gems). */
  plannerCode?: string;
  /** Alternative builds (e.g. different revelation focus), best first. */
  alternatives?: AlternativeBuild[];
  /** Rotation the damage estimate is based on. */
  rotation?: RotationUsage;
}

export interface AlternativeBuild {
  /** Short label, e.g. "Avatar focus". */
  label: string;
  labelMsg?: EngineMessage;
  /** What you gain/lose compared to the main build. */
  tradeoff: string;
  tradeoffMsg?: EngineMessage;
  /** Total objective score relative to the main build (main = 100). */
  relativeScore: number;
  result: Omit<OptimizerResult, 'alternatives'>;
}
