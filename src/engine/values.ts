/**
 * Perk valuation. Units: `off` ≈ +1 % total damage output, `def` ≈ +1 % effective survivability,
 * `util` = convenience (mana, capacity). Constants are engine estimates (see docs/modules/engine.md).
 */
import type { Element, FightContext, Monster, Vocation } from '../types';
import type { WheelSupremeMod, WheelTile } from '../data/wheel';
import {
  baseCooldown,
  BEAM_CENTRAL_REACH,
  cooldownGain,
  damageShare,
  elementMultiplier,
  healShare,
  type SpellModel,
  targetsAt,
} from './spells';
import { MOMENTUM_PER_GRADE, REVELATION_FLAT_BONUS, stageFor, type EngineRevelation } from './wheel/build';

export interface Parts {
  off: number;
  def: number;
  util: number;
}

export const ZERO: Parts = { off: 0, def: 0, util: 0 };

export const K = {
  /** +1 skill / magic level. */
  SKILL_OFF: 0.7,
  /** Baseline critical hit chance and extra damage (imbuements). */
  CRIT_CHANCE: 0.1,
  CRIT_EXTRA: 0.5,
  LIFE_LEECH_DEF: 0.8,
  MANA_LEECH_OFF: 0.4,
  MANA_LEECH_DEF: 0.3,
  /** Per +1 % of base hit points. */
  HP_DEF: 0.5,
  /** Per +1 % of base mana. */
  MANA_OFF: 0.15,
  MANA_DEF: 0.1,
  /** Per +1 % damage reduction on all incoming damage. */
  MIT_DR_DEF: 1,
  /** Per +1 % resistance × share of incoming damage of that element. */
  RES_DEF: 1,
  DODGE_DEF: 1,
  /** Per +1 % healing of the vocation's healing. */
  HEAL_DEF: 0.3,
  CAP_UTIL: 0.002,
  MANA_COST_UTIL: 0.05,
  /** Larger area / range augments (+% damage of that spell while hunting). */
  AREA_GAIN: 15,
  /** Per +1 % momentum: fraction of damage from cooldown-bound spells. */
  MOMENTUM_OFF: 0.5,
  MOMENTUM_DEF: 0.2,
  /** Average damage (and healing) per hit ≈ 4 × level, for flat bonuses. */
  HIT_PER_LEVEL: 4,
  /** Avatar: boss fight length (s) and typical interval between boss fights (min). */
  BOSS_FIGHT_S: 120,
  BOSS_INTERVAL_MIN: 30,
  AVATAR_DURATION_S: 15,
} as const;

const HP_PER_LEVEL: Record<Vocation, number> = { knight: 15, paladin: 10, sorcerer: 5, druid: 5, monk: 10 };
/**
 * Typical base mitigation (% damage reduction) at mid/high level, APPROXIMATE.
 * In-game mitigation = (defense + shielding) × equipment × wheel multiplier × stance; the wheel's
 * "Mitigation Multiplier" scales it multiplicatively. Knights (shield, high shielding) are highest,
 * mages (wand + spellbook) lowest.
 */
export const BASE_MITIGATION: Record<Vocation, number> = { knight: 20, paladin: 10, monk: 14, sorcerer: 6, druid: 6 };
const MANA_PER_LEVEL: Record<Vocation, number> = { knight: 5, paladin: 15, sorcerer: 30, druid: 30, monk: 10 };

/** Share of incoming damage per element without a monster. */
const GENERIC_INCOMING: Partial<Record<Element, number>> = {
  physical: 0.35,
  fire: 0.1,
  earth: 0.1,
  energy: 0.1,
  ice: 0.1,
  holy: 0.05,
  death: 0.1,
  lifeDrain: 0.05,
  manaDrain: 0.05,
};

/** Basic-mod effect ids (planner) → resistance element. */
export const RESIST_EFFECT: Record<number, Element> = {
  0: 'physical',
  1: 'holy',
  2: 'death',
  3: 'fire',
  4: 'earth',
  5: 'ice',
  6: 'energy',
  7: 'manaDrain',
  8: 'lifeDrain',
};
export const EFFECT_MITIGATION = 9;
export const EFFECT_HP = 10;
export const EFFECT_MANA = 11;
export const EFFECT_CAPACITY = 12;

export interface ValuationContext {
  vocation: Vocation;
  context: FightContext;
  monster: Monster | null;
  model: SpellModel;
  level: number;
  threat: number;
}

export function add(a: Parts, b: Parts, k = 1): Parts {
  return { off: a.off + b.off * k, def: a.def + b.def * k, util: a.util + b.util * k };
}

export function sub(a: Parts, b: Parts): Parts {
  return add(a, b, -1);
}

/** threat = clamp(maxDamage / 1000, 0.6, 1.6); 1 when unknown. */
export function threatOf(monster: Monster | null): number {
  if (!monster?.maxDamage) return 1;
  return Math.min(1.6, Math.max(0.6, monster.maxDamage / 1000));
}

export function incomingShare(monster: Monster | null, e: Element): number {
  const types: Element[] = monster?.damageTypes.filter((t) => t !== 'healing') ?? [];
  if (!types.length) return GENERIC_INCOMING[e] ?? 0;
  return types.includes(e) ? 1 / types.length : 0;
}

const def = (v: ValuationContext, x: number): Parts => ({ off: 0, def: x * v.threat, util: 0 });

export function hpParts(v: ValuationContext, hp: number): Parts {
  return def(v, (hp / (HP_PER_LEVEL[v.vocation] * v.level)) * 100 * K.HP_DEF);
}

export function manaParts(v: ValuationContext, mana: number): Parts {
  const pct = (mana / (MANA_PER_LEVEL[v.vocation] * v.level)) * 100;
  return { off: pct * K.MANA_OFF, def: pct * K.MANA_DEF * v.threat, util: 0 };
}

/** Extra damage reduction (percentage points) from a +`multiplierPct` % mitigation multiplier. */
export function mitigationGain(vocation: Vocation, multiplierPct: number): number {
  return (BASE_MITIGATION[vocation] * multiplierPct) / 100;
}

export function mitigationParts(v: ValuationContext, multiplierPct: number): Parts {
  return def(v, mitigationGain(v.vocation, multiplierPct) * K.MIT_DR_DEF);
}

export function resistParts(v: ValuationContext, e: Element, pct: number): Parts {
  return def(v, pct * K.RES_DEF * incomingShare(v.monster, e));
}

export function flatParts(v: ValuationContext, flat: number): Parts {
  const pct = (flat / (K.HIT_PER_LEVEL * v.level)) * 100;
  return { off: pct, def: pct * K.HEAL_DEF * v.threat, util: 0 };
}

/** Value of ONE dedication point of a tile. */
export function dedicationParts(v: ValuationContext, t: WheelTile): Parts {
  let p = ZERO;
  for (const d of t.dedication.perks) {
    if (d.id === 0) p = add(p, hpParts(v, d.perPoint));
    else if (d.id === 1) p = add(p, manaParts(v, d.perPoint));
    else if (d.id === 3) p = add(p, { off: 0, def: 0, util: d.perPoint * K.CAP_UTIL });
    else if (d.id === 4) p = add(p, mitigationParts(v, d.perPoint));
  }
  return p;
}

// ---------------------------------------------------------------------------
// Spell effects (augment texts and supreme mods)

export type EffectKind =
  | 'dmg'
  | 'heal'
  | 'cd'
  | 'mana'
  | 'leech'
  | 'critChance'
  | 'critDmg'
  | 'area'
  | 'jumps'
  | 'duration'
  | 'defHit';

export interface SpellEffect {
  kind: EffectKind;
  amount: number;
}

const EFFECT_PATTERNS: [RegExp, EffectKind][] = [
  [/([+-]?\d+(?:\.\d+)?)% Base Damage/i, 'dmg'],
  [/([+-]?\d+(?:\.\d+)?)% Base Healing/i, 'heal'],
  [/-(\d+(?:\.\d+)?)s Cooldown/, 'cd'],
  [/-(\d+) Mana Cost/i, 'mana'],
  [/(\d+(?:\.\d+)?)% life leech/i, 'leech'],
  [/(\d+(?:\.\d+)?)% critical hit chance/i, 'critChance'],
  [/(\d+(?:\.\d+)?)% critical extra damage/i, 'critDmg'],
  [/Jumps to \+(\d+) additional target/i, 'jumps'],
  [/Duration increased/i, 'duration'],
  [/-(\d+)% damage from the next hostile/i, 'defHit'],
];
const AREA_PATTERN = /Expanded Shape|area enlarged|Range increased/i;

export function parseEffects(textValue: string): SpellEffect[] {
  const out: SpellEffect[] = [];
  for (const [re, kind] of EFFECT_PATTERNS) {
    const m = re.exec(textValue);
    if (m) out.push({ kind, amount: m[1] !== undefined ? Math.abs(Number(m[1])) : 1 });
  }
  if (AREA_PATTERN.test(textValue)) out.push({ kind: 'area', amount: 1 });
  return out;
}

/** Support-spell value at 100 % presence (multiplied by cooldown gains). */
const SUPPORT_VALUE: Record<string, Parts> = {
  'Divine Dazzle': { off: 0, def: 1, util: 3 },
  'Focus Serenity': { off: 0, def: 3, util: 0 },
  'Focus Harmony': { off: 3, def: 0, util: 0 },
};

/**
 * Value of a set of effects applied to one spell. Cooldowns are summed first so the 50 % floor
 * applies; `stage` is the revelation stage for revelation spells.
 */
export function spellBundleParts(v: ValuationContext, spell: string, effects: SpellEffect[], stage = 3): Parts {
  const s = v.model.spells.get(spell);
  if (!s) return ZERO;
  if (s.avatar) return avatarParts(v, stage, effects.filter((e) => e.kind === 'cd').reduce((a, e) => a + e.amount, 0));
  if (s.revelation >= 0 && stage < 1) return ZERO;
  let off = 0;
  let dfn = 0;
  let util = 0;
  let cd = 0;
  const share = damageShare(v.model, spell, stage);
  const hs = s.kind === 'healing' ? healShare(v.model, spell) : 0;
  for (const e of effects) {
    switch (e.kind) {
      case 'dmg':
        off += (e.amount * share) / 100;
        break;
      case 'critDmg':
        off += (e.amount * K.CRIT_CHANCE * share) / 100;
        break;
      case 'critChance':
        off += (e.amount * K.CRIT_EXTRA * share) / 100;
        break;
      case 'leech':
        dfn += (e.amount * K.LIFE_LEECH_DEF * share) / 100;
        break;
      case 'area':
        if (v.context.mode === 'hunt') off += (K.AREA_GAIN * share) / 100;
        break;
      case 'jumps': {
        if (v.context.mode === 'boss' || !s.meta) break;
        const t = targetsAt(v.model, s, stage);
        const pool = v.context.huntStyle === 'solo' ? t + e.amount * 0.5 : v.context.huntStyle === 'teamLure' ? 5 : 9;
        const nt = Math.min(s.meta.maxTargets + e.amount, Math.max(t, pool));
        off += share * (nt / t - 1);
        break;
      }
      case 'heal':
        dfn += e.amount * hs * K.HEAL_DEF;
        break;
      case 'mana':
        util += e.amount * K.MANA_COST_UTIL;
        break;
      case 'duration':
        util += 1;
        break;
      case 'defHit':
        dfn += 0.5;
        break;
      case 'cd':
        cd += e.amount;
        break;
    }
  }
  if (cd > 0) {
    const base = baseCooldown(spell, stage);
    if (base) {
      const g = cooldownGain(base, cd);
      if (s.kind === 'damage') off += share * g;
      else if (s.kind === 'healing') dfn += 100 * hs * K.HEAL_DEF * g;
      else {
        const sup = SUPPORT_VALUE[spell] ?? { off: 1, def: 0, util: 1 };
        off += sup.off * g;
        dfn += sup.def * g;
        util += sup.util * g;
      }
    }
  }
  return { off, def: dfn * v.threat, util };
}

/** Avatar value: boss mode only. Burst window share of a boss fight × fights covered by the cooldown. */
export function avatarParts(v: ValuationContext, stage: number, cdReduction = 0): Parts {
  if (v.context.mode !== 'boss' || stage < 1) return ZERO;
  const extra = [0.05, 0.1, 0.15][stage - 1];
  const cdMin = Math.max([120, 90, 60][stage - 1] * 0.5, [120, 90, 60][stage - 1] - cdReduction / 60);
  const fights = Math.min(1, K.BOSS_INTERVAL_MIN / cdMin);
  const uptime = K.AVATAR_DURATION_S / K.BOSS_FIGHT_S;
  const boost = (1 + K.CRIT_EXTRA + extra) / (1 + K.CRIT_CHANCE * K.CRIT_EXTRA) - 1;
  return { off: 100 * uptime * boost * fights, def: 100 * uptime * extra * fights * v.threat, util: 0 };
}

// ---------------------------------------------------------------------------
// Convictions and revelations

type UniqueFn = (v: ValuationContext) => Parts;
const crowd = (c: FightContext) =>
  c.mode === 'boss' ? 0.1 : c.huntStyle === 'solo' ? 0.3 : c.huntStyle === 'teamLure' ? 0.5 : 0.8;
const team = (c: FightContext) => c.mode === 'hunt' && c.huntStyle !== 'solo';

const UNIQUE: Record<string, UniqueFn> = {
  'Battle Instinct': (v) => ({ off: 1.5 * crowd(v.context), def: 2.5 * crowd(v.context) * v.threat, util: 0 }),
  'Battle Healing': (v) => ({ off: 0, def: 15 * K.HEAL_DEF * v.threat, util: 0 }),
  'Positional Tactics': () => ({ off: 2, def: 0, util: 0 }),
  'Ballistic Mastery': () => ({ off: 2.5, def: 0, util: 0 }),
  'Runic Mastery': () => ({ off: 1.5, def: 0, util: 0 }),
  'Focus Mastery': () => ({ off: 3, def: 0, util: 0.5 }),
  'Healing Link': (v) => ({ off: 0, def: (team(v.context) ? 2.5 : v.context.mode === 'boss' ? 1 : 0.5) * v.threat, util: 0 }),
  'Guiding Presence': (v) => (team(v.context) ? { off: 1, def: 0, util: 5 } : ZERO),
  Sanctuary: (v) => ({ off: 6, def: 1 * v.threat, util: 0 }),
};

/** Conviction value of a non-augment, non-RM, non-vessel tile. */
export function convictionParts(v: ValuationContext, t: WheelTile): Parts {
  const c = t.conviction;
  switch (c.category) {
    case 'leech': {
      const pct = c.numericValue ?? c.value / 100;
      return /mana/i.test(c.name)
        ? { off: pct * K.MANA_LEECH_OFF, def: pct * K.MANA_LEECH_DEF * v.threat, util: 0 }
        : def(v, pct * K.LIFE_LEECH_DEF);
    }
    case 'skillBonus':
      return { off: (c.numericValue ?? 1) * K.SKILL_OFF, def: 0, util: 0 };
    case 'unique':
      return UNIQUE[c.name]?.(v) ?? { off: 1, def: 1, util: 0 };
    default:
      return ZERO;
  }
}

/** Augment stage values: [stage I, stage II increment]. */
export function augmentParts(v: ValuationContext, t: WheelTile): [Parts, Parts] {
  const a = t.conviction.augment;
  if (!a) return [ZERO, ZERO];
  const e1 = parseEffects(a.stage1);
  const e2 = parseEffects(a.stage2);
  let one = ZERO;
  let both = ZERO;
  for (const spell of a.spells) {
    one = add(one, spellBundleParts(v, spell, e1));
    both = add(both, spellBundleParts(v, spell, [...e1, ...e2]));
  }
  return [one, sub(both, one)];
}

const stageVal = (arr: number[], stage: number) => arr[stage - 1];

/** Revelation value at `stage` (1..3), including the flat damage/healing bonus. */
export function revelationParts(v: ValuationContext, r: EngineRevelation, stage: number): Parts {
  if (stage < 1) return ZERO;
  const flat = flatParts(v, REVELATION_FLAT_BONUS[stage]);
  const d = r.data;
  let p: Parts;
  if (d.isAvatar) p = avatarParts(v, stage);
  else if (d.spells.length) {
    let best = 0;
    let sum = 0;
    for (const s of d.spells) {
      const sh = damageShare(v.model, s, stage);
      best = Math.max(best, sh);
      sum += sh;
    }
    p = { off: Math.max(best, sum), def: 0, util: 0 };
  } else p = passiveRevelation(v, d.name, stage, d.affectsSpells);
  return add(p, flat);
}

function passiveRevelation(v: ValuationContext, name: string, stage: number, affects: string[]): Parts {
  const th = v.threat;
  switch (name) {
    case 'Gift of Life':
      return { off: 0, def: stageVal([3, 4.5, 6], stage) * th * (v.context.mode === 'boss' ? 1.3 : 1), util: 0 };
    case 'Combat Mastery':
      return { off: stageVal([3, 3.6, 4.2], stage), def: stageVal([2, 2.4, 2.8], stage) * th, util: 0 };
    case 'Divine Empowerment': {
      const cd = [32, 28, 24][stage - 1];
      return { off: stageVal([8, 10, 12], stage) * Math.min(1, 5 / cd), def: 0, util: 0 };
    }
    case 'Beam Mastery': {
      let off = 0;
      let hits = 0;
      for (const b of affects) {
        const s = v.model.spells.get(b);
        if (!s) continue;
        const share = damageShare(v.model, b, stage);
        const central = Math.max(s.targets, BEAM_CENTRAL_REACH);
        const total = central + s.outerTargets;
        const bonus = Math.min(stageVal([30, 36, 42], stage), stageVal([10, 12, 14], stage) * total);
        off += (share * bonus) / 100 + share * (stageVal([25, 40, 70], stage) / 100) * (s.outerTargets / central);
        hits = Math.max(hits, total);
      }
      return { off: off + Math.min(3, hits) * 0.5, def: 0, util: 0 };
    }
    case 'Lord of Destruction': {
      const m = v.monster;
      const e = Math.max(elementMultiplier(m, 'fire'), elementMultiplier(m, 'energy'), elementMultiplier(m, 'death'));
      return { off: stageVal([2, 3, 4], stage) * e, def: 0, util: 0 };
    }
    case 'Blessing of the Grove':
      return { off: 0, def: stageVal([3.5, 4.5, 6], stage) * th * (team(v.context) ? 1.5 : 1), util: 0 };
    case 'Ascetic':
      return { off: stageVal([2, 3.5, 5], stage), def: 0, util: 0 };
    default:
      return { off: stageVal([1, 2, 3], stage), def: 0, util: 0 };
  }
}

// ---------------------------------------------------------------------------
// Gem mods

/** Value of a basic mod at grade 1..4. */
export function basicModParts(
  v: ValuationContext,
  mod: { effects: { effectId: number; values: (number | null)[] }[] },
  grade: number,
): Parts {
  let p = ZERO;
  for (const e of mod.effects) {
    const x = e.values[grade - 1] ?? 0;
    const el = RESIST_EFFECT[e.effectId];
    if (el) p = add(p, resistParts(v, el, x));
    else if (e.effectId === EFFECT_MITIGATION) p = add(p, mitigationParts(v, x));
    else if (e.effectId === EFFECT_HP) p = add(p, hpParts(v, x));
    else if (e.effectId === EFFECT_MANA) p = add(p, manaParts(v, x));
    else if (e.effectId === EFFECT_CAPACITY) p = add(p, { off: 0, def: 0, util: x * K.CAP_UTIL });
  }
  return p;
}

/** Wheel build facts a supreme mod value depends on. */
export interface BuildFacts {
  /** Revelation stage per domain (DOMAIN_ORDER index). */
  stages: number[];
  /** Effective revelation points per domain (grid + Revelation Mastery). */
  revPoints: number[];
  /** Augment effects granted by the wheel, per spell. */
  wheelEffects: Map<string, SpellEffect[]>;
}

export function supremeEffects(m: WheelSupremeMod, grade: number): SpellEffect[] {
  const x = Math.abs(m.values[grade - 1] ?? 0);
  switch (m.category) {
    case 'augDamage':
      return [{ kind: 'dmg', amount: x }];
    case 'augCrit':
      return [{ kind: 'critDmg', amount: x }];
    case 'augHealing':
      return [{ kind: 'heal', amount: x }];
    case 'augCooldown':
      return [{ kind: 'cd', amount: x }];
    default:
      return [];
  }
}

export function revelationIndex(revs: EngineRevelation[], name: string | null): number {
  return name ? revs.findIndex((r) => r.data.name === name) : -1;
}

/** Value of a supreme mod at grade 1..4 for the given build. */
export function supremeModParts(
  v: ValuationContext,
  revs: EngineRevelation[],
  facts: BuildFacts,
  m: WheelSupremeMod,
  grade: number,
): Parts {
  const x = m.values[grade - 1] ?? 0;
  if (m.category === 'effect') {
    if (/dodge/i.test(m.name)) return def(v, x * K.DODGE_DEF);
    if (/critical/i.test(m.name)) return { off: x * K.CRIT_CHANCE, def: 0, util: 0 };
    if (/life leech/i.test(m.name)) return def(v, x * K.LIFE_LEECH_DEF);
    if (/mana leech/i.test(m.name)) return { off: x * K.MANA_LEECH_OFF, def: x * K.MANA_LEECH_DEF * v.threat, util: 0 };
    return ZERO;
  }
  if (m.category === 'revelationMastery') {
    const d = revelationIndex(revs, m.revelation);
    if (d < 0) return ZERO;
    const before = facts.stages[d];
    const after = stageFor(facts.revPoints[d] + x);
    return sub(revelationParts(v, revs[d], after), revelationParts(v, revs[d], before));
  }
  const spell = m.spell;
  if (!spell) return ZERO;
  const d = revelationIndex(revs, m.revelation);
  const stage = d >= 0 ? facts.stages[d] : 3;
  if (v.model.spells.get(spell)?.avatar && v.context.mode !== 'boss') return ZERO;
  const wheel = facts.wheelEffects.get(spell) ?? [];
  let p = sub(
    spellBundleParts(v, spell, [...wheel, ...supremeEffects(m, grade)], stage),
    spellBundleParts(v, spell, wheel, stage),
  );
  if (m.momentum) {
    const mom = m.momentum[grade - 1] ?? MOMENTUM_PER_GRADE[grade - 1] ?? 0;
    p = add(p, { off: mom * K.MOMENTUM_OFF, def: mom * K.MOMENTUM_DEF * v.threat, util: 0 });
  }
  return p;
}
