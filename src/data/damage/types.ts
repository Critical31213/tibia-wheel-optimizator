/** Types of the generated damage dataset (scripts/datamine-tibiatools.mjs). */
import type { Element, Vocation } from '../../types';

export type DamageArea = 'single' | 'area' | 'beam' | 'chain';
export type DamageModel = 'magic' | 'weapon' | 'shield';

/** Coefficients; missing terms are 0. Damage uses levelTerm (× g(L), see levelTerm()), healing uses linear level. */
export interface Coefficients {
  const: number;
  levelTerm?: number;
  /** Linear level (healing formulas). */
  level?: number;
  /** × g(L)·skill·attack/1000 (four monk spells). */
  levelSkillAttack?: number;
  magicLevel?: number;
  skill?: number;
  attack?: number;
  skillAttack?: number;
  shielding?: number;
  shieldDefense?: number;
  shieldingDefense?: number;
}

export interface FitQuality {
  n: number;
  maxAbsErr: number;
  rmse: number;
  maxRelErr: number;
}

export interface DamageVariant {
  /** TibiaTools spell id. */
  apiId: number;
  /** API suffix: "No Bonus", "Stage 1", "Central", "Stage 2 Sides", "Primary", "Repeat Stage 3"... */
  label: string | null;
  /** main = the spell's own hit; extra = revelation bonus hit (sides, repeat, red/green HP bonus). */
  part: 'main' | 'extra';
  /** Revelation stage the variant belongs to (null/0 = always). */
  stage: number | null;
  /** Multiplier of the flat wheel bonus (and of g(L)): 1 for most hits, 0.25-0.7 beam sides, 1.2-2.5 staged hits. */
  bonusFactor: number;
  avg: Coefficients;
  min: Coefficients | null;
  max: Coefficients | null;
  fit: FitQuality;
}

export interface DamageSpell {
  name: string;
  apiName: string;
  vocations: Vocation[];
  kind: 'damage';
  spellType: 'spell' | 'rune';
  element: Element;
  /** Deals the weapon's damage type (physical unless imbued/bonded). */
  weaponElement: boolean;
  scalesWith: 'magic' | 'melee' | 'distance' | 'shielding';
  model: DamageModel;
  area: DamageArea;
  /** D16: single-target spells are never valued in hunt mode. */
  singleTarget: boolean;
  cooldownSeconds: number;
  cooldownApprox?: boolean;
  /** tibiapal "spell average hits" (real hunting data); 1 for single-target. */
  avgTargetsHunt: number | null;
  avgTargetsHuntOuter?: number;
  /** TibiaTools perk ids of the spell's augment-able effects. */
  perkIds: { baseDamage?: number; critDamage?: number; critChance?: number } | null;
  variants: DamageVariant[];
  /** Wheel revelation that unlocks the spell (D20); absent = always available. */
  unlockedBy?: string;
}

export interface HealingSpell {
  name: string;
  vocations: Vocation[];
  kind: 'healing';
  area: DamageArea;
  singleTarget: boolean;
  cooldownSeconds: number;
  model: 'magic';
  avg: Coefficients;
  min: Coefficients;
  max: Coefficients;
  source: string;
  note: string;
}

export interface WeaponBracket {
  weapon: string;
  weaponId: number;
  attack: number;
  ammo?: string;
  shield?: string;
}

export interface RotationPreset {
  name: string;
  spells: { name: string; ratio: number }[];
}

export interface SpellFormulasFile {
  meta: Record<string, unknown>;
  rules: Record<string, unknown>;
  critDefaults: { critChance: number; critDamage: number; note: string };
  weaponBrackets: Record<Vocation, Record<string, WeaponBracket>>;
  spells: DamageSpell[];
  healing: HealingSpell[];
  characterPerks: Record<string, { id: number; bonusType: string; scopes: string[]; valueType: string }>;
  rotationPresets: Partial<Record<Vocation, RotationPreset[]>>;
}
