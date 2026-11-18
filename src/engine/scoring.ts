/** Turns perk value vectors into scalar scores (priority blend + monster tailoring). */
import type { Element, Monster } from '../types';
import type { EngineWheel } from './wheel/build';
import type { PerkValue } from './wheel/perks';

export interface ScoringContext {
  wOff: number;
  wDef: number;
  wUtil: number;
  /** Extra multiplier on all defense (monster threat). */
  threat: number;
  monster: Monster | null;
}

export const UTIL_WEIGHT = 0.1;
/** Minimum weight so the "other" side still breaks ties at the slider extremes. */
const MIN_WEIGHT = 0.05;

export function modifierOf(monster: Monster, e: Element): number {
  return monster.elementModifiers[e] ?? 100;
}

/** threat = clamp(maxDamage / 1000, 0.6, 1.6); 1 when unknown. */
export function threatOf(monster: Monster | null): number {
  if (!monster?.maxDamage) return 1;
  return Math.min(1.6, Math.max(0.6, monster.maxDamage / 1000));
}

export function makeContext(priority: number, monster: Monster | null): ScoringContext {
  const p = Math.min(100, Math.max(0, Number.isFinite(priority) ? priority : 50)) / 100;
  return {
    wOff: Math.max(MIN_WEIGHT, 1 - p),
    wDef: Math.max(MIN_WEIGHT, p),
    wUtil: UTIL_WEIGHT,
    threat: threatOf(monster),
    monster,
  };
}

/** Offense multiplier: mean over the perk's elements of (modifier/100)^2. */
export function offMult(v: PerkValue, monster: Monster | null): number {
  if (!monster || !v.offElements?.length) return 1;
  let s = 0;
  for (const e of v.offElements) s += (modifierOf(monster, e) / 100) ** 2;
  return s / v.offElements.length;
}

/** Defense multiplier for element-tagged perks: 0.6 + 0.8 × (share of monster damage types covered). */
export function defMult(v: PerkValue, monster: Monster | null): number {
  if (!monster || !v.defElements?.length || monster.damageTypes.length === 0) return 1;
  const covered = monster.damageTypes.filter((t) => v.defElements!.includes(t)).length;
  return 0.6 + 0.8 * (covered / monster.damageTypes.length);
}

export interface Parts {
  off: number;
  def: number;
  util: number;
}

export function tailored(v: PerkValue, ctx: ScoringContext): Parts {
  return {
    off: v.off * offMult(v, ctx.monster),
    def: v.def * defMult(v, ctx.monster) * ctx.threat,
    util: v.util,
  };
}

export function blend(p: Parts, ctx: ScoringContext): number {
  return ctx.wOff * p.off + ctx.wDef * p.def + ctx.wUtil * p.util;
}

/** Precomputed scalar tables for one (wheel, context) pair. */
export interface ScoreTables {
  /** Per slice: blended value of one dedication point. */
  ded: Float64Array;
  /** Per slice: blended conviction value (granted when full). */
  conv: Float64Array;
  /** Per domain: blended revelation value for stage 0..3. */
  rev: Float64Array[];
}

export function buildTables(wheel: EngineWheel, ctx: ScoringContext): ScoreTables {
  const n = wheel.slices.length;
  const ded = new Float64Array(n);
  const conv = new Float64Array(n);
  wheel.slices.forEach((s, i) => {
    ded[i] = blend(tailored(s.ded, ctx), ctx);
    conv[i] = blend(tailored(s.conv.value, ctx), ctx);
  });
  const rev = wheel.revelations.map((r) => {
    const t = new Float64Array(4);
    r.stageValues.forEach((v, k) => (t[k + 1] = blend(tailored(v, ctx), ctx)));
    return t;
  });
  return { ded, conv, rev };
}

export function stageFor(points: number, thresholds: readonly number[]): number {
  let stage = 0;
  thresholds.forEach((t, i) => {
    if (points >= t) stage = i + 1;
  });
  return stage;
}

/** Unblended (but monster-tailored) offense/defense totals of an allocation. */
export function rawTotals(wheel: EngineWheel, alloc: ArrayLike<number>, ctx: ScoringContext): Parts {
  const total: Parts = { off: 0, def: 0, util: 0 };
  const add = (p: Parts, k = 1) => {
    total.off += p.off * k;
    total.def += p.def * k;
    total.util += p.util * k;
  };
  const domainPts = [0, 0, 0, 0];
  wheel.slices.forEach((s, i) => {
    const pts = alloc[i];
    if (pts <= 0) return;
    domainPts[s.domainIdx] += pts;
    add(tailored(s.ded, ctx), pts);
    if (pts >= s.slice.capacity) add(tailored(s.conv.value, ctx));
  });
  wheel.revelations.forEach((r, d) => {
    const st = stageFor(domainPts[d], r.thresholds);
    if (st > 0) add(tailored(r.stageValues[st - 1], ctx));
  });
  return total;
}
