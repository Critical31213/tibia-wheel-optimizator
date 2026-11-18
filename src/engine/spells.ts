/**
 * Context-aware spell model: expected targets, element multiplier vs the monster and each
 * damage spell's share of the character's total damage output.
 *
 * contribution(S) = weight(S) × targets(S) × elementMultiplier(S)
 * share(S)        = contribution(S) / C, with C = base attacks + Σ regular damage spells.
 */
import type { Element, FightContext, Monster, Vocation } from '../types';
import { getSpell, getWheelSpellNames, type SpellMeta } from '../data/wheel';
import { getEngineWheel } from './wheel/build';

export const DEFAULT_CONTEXT: FightContext = { mode: 'hunt', huntStyle: 'solo' };

/** Area/chain/beam targets in boss mode (summons, adds). */
export const BOSS_AREA_TARGETS = 1.2;
/** Monsters available to area spells per hunt style (solo uses tibiapal averages). */
export const HUNT_POOL: Record<'teamLure' | 'teamBox', number> = { teamLure: 5, teamBox: 9 };
/** Fraction of the pack a beam's central line reaches; outer tiles (Beam Mastery) add this much more. */
export const BEAM_CENTRAL_REACH = 0.5;
export const BEAM_OUTER_REACH = 0.4;
const SOLO_FALLBACK: Record<SpellMeta['area'], number> = { single: 1, area: 4, chain: 3, beam: 2 };
/** Party size assumed for group heals in team hunts. */
const PARTY_SIZE = 4;

/** Relative damage per second against one target (cast frequency × per-hit damage). Approximate. */
const AREA_WEIGHT: Record<SpellMeta['area'], number> = { single: 0.6, area: 0.5, chain: 0.5, beam: 0.5 };
const WEIGHT_OVERRIDE: Record<string, number> = {
  "Hell's Core": 0.25,
  'Rage of the Skies': 0.25,
  'Eternal Winter': 0.25,
  'Fierce Berserk': 0.8,
  'Divine Caldera': 0.6,
};

/** Auto attacks, runes and non-augmentable spells. Mages use area runes while hunting. */
const BASE_DAMAGE: Record<Vocation, { weight: number; element: Element | null; areaRunes: boolean }> = {
  knight: { weight: 1.5, element: 'physical', areaRunes: false },
  paladin: { weight: 2, element: 'physical', areaRunes: false },
  sorcerer: { weight: 1.5, element: null, areaRunes: true },
  druid: { weight: 1.5, element: null, areaRunes: true },
  monk: { weight: 2, element: 'physical', areaRunes: false },
};

/** Revelation spells: weight at stage 1, multiplier per stage (damage × cast rate), cooldown per stage. */
export interface RevelationSpellDef {
  weight: number;
  stageMult: [number, number, number];
  cooldown: [number, number, number];
  maxTargets?: [number, number, number];
}
export const REVELATION_SPELLS: Record<string, RevelationSpellDef> = {
  "Executioner's Throw": { weight: 0.35, stageMult: [1, 1.45, 2.1], cooldown: [18, 14, 10], maxTargets: [3, 4, 5] },
  'Divine Grenade': { weight: 0.35, stageMult: [1, 1.5, 2.4], cooldown: [26, 20, 14] },
  'Ice Burst': { weight: 0.35, stageMult: [1, 1.45, 2.05], cooldown: [22, 18, 14] },
  'Terra Burst': { weight: 0.35, stageMult: [1, 1.45, 2.05], cooldown: [22, 18, 14] },
  'Spiritual Outburst': { weight: 0.35, stageMult: [1, 1.3, 1.75], cooldown: [24, 20, 16] },
};
/** Spells sharing one cooldown: the player casts the better element (split evenly on a tie). */
export const SHARED_COOLDOWN: string[][] = [['Ice Burst', 'Terra Burst']];

/** Base cooldowns (s) of spells with cooldown augments. Approximate. */
export const BASE_COOLDOWN: Record<string, number | [number, number, number]> = {
  Groundshaker: 8,
  'Intense Wound Cleansing': 600,
  'Strong Ethereal Spear': 8,
  'Divine Dazzle': 16,
  Lightning: 8,
  'Strong Energy Strike': 8,
  'Strong Flame Strike': 8,
  "Hell's Core": 40,
  'Rage of the Skies': 40,
  'Death Echo': 12,
  'Forked Thorns': 8,
  'Forked Glacier': 8,
  'Mass Spirit Mend': 16,
  'Thousand Fist Blows': 20,
  'Mystic Repulse': 16,
  'Energy Wave': 8,
  "Nature's Embrace": 60,
  'Focus Serenity': 900,
  'Focus Harmony': 120,
  'Divine Empowerment': [32, 28, 24],
  ...Object.fromEntries(Object.entries(REVELATION_SPELLS).map(([k, v]) => [k, v.cooldown])),
};
/** Cooldown can never drop below this fraction of the base cooldown. */
export const COOLDOWN_FLOOR = 0.5;

/** Share of the healing a vocation relies on (fraction). Group heals scale with the context. */
export const HEAL_SHARE: Record<string, number> = {
  'Fair Wound Cleansing': 0.6,
  'Intense Wound Cleansing': 0.25,
  Salvation: 0.5,
  'Ultimate Healing': 0.4,
  "Nature's Embrace": 0.3,
  'Heal Friend': 0.15,
  'Mass Healing': 0.2,
  'Spirit Mend': 0.6,
  'Mass Spirit Mend': 0.25,
};
export const TEAM_HEALS = new Set(['Heal Friend', 'Mass Healing', 'Mass Spirit Mend']);

export interface SpellEval {
  name: string;
  meta: SpellMeta | undefined;
  kind: SpellMeta['kind'];
  element: Element | null;
  targets: number;
  /** Beams: extra targets on the outer tiles (Beam Mastery). */
  outerTargets: number;
  /** Monster damage modifier / 100 (1 without monster / for non-damage spells). */
  elem: number;
  weight: number;
  /** Damage domain index of the revelation granting it, else -1. */
  revelation: number;
  avatar: boolean;
}

export interface SpellModel {
  vocation: Vocation;
  context: FightContext;
  monster: Monster | null;
  spells: Map<string, SpellEval>;
  /** Total damage normaliser C. */
  total: number;
}

export function elementMultiplier(monster: Monster | null, element: Element | null): number {
  if (!monster || !element || element === 'healing') return 1;
  return (monster.elementModifiers[element] ?? 100) / 100;
}

export function expectedTargets(meta: SpellMeta, ctx: FightContext, maxTargets = meta.maxTargets): number {
  if (meta.kind === 'healing') {
    if (meta.area === 'single' || ctx.mode === 'boss' || ctx.huntStyle === 'solo') return 1;
    return Math.min(maxTargets, PARTY_SIZE);
  }
  if (meta.area === 'single' || maxTargets <= 1) return 1;
  if (ctx.mode === 'boss') return Math.min(maxTargets, BOSS_AREA_TARGETS);
  const solo = Math.min(maxTargets, meta.avgHitsHunt ?? SOLO_FALLBACK[meta.area]);
  if (ctx.huntStyle === 'solo') return solo;
  const reach = HUNT_POOL[ctx.huntStyle] * (meta.area === 'beam' ? BEAM_CENTRAL_REACH : 1);
  return Math.min(maxTargets, Math.max(solo, reach));
}

export function outerBeamTargets(meta: SpellMeta, ctx: FightContext): number {
  if (meta.area !== 'beam' || ctx.mode === 'boss') return 0;
  const solo = meta.avgHitsHuntOuter ?? 0;
  if (ctx.huntStyle === 'solo') return solo;
  return Math.max(solo, HUNT_POOL[ctx.huntStyle] * BEAM_OUTER_REACH);
}

function baseTargets(vocation: Vocation, ctx: FightContext): number {
  if (!BASE_DAMAGE[vocation].areaRunes || ctx.mode === 'boss') return 1;
  return ctx.huntStyle === 'solo' ? 3 : ctx.huntStyle === 'teamLure' ? 4 : 6;
}

const modelCache = new Map<string, SpellModel>();

export function buildSpellModel(vocation: Vocation, context: FightContext, monster: Monster | null): SpellModel {
  const key = `${vocation}|${context.mode}|${context.huntStyle}|${monster?.id ?? ''}`;
  const cached = modelCache.get(key);
  if (cached && cached.monster === monster) return cached;

  const wheel = getEngineWheel(vocation);
  const revOf = new Map<string, number>();
  wheel.revelations.forEach((r, d) => r.data.spells.forEach((s) => revOf.set(s, d)));

  const spells = new Map<string, SpellEval>();
  for (const name of getWheelSpellNames(vocation)) {
    const meta = getSpell(name);
    const revelation = revOf.get(name) ?? -1;
    const kind = meta?.kind ?? 'damage';
    const element = meta?.element ?? null;
    const revDef = REVELATION_SPELLS[name];
    const maxT = revDef?.maxTargets?.[2];
    spells.set(name, {
      name,
      meta,
      kind,
      element,
      targets: meta ? expectedTargets(meta, context, maxT ?? meta.maxTargets) : 1,
      outerTargets: meta ? outerBeamTargets(meta, context) : 0,
      elem: kind === 'damage' ? elementMultiplier(monster, element) : 1,
      weight: revDef?.weight ?? WEIGHT_OVERRIDE[name] ?? (meta ? AREA_WEIGHT[meta.area] : 0.5),
      revelation,
      avatar: meta?.isAvatar ?? false,
    });
  }

  const base = BASE_DAMAGE[vocation];
  let total = base.weight * baseTargets(vocation, context) * elementMultiplier(monster, base.element);
  for (const s of spells.values()) {
    if (s.kind === 'damage' && s.revelation < 0) total += s.weight * s.targets * s.elem;
  }
  const model: SpellModel = { vocation, context, monster, spells, total: Math.max(total, 1e-6) };
  modelCache.set(key, model);
  if (modelCache.size > 200) modelCache.delete(modelCache.keys().next().value!);
  return model;
}

/** Shared-cooldown split: fraction of casts going to `name` (1 if not shared). */
function castFraction(model: SpellModel, name: string): number {
  const group = SHARED_COOLDOWN.find((g) => g.includes(name));
  if (!group) return 1;
  const score = (n: string) => model.spells.get(n)?.elem ?? 0;
  const best = Math.max(...group.map(score));
  const winners = group.filter((n) => score(n) === best);
  return winners.includes(name) ? 1 / winners.length : 0;
}

/** Targets of a spell at a revelation stage (revelation spells cap targets by stage). */
export function targetsAt(model: SpellModel, s: SpellEval, stage: number): number {
  const def = REVELATION_SPELLS[s.name];
  if (!s.meta || !def?.maxTargets || stage < 1) return s.targets;
  return expectedTargets(s.meta, model.context, def.maxTargets[stage - 1]);
}

/**
 * Percentage of total damage dealt by spell `name` (0..100+). Revelation spells need
 * `stage` ≥ 1; Avatar and non-damage spells return 0.
 */
export function damageShare(model: SpellModel, name: string, stage = 3): number {
  const s = model.spells.get(name);
  if (!s || s.kind !== 'damage') return 0;
  let c = s.weight * s.targets * s.elem;
  if (s.revelation >= 0) {
    if (stage < 1) return 0;
    const def = REVELATION_SPELLS[name];
    c = s.weight * targetsAt(model, s, stage) * s.elem * (def ? def.stageMult[stage - 1] : 1) * castFraction(model, name);
  }
  return (100 * c) / model.total;
}

export function baseCooldown(name: string, stage = 3): number | undefined {
  const cd = BASE_COOLDOWN[name];
  if (cd === undefined) return undefined;
  return typeof cd === 'number' ? cd : cd[Math.max(1, Math.min(3, stage)) - 1];
}

/** Cast-rate gain (fraction) from a total cooldown reduction, respecting the 50 % floor. */
export function cooldownGain(base: number, reduction: number): number {
  if (base <= 0 || reduction <= 0) return 0;
  const eff = Math.max(base * COOLDOWN_FLOOR, base - reduction);
  return base / eff - 1;
}

export function healShare(model: SpellModel, name: string): number {
  const share = HEAL_SHARE[name] ?? 0.2;
  if (!TEAM_HEALS.has(name)) return share;
  const ctx = model.context;
  if (ctx.mode === 'boss') return share;
  return share * (ctx.huntStyle === 'solo' ? 0.5 : 2);
}


/** Share for display: revelation spells are expressed relative to the total including themselves. */
export function displayShare(model: SpellModel, name: string, stage = 3): number {
  const raw = damageShare(model, name, stage);
  return (model.spells.get(name)?.revelation ?? -1) >= 0 ? (100 * raw) / (100 + raw) : raw;
}
