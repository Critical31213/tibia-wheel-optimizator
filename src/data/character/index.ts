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
    shielding: [34, 35, 36, 38, 38, 39, 40],
  },
  druid: {
    mainSkill: [0, 0, 0, 0, 0, 0, 0],
    magicLevel: [85, 100, 110, 117, 122, 128, 133],
    shielding: [34, 35, 36, 38, 38, 39, 40],
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
// Mitigation (% of incoming damage removed), D19 — no fight modes in the current game.
//
// Structure from the game:
//   (shielding × vocFactor + offhandFactor × defense) / 100, then × (1 + wheel%/100); a quiver changes nothing (D108).
// Constants fitted on in-game Cyclopedia values (no wheel):
//   RP shielding 108 + quiver → 1.18 %; RP shielding 110 + Gnome Shield → 1.21 % shielding + 1.28 % shield;
//   ED shielding 36 → 0.38 %, + Spellbook of Mind Control (def 26) 0.61 %;
//   EK shielding 103 → 1.13 %, + Dragon Shield (def 41) 1.04 % (D111); monk shielding 72 → 0.77 %, + Soulkamas
//   (two-handed, def 21) 0.51 % (D117). The Cyclopedia truncates to 0.01.
// See docs/modules/character-formulas.md (inference + uncertainty).

export type Offhand = 'shield' | 'spellbook' | 'quiver' | 'none';

/** % per 100 shielding (D111: one value fits RP 108 / 110 and EK 103; ED 36 → 0.38 %). */
export const MITIGATION_SHIELDING_FACTOR: Record<Vocation, number> = {
  knight: 1.1,
  paladin: 1.1,
  sorcerer: 1.07, // not measured; follows the druid
  druid: 1.07,
  monk: 1.07, // D117: 72 → 0.77 % bounds it to 1.069–1.083
};

/** % per 100 offhand defense (shields: Gnome Shield 50 → 1.28 %, Dragon Shield 41 → 1.04 %; spellbook: Mind Control 26 → 0.61 %). */
export const MITIGATION_DEFENSE_FACTOR: Record<'shield' | 'spellbook', number> = { shield: 2.56, spellbook: 2.36 };

/**
 * D112: % per 100 weapon defense without a shield or spellbook. One-handed: Fire Sword, defense 20 → 0.50 % (0.51 % under
 * Utamo Tempo). D117: two-handed weapons give less (TibiaWiki): Soulkamas, defense 21 → 0.51 % (bounds 2.43–2.47).
 * With a shield the weapon adds only ~0.05 % and is ignored.
 */
export const WEAPON_DEFENSE_FACTOR: Record<'oneHanded' | 'twoHanded', number> = { oneHanded: 2.53, twoHanded: 2.45 };

/** D117: whether the vocation's typical weapon is two-handed (monk fist weapons; knights assumed one-handed). */
export const TWO_HANDED_WEAPON: Record<Vocation, boolean> = { knight: false, paladin: true, sorcerer: false, druid: false, monk: true };

/** D112: typical weapon defense per OFFHAND_LEVELS (melee weapons of the level; bows, wands and rods have none). */
export const WEAPON_DEFENSE: Record<Vocation, number[]> = {
  knight: [30, 32, 33, 33, 35, 36, 36],
  paladin: [0, 0, 0, 0, 0, 0, 0],
  sorcerer: [0, 0, 0, 0, 0, 0, 0],
  druid: [0, 0, 0, 0, 0, 0, 0],
  monk: [17, 20, 20, 20, 22, 22, 22],
};

/** Level brackets of the typical best-in-slot offhand defense (TibiaWiki item data). */
export const OFFHAND_LEVELS = [200, 400, 600, 800, 1000, 1250, 1500] as const;

/** Typical offhand defense per OFFHAND_LEVELS (nearest lower bracket). */
export const OFFHAND_DEFENSE: Record<'shield' | 'spellbook', number[]> = {
  // Demon Shield 46, Great/Gnome Shield 50, Eldritch Shield 51, Falcon Escutcheon 52, Refined Stag Shield 54, Soulbastion 55
  shield: [46, 50, 51, 52, 54, 55, 55],
  // Spellbook of Lost Souls / Umbral Master 32, Stag Spellbook / Eldritch Folio 34, Arboreal Tome / Arcanomancer Folio 36
  spellbook: [32, 34, 34, 36, 36, 36, 36],
};

/** D19 defaults: paladin quiver (bow hunt / crossbow boss), mages spellbook, knight and monk none (knight shield only in the shield rotation). */
export const DEFAULT_OFFHAND: Record<Vocation, Offhand> = {
  knight: 'none',
  paladin: 'quiver',
  sorcerer: 'spellbook',
  druid: 'spellbook',
  monk: 'none',
};

const bracket = (level: number) => OFFHAND_LEVELS.reduce((acc, l, k) => (level >= l ? k : acc), 0);

export function defaultOffhandDefense(offhand: Offhand, level: number): number {
  if (offhand !== 'shield' && offhand !== 'spellbook') return 0;
  return OFFHAND_DEFENSE[offhand][bracket(level)];
}

/** D112: typical weapon defense of the vocation at a level. */
export const defaultWeaponDefense = (vocation: Vocation, level: number) => WEAPON_DEFENSE[vocation][bracket(level)];

export interface MitigationOptions {
  shielding?: number;
  offhand?: Offhand;
  /** Shield/spellbook defense; defaults to the level-bracket typical value. */
  offhandDefense?: number;
  /** D112: weapon defense, counted without a shield / spellbook; defaults to the typical value of the level. */
  weaponDefense?: number;
  /** D117: two-handed weapon (lower factor); defaults to the vocation's typical weapon. */
  weaponTwoHanded?: boolean;
  /** Wheel "Mitigation Multiplier" in % (dedication 0.075 %/point + gem mods). */
  wheelMultiplierPct?: number;
}

export interface MitigationBreakdown {
  shielding: number;
  offhand: number;
  total: number;
}

/** Mitigation split as in the Cyclopedia (both parts include the wheel multiplier). */
export function mitigationBreakdown(vocation: Vocation, level: number, opts: MitigationOptions = {}): MitigationBreakdown {
  const offhand = opts.offhand ?? DEFAULT_OFFHAND[vocation];
  const shielding = opts.shielding ?? defaultCharacterStats(vocation, level).shielding;
  const hasDefense = offhand === 'shield' || offhand === 'spellbook';
  const defense = hasDefense ? (opts.offhandDefense ?? defaultOffhandDefense(offhand, level)) : 0;
  const k = 1 + (opts.wheelMultiplierPct ?? 0) / 100;
  const s = (shielding * MITIGATION_SHIELDING_FACTOR[vocation] * k) / 100;
  const o = hasDefense
    ? (defense * MITIGATION_DEFENSE_FACTOR[offhand] * k) / 100
    : ((opts.weaponDefense ?? defaultWeaponDefense(vocation, level)) * WEAPON_DEFENSE_FACTOR[(opts.weaponTwoHanded ?? TWO_HANDED_WEAPON[vocation]) ? 'twoHanded' : 'oneHanded'] * k) / 100;
  return { shielding: s, offhand: o, total: s + o };
}

/** Character mitigation in % (e.g. 1.0 = 1 % damage reduction). */
export function mitigationPercent(vocation: Vocation, level: number, opts: MitigationOptions = {}): number {
  return mitigationBreakdown(vocation, level, opts).total;
}

/** D18: effective HP = HP / (1 − mitigation). */
export function effectiveHp(hp: number, mitigationPct: number): number {
  return hp / (1 - Math.min(95, Math.max(0, mitigationPct)) / 100);
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
