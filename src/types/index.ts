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

/** The 21 bestiary classes that weapon proficiency perks can target. */
export const BESTIARY_CLASSES = [
  'Amphibic', 'Aquatic', 'Bird', 'Construct', 'Demon', 'Dragon', 'Elemental', 'Extra Dimensional', 'Fey', 'Giant',
  'Human', 'Humanoid', 'Inkborn', 'Lycanthrope', 'Magical', 'Mammal', 'Plant', 'Reptile', 'Slime', 'Undead', 'Vermin',
] as const;
export type BestiaryClass = (typeof BESTIARY_CLASSES)[number];

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
  /** Bestiary class (weapon proficiency "damage against X" perks); missing for bosses and unclassified creatures. */
  bestiaryClass?: BestiaryClass;
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

/** @deprecated Ignored since D20 (hunt targets = community averages); kept for old URLs. */
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
  /** D24: stance this rotation is played with (else picked by the engine). */
  stance?: string;
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
  /** D51: auto-attack share of the damage (%), not in `spells`. */
  autoAttack?: number;
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

/** D55: a gain split into % damage per turn and % effective HP (the blended `gain` mixes both by priority). */
export interface GainEffect {
  dmg: number;
  ehp: number;
}

export interface GemRecommendation {
  quality: GemQuality;
  mods: { kind: ModKind; modId: number; name: string; grade: ModGrade }[];
  /** Relative score gain (same units as offense/defense scores). */
  gain: number;
  effect?: GainEffect;
  reason: string;
  reasonMsg?: EngineMessage;
  /** Near-equal substitutes (D22): other mods for a slot within ~10 % of the chosen mod's gain. */
  similar?: { slot: 'basic1' | 'basic2' | 'supreme'; modId: number; name: string; /** % of the chosen mod's gain. */ relative: number }[];
  /** D30: every unlocked vessel of this quality is filled; `gain` is vs the weakest gem there. */
  replaces?: boolean;
}

export interface UpgradeRecommendation {
  /** First owned gem with the mod. */
  gemId: string;
  /** D27: owned gems with the mod (all upgraded together). */
  gems: number;
  kind: ModKind;
  slot: 'basic1' | 'basic2' | 'supreme';
  modId: number;
  name: string;
  fromGrade: ModGrade;
  toGrade: ModGrade;
  gain: number;
  effect?: GainEffect;
  /** Gain of upgrading straight to grade IV. */
  gainToMax?: number;
  effectToMax?: GainEffect;
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
export type MeleeSkill = 'sword' | 'axe' | 'club';
export const MELEE_SKILLS: readonly MeleeSkill[] = ['sword', 'axe', 'club'];

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
  /** D35: forced spells whose augment must reach stage II (both slices); a subset of `forcedSpells`. */
  forcedStage2?: string[];
  /** D35: revelations that must reach at least this stage. */
  forcedRevelations?: ForcedRevelation[];
  /** D32: stance names chosen by the user ([] = none); undefined = engine picks per plan. */
  stances?: string[];
  /** D51: knight's trained melee skill; weapons of the other types are skipped (undefined = all). */
  meleeSkill?: MeleeSkill;
  /** D45: weapons the player owns; the engine picks the best one with its proficiency perks. */
  weapons?: OwnedWeapon[];
  /** D45: also look for better weapons the player does not own (slower). */
  suggestWeapons?: boolean;
}

/** D45: an owned weapon and its proficiency progress. Character skills are entered without weapon bonuses. */
export interface OwnedWeapon {
  /** Weapon id from the proficiency data. */
  weaponId: string;
  /** Proficiency level reached (0 = none; capped at the weapon's number of levels). */
  level: number;
  /** Chosen option index per level (index 0 = level 1); null/undefined = engine picks. */
  perks?: (number | null)[];
  /** Dust-reshaped slots (at most 2): option `replaces` of `level` (1-based) becomes shaping option `option` at rank 10. */
  shaped?: ShapedSlot[];
}

export interface ShapedSlot {
  level: number;
  replaces: number;
  option: string;
}

/** D45: one weapon with its perks, valued with the chosen build. */
export interface WeaponPick {
  weaponId: string;
  /** Chosen option index per unlocked level. */
  perks: number[];
  /** Objective difference vs the chosen weapon (0 for it; negative = worse). */
  delta: number;
  effect?: GainEffect;
  /** D51: ammunition id (bows, crossbows). */
  ammo?: string;
}

export interface WeaponReshape {
  level: number;
  replaces: number;
  option: string;
  /** Objective gain of the reshape (rank 10). */
  gain: number;
  effect?: GainEffect;
}

export interface WeaponResult {
  /** The chosen weapon (also first in `ranking`). */
  best: WeaponPick;
  /** All owned weapons, best first. */
  ranking: WeaponPick[];
  /** Most valuable dust reshapes of the chosen weapon (free slots only), best first. */
  reshapes: WeaponReshape[];
  /** Better weapons the player does not own (all proficiency levels assumed), best first. */
  suggestions?: WeaponPick[];
}

export interface ForcedRevelation {
  name: string;
  stage: 1 | 2 | 3;
}

/** D35: whether a revelation stage is reachable: now, with a (new or upgraded) Revelation Mastery gem, or not at all. */
export type RevelationReach = { status: 'ok' } | { status: 'gem' | 'upgrade'; grade: 1 | 2 | 3 | 4 } | { status: 'impossible' };

export interface RevelationOption {
  name: string;
  /** Index 0 = stage I. */
  stages: RevelationReach[];
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
  /** D24: stances the build assumes (picked automatically). */
  stances?: string[];
  /** D45: weapon choice, when weapons were given. */
  weapon?: WeaponResult;
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
