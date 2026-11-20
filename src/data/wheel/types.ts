/** Internal types of the generated wheel dataset (scripts/extract-wheel.mjs). */
import type { Domain, Element, GemQuality, Vocation } from '../../types';

export type Quarter = 'TL' | 'TR' | 'BL' | 'BR';

export type ConvictionCategory =
  | 'unique'
  | 'skillBonus'
  | 'leech'
  | 'augmentation'
  | 'gemVessel'
  | 'revelationMastery'
  | 'other';

export type SupremeCategory =
  | 'effect'
  | 'augCrit'
  | 'augCooldown'
  | 'augHealing'
  | 'augDamage'
  | 'augOther'
  /** D73: +chain targets / range. */
  | 'augChain'
  | 'revelationMastery';

export interface DedicationPerk {
  /** 0 Hit Points, 1 Mana, 3 Capacity, 4 Mitigation Multiplier. */
  id: number;
  name: string;
  /** Bonus per promotion point (mitigation in %). */
  perPoint: number;
  unit?: '%';
}

export interface WheelDedication {
  /** Planner small perk id (2 = Hit Points + Mana). */
  smallPerkId: number;
  name: string;
  primaryIncrease: number;
  secondaryIncrease: number | null;
  perks: DedicationPerk[];
}

export interface WheelAugment {
  /** Spell name or group name ("Special Spells", "Focus Spells", "Forked Spells"). */
  subject: string;
  spells: string[];
  /** Granted by the first filled copy. */
  stage1: string;
  /** Added by the second filled copy (cumulative). */
  stage2: string;
}

export interface WheelConviction {
  id: number;
  category: ConvictionCategory;
  /** Raw planner value (leech in hundredths of %, RM points, skill levels). 0 for augments. */
  value: number;
  name: string;
  shortName: string;
  format: string;
  description: string;
  numericValue?: number;
  displayValue?: string;
  augment?: WheelAugment;
  revelationPoints?: number;
}

export interface WheelTile {
  /** 6×6 grid id, row-major (0..35). */
  gridId: number;
  /** Planner enum name, e.g. "QTL8". */
  tileName: string;
  quarter: Quarter;
  domain: Domain;
  row: number;
  col: number;
  /** 1 = inner (50 pts) … 5 = outer corner (200 pts). */
  ring: number;
  capacity: number;
  initiallyUnlocked: boolean;
  isGemVessel: boolean;
  dedication: WheelDedication;
  conviction: WheelConviction;
}

export interface StageValueGroup {
  display: [string, string, string];
  values: [number | null, number | null, number | null];
}

export interface WheelRevelation {
  quarter: Quarter;
  domain: Domain;
  largePerkId: number;
  name: string;
  shortInfo: string;
  /** Text with "stage1/stage2/stage3" values. */
  description: string;
  /** Text per stage 1..3 with the value of that stage substituted. */
  stageTexts: [string, string, string];
  stageValues: StageValueGroup[];
  /** Spells granted by this revelation (empty for passives). */
  spells: string[];
  /** Existing spells boosted by a passive revelation. */
  affectsSpells: string[];
  isAvatar: boolean;
}

export interface WheelVessel {
  id: number;
  vesselLevel: 0 | 1 | 2;
  quality: GemQuality;
  /** Number of completely filled Gem Vessel slices needed. */
  unlockOrder: number;
  gemName?: string;
  /** D88 live wheel: one vessel per domain. */
  domain?: Domain;
}

export interface BasicModEffect {
  effectId: number;
  name: string;
  display: string[];
  values: (number | null)[];
}

export interface WheelBasicMod {
  id: number;
  kind: 'basic';
  name: string;
  slots: (1 | 2)[];
  effects: BasicModEffect[];
  /** Display per grade I..IV. */
  gradeValues: string[];
}

export interface WheelSupremeMod {
  id: number;
  kind: 'supreme';
  name: string;
  category: SupremeCategory;
  /** Augmented spell (also set for Avatar spells). */
  spell: string | null;
  /** Revelation boosted (RM mods) or augmented (Avatar / revelation spells). */
  revelation: string | null;
  gradeValues: string[];
  values: (number | null)[];
  /** Momentum chance in % per grade (cooldown mods only). */
  momentum?: number[];
  /** Raw planner summary value at grade IV. */
  maxGradeValue: number;
}

export interface ReferenceBuild {
  points: number;
  description: string;
  code: string;
  /** Planner reported an older code format; slice meanings may have changed. */
  legacyCode: boolean;
  spent: number;
  /** gridId -> points. */
  tiles: Record<string, number>;
  vessels: { id: number; basic1: number; basic2: number | null; supreme: number | null }[];
  revelationStages: number[];
  currentCode: string;
}

export interface VocationWheelData {
  vocation: Vocation;
  tiles: WheelTile[];
  revelations: WheelRevelation[];
  vessels: WheelVessel[];
  gemVesselTiles: number[];
  mods: { basic: WheelBasicMod[]; supreme: WheelSupremeMod[] };
  referenceBuilds: { lesserGems: string[]; greaterGems: string[]; builds: ReferenceBuild[] };
  verification: Record<string, unknown>;
}

export interface WheelDataFile {
  meta: { source: string; generatedAt: string; totalCapacity: number; note: string };
  grid: {
    rows: number;
    cols: number;
    quarters: Quarter[];
    domains: Record<Quarter, Domain>;
    ringByCapacity: Record<string, number>;
  };
  unlockGraph: { initiallyUnlocked: number[]; edges: Record<string, number[]>; rule: string };
  revelation: {
    thresholds: number[];
    damageHealingBonusPerStage: number[];
    rule: string;
    levelNames: Record<string, string>;
  };
  revelationMastery: { mediumPerkId: number; pointsPerConvictionSlice: number; rule: string };
  augmentStacking: { copiesPerAugment: number; rule: string };
  vessels: {
    /** D88: 'global' = vessels unlock by Gem Vessel slices anywhere; 'resonance' = live, one vessel per domain. */
    system: 'global' | 'resonance';
    list: WheelVessel[];
    rule: string;
    gemQualityMods: Record<GemQuality, number>;
    vesselModsByQuality: string;
    gemNames: Record<string, Record<Vocation, string>>;
  };
  momentum: { perGrade: number[]; unit: string; rule: string };
  dedicationPerks: Record<string, { name: string; format: string; info: string }>;
  texts: Record<string, string>;
  findings: Record<string, unknown>;
  vocations: Record<Vocation, VocationWheelData>;
}

// ---------------------------------------------------------------------------
// Spells

export type SpellKind = 'damage' | 'healing' | 'support';
export type SpellArea = 'single' | 'area' | 'chain' | 'beam';

export interface SpellMeta {
  name: string;
  vocations: Vocation[];
  element: Element | null;
  kind: SpellKind;
  area: SpellArea;
  /** Average targets hit while hunting (community data), if known. */
  avgHitsHunt?: number;
  /** Beams: average extra targets hit by the outer beam (Beam Mastery). */
  avgHitsHuntOuter?: number;
  /** Rough maximum number of targets. */
  maxTargets: number;
  /** Introduced with the 2026 Vocation Adjustments update. */
  isNew: boolean;
  isAvatar: boolean;
  /** Some values are estimates. */
  approximate?: boolean;
  note?: string;
}
