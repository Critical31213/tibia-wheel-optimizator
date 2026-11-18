/**
 * Character formulas: max HP / mana / capacity, default skills per level, mitigation.
 * See docs/modules/character-formulas.md for sources and calibration.
 */
import type { CharacterStats, Vocation } from '../../types';

// ---------------------------------------------------------------------------
// Hit points, mana, capacity (naked base values; equipment, wheel and other bonuses come on top)

export interface LevelGains {
  hitPoints: number;
  mana: number;
  capacity: number;
}

/** Gain per level above level 8 (tibia.com / TibiaWiki; monk capacity approximate). */
export const LEVEL_GAINS: Record<Vocation, LevelGains> = {
  knight: { hitPoints: 15, mana: 5, capacity: 25 },
  paladin: { hitPoints: 10, mana: 15, capacity: 20 },
  sorcerer: { hitPoints: 5, mana: 30, capacity: 10 },
  druid: { hitPoints: 5, mana: 30, capacity: 10 },
  monk: { hitPoints: 10, mana: 10, capacity: 25 },
};

/** Every character has these at level 8 and gains 5 HP / 5 mana / 10 cap per level before that. */
const LEVEL_8 = { hitPoints: 185, mana: 90, capacity: 470 };
const PRE_8 = { hitPoints: 5, mana: 5, capacity: 10 };

function stat(vocation: Vocation, level: number, key: keyof LevelGains): number {
  const l = Math.max(1, Math.round(level));
  return LEVEL_8[key] + (Math.min(l, 8) - 8) * PRE_8[key] + Math.max(l - 8, 0) * LEVEL_GAINS[vocation][key];
}

export const maxHitPoints = (vocation: Vocation, level: number) => stat(vocation, level, 'hitPoints');
export const maxMana = (vocation: Vocation, level: number) => stat(vocation, level, 'mana');
/** Capacity in oz. */
export const capacity = (vocation: Vocation, level: number) => stat(vocation, level, 'capacity');

// ---------------------------------------------------------------------------
// Default skills (typical trained values incl. common equipment/loyalty, WITHOUT stance bonuses)

export const SKILL_LEVELS = [200, 400, 600, 800, 1000, 1250, 1500] as const;

interface SkillRow {
  /** Melee (knight), distance (paladin) or fist (monk); 0 for mages. */
  mainSkill: number[];
  magicLevel: number[];
  shielding: number[];
}

/** APPROXIMATE community-typical values per level in SKILL_LEVELS; interpolated linearly. */
export const DEFAULT_SKILLS: Record<Vocation, SkillRow> = {
  knight: {
    mainSkill: [100, 110, 116, 121, 125, 129, 133],
    magicLevel: [10, 11, 12, 12, 13, 13, 14],
    shielding: [88, 98, 104, 109, 113, 117, 121],
  },
  paladin: {
    mainSkill: [105, 116, 123, 128, 132, 136, 140],
    magicLevel: [22, 27, 30, 33, 35, 37, 39],
    shielding: [72, 80, 86, 90, 94, 98, 102],
  },
  sorcerer: {
    mainSkill: [0, 0, 0, 0, 0, 0, 0],
    magicLevel: [85, 100, 110, 117, 122, 128, 133],
    shielding: [25, 28, 30, 32, 33, 35, 36],
  },
  druid: {
    mainSkill: [0, 0, 0, 0, 0, 0, 0],
    magicLevel: [85, 100, 110, 117, 122, 128, 133],
    shielding: [25, 28, 30, 32, 33, 35, 36],
  },
  monk: {
    mainSkill: [95, 105, 111, 116, 120, 124, 128],
    magicLevel: [30, 36, 40, 43, 46, 48, 50],
    shielding: [60, 66, 70, 73, 76, 79, 82],
  },
};

function interpolate(xs: readonly number[], ys: readonly number[], x: number): number {
  if (x <= xs[0]) return ys[0] * Math.max(0.3, x / xs[0]) ** 0.35;
  if (x >= xs[xs.length - 1]) {
    const n = xs.length - 1;
    const slope = (ys[n] - ys[n - 1]) / (xs[n] - xs[n - 1]);
    return ys[n] + slope * (x - xs[n]);
  }
  let i = 0;
  while (x > xs[i + 1]) i++;
  const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
  return ys[i] + t * (ys[i + 1] - ys[i]);
}

/** Typical skills for a vocation/level (used when the user leaves fields empty). */
export function defaultCharacterStats(vocation: Vocation, level: number): Required<CharacterStats> {
  const row = DEFAULT_SKILLS[vocation];
  const at = (ys: number[]) => Math.round(interpolate(SKILL_LEVELS, ys, level));
  return { level, mainSkill: at(row.mainSkill), magicLevel: at(row.magicLevel), shielding: at(row.shielding) };
}

/** User-entered stats with gaps filled from {@link defaultCharacterStats}. */
export function resolveCharacterStats(vocation: Vocation, stats: CharacterStats): Required<CharacterStats> {
  const d = defaultCharacterStats(vocation, stats.level);
  return {
    level: stats.level,
    mainSkill: stats.mainSkill ?? d.mainSkill,
    magicLevel: stats.magicLevel ?? d.magicLevel,
    shielding: stats.shielding ?? d.shielding,
  };
}

// ---------------------------------------------------------------------------
// Mitigation (% of incoming damage removed)
//
// Community-documented composition (TibiaQA #36739; formula not published by CipSoft):
//   mitigation = (shieldingPart + defensePart) × equipment × wheelMultiplier
// Combat stances (offensive/balanced/defensive) were removed in 15.25 (June 2026).
// Constants calibrated on the TibiaQA worked example (117 shielding → 1.24 %) and the user's
// Royal Paladin (≈ 1 % at mid levels). APPROXIMATE.

export const MITIGATION = {
  /** % per shielding point. */
  perShielding: 1.24 / 117,
  /** % per defense point of the best hand item (shield, spellbook, weapon). */
  perDefense: 0.02,
} as const;

export type Wielding = 'shield' | 'twoHanded' | 'bow' | 'crossbow' | 'spellbook' | 'fist';

/** Equipment multiplier (knight two-handed 0.8 per TibiaQA; crossbow bonus approximate). */
export const EQUIPMENT_MULTIPLIER: Record<Wielding, number> = {
  shield: 1,
  twoHanded: 0.8,
  bow: 1,
  crossbow: 1.1,
  spellbook: 1,
  fist: 1,
};

/** Typical hand setup and defense value per vocation. */
export const DEFAULT_WIELDING: Record<Vocation, { wielding: Wielding; defense: number }> = {
  knight: { wielding: 'shield', defense: 50 },
  paladin: { wielding: 'bow', defense: 0 },
  sorcerer: { wielding: 'spellbook', defense: 20 },
  druid: { wielding: 'spellbook', defense: 20 },
  monk: { wielding: 'fist', defense: 15 },
};

export interface MitigationOptions {
  shielding?: number;
  defense?: number;
  wielding?: Wielding;
  /** Wheel "Mitigation Multiplier" in % (dedication 0.075 %/point + gem mods). */
  wheelMultiplierPct?: number;
}

/** Character mitigation in % (e.g. 1.0 = 1 % damage reduction). */
export function mitigationPercent(vocation: Vocation, level: number, opts: MitigationOptions = {}): number {
  const d = DEFAULT_WIELDING[vocation];
  const shielding = opts.shielding ?? defaultCharacterStats(vocation, level).shielding;
  const defense = opts.defense ?? d.defense;
  const base = shielding * MITIGATION.perShielding + defense * MITIGATION.perDefense;
  return base * EQUIPMENT_MULTIPLIER[opts.wielding ?? d.wielding] * (1 + (opts.wheelMultiplierPct ?? 0) / 100);
}

/**
 * Base mitigation (%) at which a promotion point in "Mitigation Multiplier" (0.075 %/pt) is worth as much
 * effective HP as a point in "Hit Points" (`hpPerPoint`). Real mitigation is far below this for every
 * vocation at 200-1500, i.e. as pure effective HP the HP dedication always wins; mitigation's value is
 * the sustained-damage reduction (less healing needed), see docs/modules/character-formulas.md.
 */
export function mitigationBreakEvenPercent(vocation: Vocation, level: number, hpPerPoint: number, totalHp?: number): number {
  const hp = totalHp ?? maxHitPoints(vocation, level);
  return (hpPerPoint / hp / 0.00075) * 100;
}
