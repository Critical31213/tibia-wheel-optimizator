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
  /** D66: other spells cast in the same slot (e.g. the monk's Harmony spender); best per cast first, within cooldowns. */
  slot?: string[];
}

export interface RotationPreset {
  id: string;
  vocation: Vocation;
  name: string;
  /** Short hint when the rotation is used (English). */
  note?: string;
  /** Only valid when the build reaches this revelation / the player wears a shield. */
  /** `holyImmune` (D103): auto mode uses it only, and only then, when most of the spot does not take holy damage. */
  requires?: { revelation?: string; shield?: boolean; holyImmune?: boolean };
  /** D24: stance this rotation is played with (else picked by the engine). */
  stance?: string;
  spells: RotationSpell[];
}

/** `RotationUsage.presetId` of the engine's greedy boss plan (no preset). */
export const GREEDY_ROTATION_ID = 'boss';

/** D70: `rotationId` of the user's own rotation (`OptimizerInput.customRotation`). */
export const CUSTOM_ROTATION_ID = 'custom';

export interface RotationUsage {
  presetId: string;
  /** True when the engine picked it (no manual choice). */
  auto: boolean;
  /** Spells actually cast incl. revelation-unlocked ones and resolved element alternatives; share in %. */
  spells: { name: string; ratio: number; share: number; fromRevelation?: boolean; damage?: SpellDamage }[];
  /** D51: auto-attack share of the damage (%), not in `spells`. */
  autoAttack?: number;
  /** D67: average damage of the whole rotation over `seconds` (with the build's revelations, augments and flat bonus). */
  window?: { seconds: number; autoAttack: number; total: number };
}

/** D67: average damage of one spell over `RotationUsage.window`. */
export interface SpellDamage {
  /** Average casts in the window. */
  casts: number;
  /** Average targets hit per cast. */
  targets: number;
  /** Average damage of one cast (all targets, element, crit). */
  perCast: number;
  total: number;
  /** D105: the spell's own hit on one target, without crit or revelation extra hits: average, formula min / max. */
  avgHit?: number;
  minHit?: number;
  maxHit?: number;
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
  /** Number of filled Gem Vessel slices required to unlock it (1..8; live: 3 of its domain). */
  unlockOrder: number;
  /** D88 live wheel: the domain the vessel belongs to. */
  domain?: Domain;
}

/** D88: wheel version: 'current' (announced update) or 'live' (live servers, Vessel Resonance). */
export type WheelVariant = 'current' | 'live';
export const WHEEL_VARIANTS: readonly WheelVariant[] = ['current', 'live'];

export interface VesselAssignment {
  vesselId: number;
  quality: GemQuality;
  unlocked: boolean;
  gem: OwnedGem | null;
  source: 'owned' | 'recommended' | 'empty';
  /** D88 live wheel: domain of the vessel and its Vessel Resonance (0..3); `quality` follows the resonance. */
  domain?: Domain;
  resonance?: number;
  /** D88 live wheel: +damage & healing of a gem whose quality matches the resonance. */
  matchBonus?: number;
  /** D72: active mods of the placed gem worth nothing in this build, with why. */
  idle?: { slot: 'basic1' | 'basic2' | 'supreme'; reason: string; reasonMsg?: EngineMessage }[];
}

/** D55: a gain split into % damage per turn and % effective HP (the blended `gain` mixes both by priority). */
export interface GainEffect {
  dmg: number;
  ehp: number;
  /** D130: build effect only: offense outside the rotation damage table (mana leech, momentum, unique perks, passive revelations), % equivalent. */
  other?: number;
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

/** D71: replace one basic mod of a placed owned gem (D72: supreme mods are not swapped); the new mod has the character's grade on it (I when unknown). */
export interface ModSwapRecommendation {
  gemId: string;
  vesselId: number;
  quality: GemQuality;
  slot: 'basic1' | 'basic2' | 'supreme';
  kind: ModKind;
  from: { modId: number; name: string; grade: ModGrade };
  to: { modId: number; name: string; grade: ModGrade };
  gain: number;
  effect?: GainEffect;
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
  /** D88: wheel version (default 'current'). */
  wheelVariant?: WheelVariant;
  /** D89: the player's own wheel (points per slice) to compare with the optimal build. */
  compareWith?: Record<SliceId, number>;
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
  /** D70: spells and casts per full cycle of the user's rotation, used when `rotationId` is `custom`. */
  customRotation?: RotationSpell[];
  /** Spells whose wheel augment must be taken (e.g. utility spells needed at a spot). */
  forcedSpells?: string[];
  /** D35: forced spells whose augment must reach stage II (both slices); a subset of `forcedSpells`. */
  forcedStage2?: string[];
  /** D35: revelations that must reach at least this stage. */
  forcedRevelations?: ForcedRevelation[];
  /** D116: minimum number of unlocked gem vessels (as many as the points allow). */
  minVessels?: number;
  /** D92: spells the player does not cast (e.g. no time to stand still at the spot); never in the rotation, no value. */
  excludedSpells?: string[];
  /** D107: the player's average targets per cast when hunting (spell name → targets), replacing the community average. */
  spellTargets?: Record<string, number>;
  /** D122: share of rotation turns with an auto-attack (0–100 %); default `AUTO_ATTACK_UPTIME` of the vocation. */
  autoAttackPct?: number;
  /** D93: offensive charms the player has unlocked; the engine assigns them to the spot's creatures. */
  charms?: OwnedCharm[];
  /** D93: the assignment (set by the engine from `charms`). */
  charmPicks?: CharmAssign[];
  /** D32: stance names chosen by the user ([] = none); undefined = engine picks per plan. */
  stances?: string[];
  /** D51: knight's trained melee skill; weapons of the other types are skipped (undefined = all). */
  meleeSkill?: MeleeSkill;
  /** D45: weapons the player owns; the engine picks the best one with its proficiency perks. */
  weapons?: OwnedWeapon[];
  /** D45: also look for better weapons the player does not own (slower). */
  suggestWeapons?: boolean;
  /** D74: equipment the player owns (several items per slot); the engine wears the best set for the spot. */
  gear?: GearInput;
  /** D136: chosen skill food and potion ids (added to the resolved skills). */
  consumables?: string[];
  /** D74: effects of the worn equipment (set by the engine from `gear`); undefined = the previous assumptions. */
  equipment?: GearEffects;
  /** D78: `equipment` without the shield / spellbook, used with a two-handed weapon. */
  equipmentTwoHanded?: GearEffects;
  /** D81: the worn items (set by the engine), so a loadout's own weapon tier and imbuements can be applied. */
  wornPieces?: Partial<Record<GearSlot, GearPiece>>;
}

/** D93: offensive charms. */
export type CharmId = 'wound' | 'enflame' | 'poison' | 'freeze' | 'zap' | 'curse' | 'divineWrath' | 'overpower' | 'overflux' | 'carnage' | 'lowBlow' | 'savageBlow';

export interface OwnedCharm {
  id: CharmId;
  stage: 1 | 2 | 3;
}

/** D93: a charm assigned to a creature of the spot. */
export interface CharmAssign extends OwnedCharm {
  monsterId: string;
}

/** D93: an assigned charm and its damage gain on the spot (% of the rotation's damage, before the wheel). */
export interface CharmResult extends CharmAssign {
  monsterName: string;
  gain: number;
}

/** D74: paper-doll slots the player fills (the weapon comes from the owned weapons). */
export type GearSlot = 'helmet' | 'amulet' | 'armor' | 'legs' | 'boots' | 'ring' | 'offhand' | 'trinket';

export interface GearImbue {
  id: string;
  /** Basic, Intricate, Powerful. */
  level: 1 | 2 | 3;
}

export interface GearPiece {
  itemId: string;
  /** Forge tier (0 = none). */
  tier?: number;
  imbues?: GearImbue[];
}

/** Tier and imbuements of the weapon the engine picks. */
export interface WeaponGear {
  tier: number;
  imbues: GearImbue[];
}

export interface GearInput {
  /** Owned items per slot. */
  pieces: Partial<Record<GearSlot, GearPiece[]>>;
  /** null = not set (default assumption). */
  weapon: WeaponGear | null;
}

/** D74: the worn set: index into `gear.pieces[slot]` per slot, and its effects. */
export interface GearResult {
  worn: Partial<Record<GearSlot, number>>;
  effects: GearEffects;
  /** D78: the chosen weapon is two-handed, so the shield / spellbook is taken off (not in `effects`). */
  offhandOff?: boolean;
}

/**
 * D74: equipment effects (items, imbuements, forge tiers) as the engine uses them. Skills are added to the
 * entered (base) skills only. Optional fields left undefined keep the default assumption.
 */
/** D97: an item's bonus to one spell (item augment). */
export interface ItemAugment {
  spell: string;
  kind: 'baseDamage' | 'baseHealing' | 'critDamage' | 'critChance' | 'cooldown' | 'lifeLeech' | 'manaLeech';
  /** Fraction (0.08 = +8 %) or seconds (cooldown). */
  value: number;
}

export interface GearEffects {
  skills: { main: number; magic: number; shielding: number };
  /** Extra magic level for spells of an element (and healing). */
  elementMl: Partial<Record<Element, number>>;
  /** Resistance % per element (summed over items and imbuements). */
  resist: Partial<Record<Element, number>>;
  /** Worn offhand (shield / spellbook defense); undefined = the vocation default. */
  offhand?: { kind: 'shield' | 'spellbook' | 'quiver' | 'none'; defense: number };
  /** Critical hit chance / extra damage (pp); replaces the default Powerful Strike. */
  crit?: { chance: number; extra: number };
  /** Total life leech % of the imbuements; replaces the default. */
  lifeLeech?: number;
  /** The weapon's own imbuements (removed for weapons that cannot take them); undefined = default assumption. */
  weaponImbues?: { critChance: number; critExtra: number; lifeLeech: number; manaLeech: number };
  /** Elemental damage imbuement: share (%) of the weapon's physical damage dealt as this element. */
  conversion?: { element: Element; pct: number };
  /** Forge: Onslaught chance (%, +60 % damage), Ruse dodge chance (%). */
  onslaught: number;
  ruse: number;
  /** D97: augments of the worn items (not the weapon: its augments come with the proficiency loadout). */
  augments?: ItemAugment[];
  /** D138: crit chance (pp) from worn items (e.g. Cursed Coin), on top of `crit` or the default. */
  itemCritChance?: number;
  /** D131: total mantra of the worn items (monk; Ascetic adds 100/200/300 % of it to each auto-attack hit). */
  mantra?: number;
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
  /** D81: forge tier and imbuements of this weapon; undefined = the default (`gear.weapon`, else the assumption). */
  gear?: WeaponGear;
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
  /** D56: the chosen weapon with every perk left to the engine, when that beats the manual picks. */
  better?: WeaponPick;
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
  /** D93: charms assigned to the spot's creatures (when the player entered charms). */
  charms?: CharmResult[];
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
  /** D58: what the wheel (with gems) adds: % damage per turn and % effective HP vs an empty wheel. */
  wheelEffect?: GainEffect;
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
  /** D71: best mod swap per slot of each placed owned gem, best first. */
  modSwaps: ModSwapRecommendation[];
  /** Spells considered and how useful they are in this context. */
  spells: SpellUsage[];
  /** Export code for the official Wheel of Destiny planner (incl. gems). */
  plannerCode?: string;
  /** D88: wheel version the build was made for (absent = 'current'). */
  wheelVariant?: WheelVariant;
  /** D89: the player's own wheel valued like the build (only with `compareWith`). */
  comparison?: WheelComparison;
  /** Alternative builds (e.g. different revelation focus), best first. */
  alternatives?: AlternativeBuild[];
  /** Rotation the damage estimate is based on. */
  rotation?: RotationUsage;
  /** D24: stances the build assumes (picked automatically). */
  stances?: string[];
  /** D45: weapon choice, when weapons were given. */
  weapon?: WeaponResult;
  /** D74: worn equipment, when equipment was given. */
  gear?: GearResult;
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

/** D89: a difference between the own and the optimal wheel; `score`/`effect` = optimal minus own. */
export interface ComparisonItem {
  kind: 'slice' | 'revelation' | 'vessels';
  /** Slice id, revelation name or '' for vessels. */
  id: string;
  name: string;
  own: number;
  best: number;
  score: number;
  effect: GainEffect;
}

/** D89: the player's wheel valued with the same rotation, stances, gear and gems as the optimal build. */
export interface WheelComparison {
  allocation: Record<SliceId, number>;
  pointsUsed: number;
  revelations: ActivatedRevelation[];
  /** Optimal minus own wheel value (blended score and % damage / % EHP). */
  score: number;
  effect: GainEffect;
  /** Own wheel value as % of the optimal wheel's. */
  relative: number;
  verdict: 'equal' | 'close' | 'worse' | 'better';
  /** Differences, largest first. */
  items: ComparisonItem[];
  /** Slices with points that are not unlocked or over capacity (ignored). */
  invalid: SliceId[];
  reasons: string[];
  reasonMsgs: EngineMessage[];
}
