/**
 * Perk valuation. Units: `off` = % of total damage per turn (ΔT / reference rotation, real formulas, see spells.ts),
 * `def` = % of effective HP (D18: EHP = HP / (1 − mitigation)) × threat, `util` = convenience.
 * Capacity and max mana have no value (D18).
 */
import type { Element, FightContext, Monster, Vocation } from '../types';
import type { WheelSupremeMod, WheelTile } from '../data/wheel';
import { maxHitPoints, maxMana, mitigationPercent, type Offhand } from '../data/character';
import {
  AREA_AUGMENT,
  cooldownGain,
  damageShare,
  deltaOff,
  healPerCast,
  healShare,
  HEAL_SHARE,
  NO_MODS,
  NO_STAGES,
  type RotationInput,
  type SpellModel,
  type SpellMods,
  spellCooldown,
  spotElementMultiplier,
  AUTO_ATTACK_TARGETS,
  rotation,
  targetsAt,
  TEAM_HEALS,
} from './spells';
import { TURN_SECONDS } from '../data/damage';
import { MOMENTUM_PER_GRADE, REVELATION_FLAT_BONUS, stageFor, type EngineRevelation } from './wheel/build';

export interface Parts {
  off: number;
  def: number;
  util: number;
}

export const ZERO: Parts = { off: 0, def: 0, util: 0 };

export const K = {
  /** +1 % output of a healing spell = this × its share of your healing, in % EHP (sustain; overheal discounted). */
  HEAL_EHP: 0.5,
  /** D29: imbuement life leech % (EK/RP/monk: 2× Powerful Vampirism; ED/MS: sometimes, so half). */
  LIFE_LEECH_IMBUE: { knight: 50, paladin: 50, monk: 50, sorcerer: 25, druid: 25 } as Record<Vocation, number>,
  MANA_LEECH_OFF: 0.1,
  MANA_LEECH_DEF: 0.05,
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

/** Share of incoming damage per element without monster data (D18: physical). */
const GENERIC_INCOMING: Partial<Record<Element, number>> = { physical: 1 };

export interface ValuationContext {
  vocation: Vocation;
  context: FightContext;
  /** Representative monster (single monster, or a weighted "spot" aggregate), null = generic. */
  monster: Monster | null;
  model: SpellModel;
  level: number;
  /** Uniform defense multiplier from monster max damage. */
  threat: number;
  /** D29: % EHP per +1 % damage (life leech). */
  leech: number;
  /** Base max HP / mana at the level. */
  hp: number;
  mana: number;
  /** Base mitigation (%) with the rotation's offhand (D19). */
  mitigation: number;
  /** Base mitigation (%) with the vocation's default offhand (EHP reference across rotations). */
  mitigationRef: number;
  /** D21: forced spells (utility augments keep their value). */
  forced: ReadonlySet<string>;
  /** D69: cooldown cuts (s) already in the model (the plan's rotation augments): their augments' cooldown effect counts 0. */
  preCd?: ReadonlyMap<string, number>;
  /** Exactly evaluated unique convictions (Positional Tactics, Ballistic Mastery). */
  unique: Partial<Record<string, Parts>>;
  /** Share of incoming damage per element (weighted over the spot). */
  incoming: Partial<Record<Element, number>>;
  /** D74: resistances % of the user's equipment (undefined = none known). */
  resist?: Partial<Record<Element, number>>;
  /** Δ% damage of +1 main skill / magic level (skill boost convictions). */
  skillOff: number;
  /** D24: % EHP (× threat) of the active stances beyond shielding (damage taken, dodge, healing). */
  stanceDef?: number;
  /** D45: sustain of the weapon loadout not in the spell model (leech, healing). */
  weapon?: Parts;
}

export function add(a: Parts, b: Parts, k = 1): Parts {
  return { off: a.off + b.off * k, def: a.def + b.def * k, util: a.util + b.util * k };
}

export function sub(a: Parts, b: Parts): Parts {
  return add(a, b, -1);
}

/**
 * D29: % EHP per +1 % damage via imbuement life leech. Leech per hit (the game) =
 * damage × leech × (0.1n + 0.9) / n for n targets; its share of sustain vs the main heal cast every turn × HEAL_EHP.
 */
export function leechEhp(model: SpellModel, threat: number, lifeLeech = lifeLeechOf(model)): number {
  const f = (n: number) => (0.1 * Math.max(1, n) + 0.9) / Math.max(1, n);
  const r = rotation(model, { stages: NO_STAGES });
  let dmg = model.base * f(model.autoTargets ?? (model.context.mode === 'boss' ? 1 : AUTO_ATTACK_TARGETS[model.vocation]));
  for (const [name, x] of r.rates) {
    const s = model.spells.get(name);
    if (s) dmg += x.rate * x.perCast * f(targetsAt(model, s, 0));
  }
  const leech = (dmg * lifeLeech) / 100 / TURN_SECONDS;
  let heal = 0;
  let best = -1;
  for (const s of model.spells.values()) {
    const sh = HEAL_SHARE[s.name] ?? 0.2;
    if (s.kind !== 'healing' || TEAM_HEALS.has(s.name) || sh <= best) continue;
    best = sh;
    heal = healPerCast(model, s.name) / TURN_SECONDS;
  }
  return leech > 0 ? (leech / (leech + heal)) * K.HEAL_EHP * threat : 0;
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

/** Worn offhand: kind and defense (undefined = typical for the level). */
export interface OffhandChoice {
  offhand?: Offhand;
  defense?: number;
}

/**
 * Base character facts for valuation: mitigation with the given offhand (else the D19 default); the reference
 * uses `ref` (D74: the user's offhand), else the vocation default.
 */
export function characterFacts(vocation: Vocation, level: number, shielding: number, oh: OffhandChoice = {}, ref: OffhandChoice = {}) {
  return {
    hp: maxHitPoints(vocation, level),
    mana: maxMana(vocation, level),
    mitigation: mitigationPercent(vocation, level, { shielding, offhand: oh.offhand, offhandDefense: oh.defense }),
    mitigationRef: mitigationPercent(vocation, level, { shielding, offhand: ref.offhand, offhandDefense: ref.defense }),
  };
}

const def = (v: Pick<ValuationContext, 'threat'>, x: number): Parts => ({ off: 0, def: x * v.threat, util: 0 });

/** D74: life leech % of the imbuements (the user's equipment, else the D29 default). */
export const lifeLeechOf = (model: SpellModel) => model.gear?.lifeLeech ?? K.LIFE_LEECH_IMBUE[model.vocation];

const leechPerPoint = new WeakMap<SpellModel, number>();

/**
 * D31: % EHP (before threat) per +1 pp life leech = the same leech growth as +100/imbue % damage (D29).
 * D74: without any leech, the value of the first point (+1 pp).
 */
export function leechPoint(v: ValuationContext): number {
  const imbue = lifeLeechOf(v.model);
  if (imbue > 0) return (v.leech / Math.max(1e-9, v.threat)) * (100 / imbue);
  let x = leechPerPoint.get(v.model);
  if (x === undefined) {
    x = (leechEhp(v.model, v.threat, 1) / Math.max(1e-9, v.threat)) * 100;
    leechPerPoint.set(v.model, x);
  }
  return x;
}

/** +HP → % EHP gain = HP / base HP. */
export function hpParts(v: Pick<ValuationContext, 'hp' | 'threat'>, hp: number): Parts {
  return def(v, (100 * hp) / v.hp);
}

/** Extra damage reduction (percentage points) from a +`multiplierPct` % mitigation multiplier. */
export function mitigationGain(v: Pick<ValuationContext, 'mitigation'>, multiplierPct: number): number {
  return (v.mitigation * multiplierPct) / 100;
}

/** Damage reduction (mitigation, dodge) in percentage points → % EHP gain = pp / (100 − mitigation). */
export function reductionParts(v: Pick<ValuationContext, 'mitigation' | 'threat'>, pp: number): Parts {
  return def(v, (100 * pp) / Math.max(50, 100 - v.mitigation));
}

export function mitigationParts(v: Pick<ValuationContext, 'mitigation' | 'threat'>, multiplierPct: number): Parts {
  return reductionParts(v, mitigationGain(v, multiplierPct));
}

/**
 * Elemental resistance: like damage reduction, × the element's share of incoming damage. D74: with equipment
 * resistances the share is of the damage still taken (Σ share × (1 − resist)); D80: a new protection multiplies the
 * element's remaining damage (1 − resist), as protections stack multiplicatively.
 */
export function resistParts(v: Pick<ValuationContext, 'mitigation' | 'threat' | 'incoming' | 'resist'>, e: Element, pct: number): Parts {
  let taken = 1;
  let left = 1;
  if (v.resist) {
    taken = 0;
    for (const [k, s] of Object.entries(v.incoming) as [Element, number][]) taken += s * Math.max(0.05, 1 - (v.resist[k] ?? 0) / 100);
    left = Math.max(0.05, 1 - (v.resist[e] ?? 0) / 100);
  }
  return { ...ZERO, def: (reductionParts(v, pct).def * incomingShare(v, e) * left) / Math.max(0.05, taken) };
}

/** Flat damage & healing bonus: real per-hit damage (× bonus factor × targets) and healing per cast. */
export function flatParts(v: ValuationContext, flat: number): Parts {
  return { off: flat * v.model.flatOffPerPoint, def: flat * v.model.flatHealPerPoint * K.HEAL_EHP * v.threat, util: 0 };
}

/** Value of ONE dedication point of a tile (mana id 1 and capacity id 3 have no value, D18). */
export function dedicationParts(v: ValuationContext, t: WheelTile): Parts {
  let p = ZERO;
  for (const d of t.dedication.perks) {
    if (d.id === 0) p = add(p, hpParts(v, d.perPoint));
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

export function parseEffects(textValue: string): SpellEffect[] {
  const out: SpellEffect[] = [];
  for (const [re, kind] of EFFECT_PATTERNS) {
    const m = re.exec(textValue);
    if (m) out.push({ kind, amount: m[1] !== undefined ? Math.abs(Number(m[1])) : 1 });
  }
  if (AREA_AUGMENT.test(textValue)) out.push({ kind: 'area', amount: 1 });
  return out;
}

/** Support spells that only give utility: augments worth 0 unless the spell is forced (D20/D21). */
export const UTILITY_SPELLS = new Set(['Divine Dazzle']);

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

/**
 * Value of a set of effects applied to one spell against the rotation at `stages`. Cooldowns are summed
 * first so the 50 % floor applies. Damage spells: Δ rotation damage (D16: single-target spells in hunt = 0).
 * `others`: the build's effects on the other spells (D27), part of both sides of the delta.
 */
export function spellBundleParts(
  v: ValuationContext,
  spell: string,
  effects: SpellEffect[],
  stages: readonly number[] = NO_STAGES,
  others?: ReadonlyMap<string, SpellEffect[]>,
): Parts {
  const s = v.model.spells.get(spell);
  if (!s) return ZERO;
  const stage = s.stageDomain >= 0 ? stages[s.stageDomain] : 3;
  if (s.avatar) return avatarParts(v, stage, effects.filter((e) => e.kind === 'cd').reduce((a, e) => a + e.amount, 0));
  if (s.revelation >= 0 && stage < 1) return ZERO;
  if (UTILITY_SPELLS.has(spell) && !v.forced.has(spell)) return ZERO;
  if (s.kind === 'damage') {
    if (!s.usable) return ZERO;
    const hunt = v.context.mode === 'hunt';
    const otherMods = new Map<string, SpellMods>();
    for (const [n, e] of others ?? []) if (n !== spell && e.length) otherMods.set(n, toMods(e, hunt));
    const base: RotationInput = { stages, mods: otherMods };
    const mods = new Map([...otherMods, [spell, toMods(effects, hunt)]]);
    // A perk never lowers damage: with preset ratios a cooldown cut could otherwise shift casts to a weaker spell.
    const off = Math.max(0, deltaOff(v.model, { stages, mods }, base));
    const leech = effects.filter((e) => e.kind === 'leech').reduce((a, e) => a + e.amount, 0);
    let dfn = 0;
    if (leech > 0) dfn += (leech * leechPoint(v) * damageShare(v.model, spell, stages)) / 100;
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
    if (e.kind === 'heal') dfn += e.amount * hs * K.HEAL_EHP;
    else if (e.kind === 'mana') util += e.amount * K.MANA_COST_UTIL;
    else if (e.kind === 'duration') util += 1;
    else if (e.kind === 'defHit') dfn += 0.5;
    else if (e.kind === 'cd') cd += e.amount;
    else if (e.kind === 'jumps' && s.kind === 'support') util += e.amount * 0.5;
  }
  if (cd > 0) {
    const g = cooldownGain(spellCooldown(spell, stage), cd);
    if (s.kind === 'healing') dfn += 100 * hs * K.HEAL_EHP * g;
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
  return { off: 100 * uptime * boost * fights, def: ((100 * uptime * extra) / (1 - extra)) * fights * v.threat, util: 0 };
}

// ---------------------------------------------------------------------------
// Convictions and revelations

type UniqueFn = (v: ValuationContext) => Parts;
const crowd = (c: FightContext) => (c.mode === 'boss' ? 0.1 : 0.3);

const UNIQUE: Record<string, UniqueFn> = {
  'Battle Instinct': (v) => ({ off: 1.5 * crowd(v.context), def: 2.5 * crowd(v.context) * v.threat, util: 0 }),
  'Battle Healing': (v) => ({ off: 0, def: 9 * K.HEAL_EHP * v.threat, util: 0 }),
  'Positional Tactics': (v) => v.unique['Positional Tactics'] ?? ZERO,
  'Ballistic Mastery': (v) => v.unique['Ballistic Mastery'] ?? ZERO,
  'Runic Mastery': () => ({ off: 1.5, def: 0, util: 0 }),
  'Focus Mastery': () => ({ off: 3, def: 0, util: 0.5 }),
  'Healing Link': (v) => ({ off: 0, def: (v.context.mode === 'boss' ? 1 : 0.5) * v.threat, util: 0 }),
  // party-only perk; team hunts are no longer modelled (D20)
  'Guiding Presence': () => ZERO,
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
        : def(v, pct * leechPoint(v));
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
    const own = (e: SpellEffect[]) => (v.preCd?.has(spell) ? e.filter((x) => x.kind !== 'cd') : e);
    one = add(one, spellBundleParts(v, spell, own(e1)));
    both = add(both, spellBundleParts(v, spell, own([...e1, ...e2])));
  }
  return [one, sub(both, one)];
}

/** Spell mods of the filled augment slices (stage II when both copies are full), for the rotation display. */
export function augmentMods(v: ValuationContext, tiles: WheelTile[]): Map<string, SpellMods> {
  const copies = new Map<string, { tile: WheelTile; n: number }>();
  for (const t of tiles) {
    if (!t.conviction.augment) continue;
    const c = copies.get(t.conviction.name);
    if (c) c.n++;
    else copies.set(t.conviction.name, { tile: t, n: 1 });
  }
  const out = new Map<string, SpellMods>();
  for (const { tile, n } of copies.values()) {
    const a = tile.conviction.augment!;
    const effects = [...parseEffects(a.stage1), ...(n > 1 ? parseEffects(a.stage2) : [])];
    for (const spell of a.spells) {
      const prev = out.get(spell);
      const m = toMods(v.preCd?.has(spell) ? effects.filter((x) => x.kind !== 'cd') : effects, v.context.mode === 'hunt');
      out.set(spell, prev ? { pct: prev.pct + m.pct, critChance: prev.critChance + m.critChance, critExtra: prev.critExtra + m.critExtra, cd: prev.cd + m.cd, extraTargets: prev.extraTargets + m.extraTargets } : m);
    }
  }
  return out;
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
      // D29: halved while hunting (one death save per cooldown matters less than in a boss fight).
      return { off: 0, def: stageVal([3, 4.5, 6], stage) * th * (v.context.mode === 'boss' ? 1.3 : 0.5), util: 0 };
    case 'Combat Mastery':
      return { off: 0, def: stageVal([2, 2.4, 2.8], stage) * th, util: 0 };
    case 'Divine Empowerment': {
      const cd = [32, 28, 24][stage - 1];
      return { off: stageVal([8, 10, 12], stage) * Math.min(1, 5 / cd), def: 0, util: 0 };
    }
    case 'Blessing of the Grove':
      return { off: 0, def: stageVal([3.5, 4.5, 6], stage) * th, util: 0 };
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
    // EFFECT_MANA / EFFECT_CAPACITY: no value (D18)
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
    case 'augChain':
      return [{ kind: 'jumps', amount: x }];
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
    if (/life leech/i.test(m.name)) return def(v, x * leechPoint(v));
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
  // D21: healing gems excluded for mages
  const healingGem = m.category === 'augHealing' || v.model.spells.get(spell)?.kind === 'healing';
  if (healingGem && (v.vocation === 'sorcerer' || v.vocation === 'druid')) return ZERO;
  if (v.model.spells.get(spell)?.avatar && v.context.mode !== 'boss') return ZERO;
  const wheel = facts.wheelEffects.get(spell) ?? [];
  let p = sub(
    spellBundleParts(v, spell, [...wheel, ...supremeEffects(m, grade)], facts.stages, facts.wheelEffects),
    spellBundleParts(v, spell, wheel, facts.stages, facts.wheelEffects),
  );
  if (m.momentum) {
    const mom = m.momentum[grade - 1] ?? MOMENTUM_PER_GRADE[grade - 1] ?? 0;
    p = add(p, { off: mom * K.MOMENTUM_OFF, def: mom * K.MOMENTUM_DEF * v.threat, util: 0 });
  }
  return p;
}
