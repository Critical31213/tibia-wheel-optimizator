/**
 * Perk valuation. Units: `off` = % of total damage per turn (ΔT / T0, real formulas, see spells.ts),
 * `def` = survivability units (see K and docs/modules/engine.md), `util` = convenience (mana, capacity).
 */
import type { Element, FightContext, Monster, Vocation } from '../types';
import type { WheelSupremeMod, WheelTile } from '../data/wheel';
import { maxHitPoints, maxMana, mitigationPercent } from '../data/character';
import {
  cooldownGain,
  damageShare,
  deltaOff,
  healShare,
  NO_MODS,
  NO_STAGES,
  type RotationInput,
  type SpellModel,
  type SpellMods,
  spellCooldown,
  spotElementMultiplier,
} from './spells';
import { MOMENTUM_PER_GRADE, REVELATION_FLAT_BONUS, stageFor, type EngineRevelation } from './wheel/build';

export interface Parts {
  off: number;
  def: number;
  util: number;
}

export const ZERO: Parts = { off: 0, def: 0, util: 0 };

export const K = {
  /** Per +1 % of max HP, × spike factor (HP is a buffer against spikes). */
  HP_DEF: 1,
  /**
   * Per +1 percentage point of damage reduction on all incoming damage. Reduction works on every hit
   * (sustain: less healing and mana needed) as well as on spikes, hence > HP_DEF.
   */
  DR_DEF: 3,
  /** Spike = this × level when no monster max damage is known. */
  SPIKE_PER_LEVEL: 3,
  /** Spike factor = clamp(SPIKE_HP × spike / maxHP, min, max). */
  SPIKE_HP: 2,
  SPIKE_MIN: 0.25,
  SPIKE_MAX: 1.5,
  /** Leech is strongly devalued (D14). Per +1 % leech. */
  LIFE_LEECH_DEF: 0.15,
  MANA_LEECH_OFF: 0.1,
  MANA_LEECH_DEF: 0.05,
  /** Per +1 % of max mana: convenience only (a bigger pool does not raise damage). */
  MANA_UTIL: 0.01,
  /** Per +1 % of max HP: universal tie-break so HP beats mana even at priority 0. */
  HP_UTIL: 0.02,
  /** Per +1 % healing output. */
  HEAL_DEF: 0.3,
  CAP_UTIL: 0.002,
  MANA_COST_UTIL: 0.05,
  /** Larger area / shape: extra targets while hunting. */
  AREA_TARGETS: 1,
  /** Per +1 % momentum. */
  MOMENTUM_OFF: 0.5,
  MOMENTUM_DEF: 0.2,
  /** Avatar: boss fight length (s), typical interval between boss fights (min), duration (s). */
  BOSS_FIGHT_S: 120,
  BOSS_INTERVAL_MIN: 30,
  AVATAR_DURATION_S: 15,
} as const;

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

export interface ValuationContext {
  vocation: Vocation;
  context: FightContext;
  /** Representative monster (single monster, or a weighted "spot" aggregate), null = generic. */
  monster: Monster | null;
  model: SpellModel;
  level: number;
  /** Defense multiplier from monster max damage. */
  threat: number;
  /** Base max HP / mana at the level. */
  hp: number;
  mana: number;
  /** Base mitigation (%) from shielding/defense. */
  mitigation: number;
  /** clamp(2 × spike / maxHP): how much a bigger HP buffer matters. */
  spikeFactor: number;
  /** Share of incoming damage per element (weighted over the spot). */
  incoming: Partial<Record<Element, number>>;
  /** Δ% damage of +1 main skill / magic level (skill boost convictions). */
  skillOff: number;
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

/** Weighted share of incoming damage per element over a spot (generic shares without monsters). */
export function incomingShares(monsters: { monster: Monster; weight: number }[]): Partial<Record<Element, number>> {
  const known = monsters.filter((m) => m.monster.damageTypes.some((t) => t !== 'healing'));
  if (!known.length) return { ...GENERIC_INCOMING };
  const total = known.reduce((s, m) => s + m.weight, 0);
  const out: Partial<Record<Element, number>> = {};
  for (const { monster, weight } of known) {
    const types = monster.damageTypes.filter((t) => t !== 'healing');
    for (const t of types) out[t] = (out[t] ?? 0) + weight / total / types.length;
  }
  return out;
}

export function incomingShare(v: Pick<ValuationContext, 'incoming'>, e: Element): number {
  return v.incoming[e] ?? 0;
}

/** Aggregated "spot" monster: weighted element modifiers / max damage, union of damage types. */
export function spotMonster(monsters: { monster: Monster; weight: number }[]): Monster | null {
  if (!monsters.length) return null;
  if (monsters.length === 1) return monsters[0].monster;
  const elems = new Set(monsters.flatMap((m) => Object.keys(m.monster.elementModifiers) as Element[]));
  const elementModifiers: Partial<Record<Element, number>> = {};
  for (const e of elems) elementModifiers[e] = Math.round(spotElementMultiplier(monsters, e) * 1000) / 10;
  const withDmg = monsters.filter((m) => m.monster.maxDamage);
  const wd = withDmg.reduce((s, m) => s + m.weight, 0);
  const sorted = [...monsters].sort((a, b) => b.weight - a.weight || a.monster.name.localeCompare(b.monster.name));
  return {
    id: monsters.map((m) => m.monster.id).join('+'),
    name: sorted.map((m) => m.monster.name).join(' / '),
    elementModifiers,
    damageTypes: [...new Set(monsters.flatMap((m) => m.monster.damageTypes))],
    maxDamage: wd > 0 ? Math.round(withDmg.reduce((s, m) => s + m.weight * m.monster.maxDamage!, 0) / wd) : undefined,
  };
}

export function spikeFactor(vocation: Vocation, level: number, monsters: { monster: Monster; weight: number }[]): number {
  const withDmg = monsters.filter((m) => m.monster.maxDamage);
  const wd = withDmg.reduce((s, m) => s + m.weight, 0);
  const spike = wd > 0 ? withDmg.reduce((s, m) => s + m.weight * m.monster.maxDamage!, 0) / wd : K.SPIKE_PER_LEVEL * level;
  return Math.min(K.SPIKE_MAX, Math.max(K.SPIKE_MIN, (K.SPIKE_HP * spike) / maxHitPoints(vocation, level)));
}

/** Base character facts for valuation. */
export function characterFacts(vocation: Vocation, level: number, shielding: number) {
  return { hp: maxHitPoints(vocation, level), mana: maxMana(vocation, level), mitigation: mitigationPercent(vocation, level, { shielding }) };
}

const def = (v: ValuationContext, x: number): Parts => ({ off: 0, def: x * v.threat, util: 0 });

export function hpParts(v: ValuationContext, hp: number): Parts {
  const pct = (100 * hp) / v.hp;
  return { off: 0, def: pct * K.HP_DEF * v.spikeFactor * v.threat, util: pct * K.HP_UTIL };
}

export function manaParts(v: ValuationContext, mana: number): Parts {
  const pct = (100 * mana) / v.mana;
  return { off: 0, def: 0, util: pct * K.MANA_UTIL };
}

/** Extra damage reduction (percentage points) from a +`multiplierPct` % mitigation multiplier. */
export function mitigationGain(v: Pick<ValuationContext, 'mitigation'>, multiplierPct: number): number {
  return (v.mitigation * multiplierPct) / 100;
}

/** Damage reduction in percentage points, valued as relative reduction of damage taken. */
export function reductionParts(v: ValuationContext, pp: number): Parts {
  return def(v, (pp / Math.max(0.5, 1 - v.mitigation / 100)) * K.DR_DEF);
}

export function mitigationParts(v: ValuationContext, multiplierPct: number): Parts {
  return reductionParts(v, mitigationGain(v, multiplierPct));
}

export function resistParts(v: ValuationContext, e: Element, pct: number): Parts {
  return def(v, pct * K.DR_DEF * incomingShare(v, e));
}

/** Flat damage & healing bonus: real per-hit damage (× bonus factor × targets) and healing per cast. */
export function flatParts(v: ValuationContext, flat: number): Parts {
  return { off: flat * v.model.flatOffPerPoint, def: flat * v.model.flatHealPerPoint * K.HEAL_DEF * v.threat, util: 0 };
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

function toMods(effects: SpellEffect[], hunt: boolean): SpellMods {
  const m = { ...NO_MODS };
  for (const e of effects) {
    if (e.kind === 'dmg') m.pct += e.amount;
    else if (e.kind === 'critChance') m.critChance += e.amount;
    else if (e.kind === 'critDmg') m.critExtra += e.amount;
    else if (e.kind === 'cd') m.cd += e.amount;
    else if (hunt && e.kind === 'jumps') m.extraTargets += e.amount;
    else if (hunt && e.kind === 'area') m.extraTargets += K.AREA_TARGETS;
  }
  return m;
}

/** Stages vector with the domain of `spell` set to `stage` (if any). */
export function stagesFor(model: SpellModel, spell: string, stage: number): number[] {
  const s = model.spells.get(spell);
  const out = [...NO_STAGES];
  if (s && s.stageDomain >= 0) out[s.stageDomain] = stage;
  return out;
}

/**
 * Value of a set of effects applied to one spell against the rotation at `stages`. Cooldowns are summed
 * first so the 50 % floor applies. Damage spells: Δ rotation damage (D16: single-target spells in hunt = 0).
 */
export function spellBundleParts(v: ValuationContext, spell: string, effects: SpellEffect[], stages: readonly number[] = NO_STAGES): Parts {
  const s = v.model.spells.get(spell);
  if (!s) return ZERO;
  const stage = s.stageDomain >= 0 ? stages[s.stageDomain] : 3;
  if (s.avatar) return avatarParts(v, stage, effects.filter((e) => e.kind === 'cd').reduce((a, e) => a + e.amount, 0));
  if (s.revelation >= 0 && stage < 1) return ZERO;
  if (s.kind === 'damage') {
    if (!s.usable) return ZERO;
    const base: RotationInput = { stages };
    const mods = new Map([[spell, toMods(effects, v.context.mode === 'hunt')]]);
    const off = deltaOff(v.model, { stages, mods }, base);
    const leech = effects.filter((e) => e.kind === 'leech').reduce((a, e) => a + e.amount, 0);
    let dfn = 0;
    if (leech > 0) dfn += (leech * K.LIFE_LEECH_DEF * damageShare(v.model, spell, stages)) / 100;
    if (effects.some((e) => e.kind === 'defHit')) dfn += 0.5;
    const util = effects.reduce((a, e) => a + (e.kind === 'mana' ? e.amount * K.MANA_COST_UTIL : 0), 0);
    return { off, def: dfn * v.threat, util };
  }
  let off = 0;
  let dfn = 0;
  let util = 0;
  let cd = 0;
  const hs = s.kind === 'healing' ? healShare(v.model, spell) : 0;
  for (const e of effects) {
    if (e.kind === 'heal') dfn += e.amount * hs * K.HEAL_DEF;
    else if (e.kind === 'mana') util += e.amount * K.MANA_COST_UTIL;
    else if (e.kind === 'duration') util += 1;
    else if (e.kind === 'defHit') dfn += 0.5;
    else if (e.kind === 'cd') cd += e.amount;
    else if (e.kind === 'jumps' && s.kind === 'support') util += e.amount * 0.5;
    else if (e.kind === 'area' && s.kind === 'healing' && v.context.mode === 'hunt' && v.context.huntStyle !== 'solo') dfn += 100 * hs * K.HEAL_DEF * 0.1;
  }
  if (cd > 0) {
    const g = cooldownGain(spellCooldown(spell, stage), cd);
    if (s.kind === 'healing') dfn += 100 * hs * K.HEAL_DEF * g;
    else {
      const sup = SUPPORT_VALUE[spell] ?? { off: 1, def: 0, util: 1 };
      off += sup.off * g;
      dfn += sup.def * g;
      util += sup.util * g;
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
  const boost = (1 + 0.5 + extra) / (1 + 0.1 * 0.5) - 1;
  return { off: 100 * uptime * boost * fights, def: 100 * uptime * extra * fights * K.DR_DEF * v.threat, util: 0 };
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
      return { off: (c.numericValue ?? 1) * v.skillOff, def: 0, util: 0 };
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
  else {
    const stages = [...NO_STAGES];
    stages[r.domainIdx] = stage;
    const off = deltaOff(v.model, { stages }, { stages: NO_STAGES });
    p = add({ off, def: 0, util: 0 }, passiveRevelation(v, d.name, stage));
  }
  return add(p, flat);
}

/** Effects not covered by the rotation model (defensive / support revelations). */
function passiveRevelation(v: ValuationContext, name: string, stage: number): Parts {
  const th = v.threat;
  switch (name) {
    case 'Gift of Life':
      return { off: 0, def: stageVal([3, 4.5, 6], stage) * th * (v.context.mode === 'boss' ? 1.3 : 1), util: 0 };
    case 'Combat Mastery':
      return { off: 0, def: stageVal([2, 2.4, 2.8], stage) * th, util: 0 };
    case 'Divine Empowerment': {
      const cd = [32, 28, 24][stage - 1];
      return { off: stageVal([8, 10, 12], stage) * Math.min(1, 5 / cd), def: 0, util: 0 };
    }
    case 'Blessing of the Grove':
      return { off: 0, def: stageVal([3.5, 4.5, 6], stage) * th * (team(v.context) ? 1.5 : 1), util: 0 };
    default:
      return ZERO;
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
    if (/dodge/i.test(m.name)) return reductionParts(v, x);
    if (/critical/i.test(m.name)) return { off: deltaOff(v.model, { stages: facts.stages, critExtra: x }, { stages: facts.stages }), def: 0, util: 0 };
    if (/life leech/i.test(m.name)) return def(v, x * K.LIFE_LEECH_DEF);
    if (/mana leech/i.test(m.name)) return { off: x * K.MANA_LEECH_OFF, def: x * K.MANA_LEECH_DEF * v.threat, util: 0 };
    return ZERO;
  }
  if (m.category === 'revelationMastery') {
    const d = revelationIndex(revs, m.revelation);
    if (d < 0) return ZERO;
    const before = stageFor(facts.revPoints[d]);
    const after = stageFor(facts.revPoints[d] + x);
    return sub(revelationParts(v, revs[d], after), revelationParts(v, revs[d], before));
  }
  const spell = m.spell;
  if (!spell) return ZERO;
  if (v.model.spells.get(spell)?.avatar && v.context.mode !== 'boss') return ZERO;
  const wheel = facts.wheelEffects.get(spell) ?? [];
  let p = sub(
    spellBundleParts(v, spell, [...wheel, ...supremeEffects(m, grade)], facts.stages),
    spellBundleParts(v, spell, wheel, facts.stages),
  );
  if (m.momentum) {
    const mom = m.momentum[grade - 1] ?? MOMENTUM_PER_GRADE[grade - 1] ?? 0;
    p = add(p, { off: mom * K.MOMENTUM_OFF, def: mom * K.MOMENTUM_DEF * v.threat, util: 0 });
  }
  return p;
}
