/**
 * Beam search over complete slice fills (directed unlock graph) with revelation look-ahead (incl. owned
 * Revelation Mastery gems), greedy completion with a partially filled last slice, gem placement,
 * alternatives and planner export code.
 */
import type {
  ActivatedRevelation,
  AlternativeBuild,
  CharacterStats,
  Domain,
  EngineMessage,
  Element,
  FightContext,
  GemModRef,
  GemRecommendation,
  ModGrade,
  OptimizerInput,
  OptimizerResult,
  OwnedGem,
  Perk,
  RotationPreset,
  RotationUsage,
  SpellUsage,
  StatLine,
  VesselAssignment,
} from '../types';
import { encodePlannerCode, gridForSliceId, plannerVesselIssues, type PlannerVessel } from '../data/wheel/plannerCode';
import { resolveCharacterStats } from '../data/character';
import { BALLISTIC_MASTERY, healingAverage, pierceDamageMod, POSITIONAL_TACTICS } from '../data/damage';
import { getRotationPresets } from '../data/damage/rotations';
import { getStance, stanceCombos, type StanceDef } from '../data/damage/stances';
import { stanceBuilder, stanceDefense, stancedCharacter } from './stances';
import {
  activeSlots,
  type GemEnv,
  gemParts,
  modGrades,
  modKey,
  withSharedGrades,
  NEW_GEM_GRADE,
  placedRmPoints,
  placeGems,
  recommendations,
  round1,
  upgrades,
  vesselAssignments,
} from './gems';
import { type EngineMessageKey, text } from './messages';
import {
  buildSpellModel,
  elementMultiplier,
  healShare,
  NO_STAGES,
  normaliseMonsters,
  planTotal,
  rotation,
  rotationTotal,
  type SpellModel,
  TEAM_HEALS,
  withPlan,
} from './spells';
import {
  add,
  augmentMods,
  augmentParts,
  avatarParts,
  type BuildFacts,
  characterFacts,
  convictionParts,
  dedicationParts,
  flatParts,
  hpParts,
  incomingShares,
  K,
  mitigationParts,
  type Parts,
  parseEffects,
  revelationIndex,
  revelationParts,
  type SpellEffect,
  spotMonster,
  threatOf,
  UTILITY_SPELLS,
  type ValuationContext,
  ZERO,
} from './values';
import {
  DOMAIN_ORDER,
  type EngineWheel,
  getEngineWheel,
  isAvailable,
  REVELATION_FLAT_BONUS,
  REVELATION_THRESHOLDS,
  RM_SLICE_POINTS,
  stageFor,
} from './wheel/build';

export const BEAM_WIDTH = 24;
/** Beam states greedily completed per level (best-so-far candidates). */
const COMPLETE_TOP = 8;

/** Beam width / completed states per level. Light: rotation screening, refine and alternatives (perf). */
export interface SearchOpts {
  width: number;
  complete: number;
}
export const FULL_SEARCH: SearchOpts = { width: BEAM_WIDTH, complete: COMPLETE_TOP };
export const LIGHT_SEARCH: SearchOpts = { width: 12, complete: 2 };
/** RM gem re-optimization probes. */
const PROBE_SEARCH: SearchOpts = { width: 16, complete: 2 };
const SCREEN_SEARCH: SearchOpts = { width: 8, complete: 1 };
/** Fraction of the next revelation stage credited proportionally to progress (ranking only). */
const LOOKAHEAD_WEIGHT = 0.6;
const UTIL_WEIGHT = 0.1;
const MIN_WEIGHT = 0.05;
/** A damage spell counts as useful from this share (%) of total damage. */
export const USEFUL_SHARE = 3;
/** Default number of alternative builds. */
export const DEFAULT_ALTERNATIVES = 2;

export interface Weights {
  off: number;
  def: number;
  util: number;
}

export function weightsFor(priority: number): Weights {
  const p = clampPriority(priority) / 100;
  return { off: Math.max(MIN_WEIGHT, 1 - p), def: Math.max(MIN_WEIGHT, p), util: UTIL_WEIGHT };
}

const clampPriority = (p: number) => Math.min(100, Math.max(0, Number.isFinite(p) ? p : 50));

export const blendWith = (w: Weights) => (p: Parts) => w.off * p.off + w.def * p.def + w.util * p.util;

/** Unblended per-slice / per-stage values. */
interface PartTables {
  dedP: Parts[];
  convP: Parts[];
  aug1P: Parts[];
  aug2P: Parts[];
  revP: Parts[][];
  /** Value of unlocking vessel k (incl. its +1 flat bonus). */
  vesselP: Parts[];
  /** Constant of the rotation plan vs the reference rotation (damage of its T0, EHP of its offhand). */
  baseP: Parts;
}

/** Blended scalars used by the search. */
interface Tables extends PartTables {
  ded: Float64Array;
  conv: Float64Array;
  aug1: Float64Array;
  aug2: Float64Array;
  rev: Float64Array[];
  vessel: Float64Array;
}

interface State {
  alloc: Int32Array;
  used: number;
  domainPts: number[];
  rmFull: number[];
  vessels: number;
  score: number;
  path: number[];
  key: number;
  rank: number;
}

interface Search {
  wheel: EngineWheel;
  t: Tables;
  budget: number;
  density: number;
  /** Revelation points of owned RM gems active with `vessels` unlocked vessels: [vessels][domain]. */
  gemRm: number[][];
  /** Augment slice pairs (same conviction): stage II needs both copies. */
  pairs: [number, number][];
}

const isFull = (w: EngineWheel, alloc: ArrayLike<number>, i: number) => alloc[i] >= w.slices[i].capacity;
const revPts = (s: Search, st: State, d: number, vessels = st.vessels) =>
  st.domainPts[d] + RM_SLICE_POINTS * st.rmFull[d] + s.gemRm[vessels][d];

/** Rank of st after adding `pts` to slice i (i < 0: st itself) without allocating the new state. */
function rankOf(s: Search, st: State, i = -1, pts = 0, delta = 0): number {
  const sl = i >= 0 ? s.wheel.slices[i] : null;
  const fills = !!sl && st.alloc[i] + pts >= sl.capacity;
  const vessels = fills && sl!.kind === 'vessel' ? Math.min(st.vessels + 1, s.gemRm.length - 1) : st.vessels;
  const remaining = s.budget - st.used - pts;
  let shaping = 0;
  for (let d = 0; d < 4; d++) {
    let dp = revPts(s, st, d, vessels);
    if (sl && d === sl.domainIdx) dp += pts + (fills && sl.kind === 'rm' ? RM_SLICE_POINTS : 0);
    const stage = stageFor(dp);
    if (stage >= REVELATION_THRESHOLDS.length) continue;
    const target = REVELATION_THRESHOLDS[stage];
    const prev = stage > 0 ? REVELATION_THRESHOLDS[stage - 1] : 0;
    if (target - dp > remaining) continue;
    const gain = s.t.rev[d][stage + 1] - s.t.rev[d][stage];
    shaping += gain * ((dp - prev) / (target - prev)) * LOOKAHEAD_WEIGHT;
  }
  // Augment stage II comes only with the second copy (stage I may be worth ~0, e.g. a cooldown the rotation cannot use).
  for (const [x, y] of s.pairs) {
    const fx = isFull(s.wheel, st.alloc, x) || (x === i && fills);
    const fy = isFull(s.wheel, st.alloc, y) || (y === i && fills);
    if (fx === fy) continue;
    const other = fx ? y : x;
    const need = s.wheel.slices[other].capacity - st.alloc[other] - (other === i ? pts : 0);
    if (need <= remaining) shaping += Math.max(0, s.t.aug2[other]) * LOOKAHEAD_WEIGHT;
  }
  return st.score + delta + shaping + remaining * s.density;
}

/** Conviction gain when slice i becomes full in state st (before the fill). */
function convGain(s: Search, st: State, i: number): number {
  const sl = s.wheel.slices[i];
  switch (sl.kind) {
    case 'augment':
      return sl.twin >= 0 && isFull(s.wheel, st.alloc, sl.twin) ? s.t.aug2[i] : s.t.aug1[i];
    case 'vessel':
      return st.vessels < s.t.vessel.length ? s.t.vessel[st.vessels] : 0;
    case 'rm':
      return 0;
    default:
      return s.t.conv[i];
  }
}

/** Score gain of adding `pts` to slice i (no allocation). */
function gainOf(s: Search, st: State, i: number, pts: number): number {
  const sl = s.wheel.slices[i];
  const fills = st.alloc[i] + pts >= sl.capacity;
  const nextVessels = fills && sl.kind === 'vessel' ? Math.min(st.vessels + 1, s.gemRm.length - 1) : st.vessels;
  let rev = 0;
  for (let d = 0; d < 4; d++) {
    if (d !== sl.domainIdx && nextVessels === st.vessels) continue;
    const before = revPts(s, st, d);
    let after = revPts(s, st, d, nextVessels);
    if (d === sl.domainIdx) after += pts + (fills && sl.kind === 'rm' ? RM_SLICE_POINTS : 0);
    rev += s.t.rev[d][stageFor(after)] - s.t.rev[d][stageFor(before)];
  }
  return s.t.ded[i] * pts + (fills ? convGain(s, st, i) : 0) + rev;
}

function extend(s: Search, st: State, i: number, pts: number, delta = gainOf(s, st, i, pts)): State {
  const sl = s.wheel.slices[i];
  const fills = st.alloc[i] + pts >= sl.capacity;
  const alloc = st.alloc.slice();
  alloc[i] += pts;
  const domainPts = st.domainPts.slice();
  domainPts[sl.domainIdx] += pts;
  const rmFull = fills && sl.kind === 'rm' ? st.rmFull.map((x, d) => (d === sl.domainIdx ? x + 1 : x)) : st.rmFull;
  const next: State = {
    alloc,
    used: st.used + pts,
    domainPts,
    rmFull,
    vessels: fills && sl.kind === 'vessel' ? Math.min(st.vessels + 1, s.gemRm.length - 1) : st.vessels,
    score: 0,
    path: st.path.includes(i) ? st.path : [...st.path, i],
    key: fills ? st.key + 2 ** i : st.key,
    rank: 0,
  };
  next.score = st.score + delta;
  next.rank = rankOf(s, next);
  return next;
}

/** Greedily spends leftover points; only the last touched slice may be partial. */
function complete(s: Search, start: State): State {
  let st = start;
  const n = s.wheel.slices.length;
  for (;;) {
    const left = s.budget - st.used;
    if (left <= 0) return st;
    let best = -1;
    let bestPts = 0;
    let bestRatio = -Infinity;
    for (let i = 0; i < n; i++) {
      if (!isAvailable(s.wheel, st.alloc, i)) continue;
      const room = s.wheel.slices[i].capacity - st.alloc[i];
      const pts = Math.min(room, left);
      const ratio = gainOf(s, st, i, pts) / pts;
      if (ratio > bestRatio + 1e-12) {
        bestRatio = ratio;
        best = i;
        bestPts = pts;
      }
    }
    if (best < 0) return st;
    st = extend(s, st, best, bestPts);
    if (!isFull(s.wheel, st.alloc, best)) return st;
  }
}

function search(wheel: EngineWheel, t: Tables, budget: number, gemRm: number[][], seed: readonly number[] = [], opts = FULL_SEARCH): State {
  const n = wheel.slices.length;
  let density = 0;
  wheel.slices.forEach((sl, i) => {
    const conv =
      sl.kind === 'augment' ? (t.aug1[i] + t.aug2[i]) / 2 : sl.kind === 'vessel' ? t.vessel[0] : sl.kind === 'rm' ? 0 : t.conv[i];
    density += Math.max(0, t.ded[i] + conv / sl.capacity);
  });
  density /= n;
  const pairs = wheel.slices.filter((sl) => sl.kind === 'augment' && sl.twin > sl.idx).map((sl): [number, number] => [sl.idx, sl.twin]);
  const s: Search = { wheel, t, budget, density, gemRm, pairs };
  let empty: State = {
    alloc: new Int32Array(n),
    used: 0,
    domainPts: [0, 0, 0, 0],
    rmFull: [0, 0, 0, 0],
    vessels: 0,
    score: 0,
    path: [],
    key: 0,
    rank: 0,
  };
  // D21: forced augment paths are filled first.
  for (const i of seed) empty = extend(s, empty, i, wheel.slices[i].capacity);
  let best = complete(s, empty);
  // A full wheel has one allocation; only the fill order differs.
  if (budget >= wheel.definition.totalCapacity) return best;
  let beam = [empty];
  while (beam.length) {
    const next = new Map<number, { st: State; i: number; delta: number; rank: number; key: number }>();
    for (const st of beam) {
      const remaining = budget - st.used;
      for (let i = 0; i < n; i++) {
        const cap = wheel.slices[i].capacity;
        if (cap > remaining || !isAvailable(wheel, st.alloc, i)) continue;
        const delta = gainOf(s, st, i, cap);
        const rank = rankOf(s, st, i, cap, delta);
        const key = st.key + 2 ** i;
        const prev = next.get(key);
        if (!prev || rank > prev.rank) next.set(key, { st, i, delta, rank, key });
      }
    }
    beam = [...next.values()]
      .sort((a, b) => b.rank - a.rank || a.key - b.key)
      .slice(0, opts.width)
      .map((c) => extend(s, c.st, c.i, wheel.slices[c.i].capacity, c.delta));
    for (const st of beam.slice(0, opts.complete)) {
      const done = complete(s, st);
      if (done.score > best.score + 1e-9) best = done;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Tables

function wheelEffectsFor(wheel: EngineWheel, alloc: ArrayLike<number>): Map<string, SpellEffect[]> {
  const out = new Map<string, SpellEffect[]>();
  const seen = new Set<number>();
  for (const sl of wheel.slices) {
    const a = sl.tile.conviction.augment;
    if (sl.kind !== 'augment' || !a || seen.has(sl.idx) || !isFull(wheel, alloc, sl.idx)) continue;
    seen.add(sl.idx);
    const both = sl.twin >= 0 && isFull(wheel, alloc, sl.twin);
    if (both) seen.add(sl.twin);
    const effects = [...parseEffects(a.stage1), ...(both ? parseEffects(a.stage2) : [])];
    for (const spell of a.spells) out.set(spell, [...(out.get(spell) ?? []), ...effects]);
  }
  return out;
}

function factsFor(revPoints: number[], wheelEffects: Map<string, SpellEffect[]>, stages = revPoints.map((p) => stageFor(p))): BuildFacts {
  return { revPoints, stages, wheelEffects };
}

/**
 * Value of vessels 0..7 when unlocked one by one (D23): the slice's own flat bonus plus the owned gems the
 * newly unlocked vessel lets the optimal placement use. Recommended (hypothetical) gems are never assumed.
 */
export function vesselTable(env: GemEnv, gems: OwnedGem[]): Parts[] {
  const vessels = env.wheel.definition.vessels;
  const prefix: Parts[] = [ZERO];
  for (let c = 1; c <= vessels.length; c++) {
    const placed = gems.length ? placeGems(env, gems, c) : [];
    let total = ZERO;
    for (let i = 0; i < c; i++) {
      const g = placed[i];
      if (g) total = add(total, gemParts(env, g, vessels[i].quality));
    }
    prefix.push(total);
  }
  const flat = flatParts(env.v, 1);
  return vessels.map((_, k) => add(add(prefix[k + 1], prefix[k], -1), flat));
}

/** Build-independent value of a plan: rotation + stance offense vs the reference, offhand mitigation and stance defense. */
export function baseParts(v: ValuationContext): Parts {
  return {
    off: v.model.baseOff,
    def: 100 * ((100 - v.mitigationRef) / Math.max(50, 100 - v.mitigation) - 1) * v.threat + (v.stanceDef ?? 0),
    util: 0,
  };
}

function partTables(wheel: EngineWheel, v: ValuationContext, vesselP: Parts[]): PartTables {
  const augs = wheel.slices.map((s): [Parts, Parts] => (s.kind === 'augment' ? augmentParts(v, s.tile) : [ZERO, ZERO]));
  return {
    dedP: wheel.slices.map((s) => dedicationParts(v, s.tile)),
    convP: wheel.slices.map((s) => (s.kind === 'augment' || s.kind === 'rm' || s.kind === 'vessel' ? ZERO : convictionParts(v, s.tile))),
    aug1P: augs.map((a) => a[0]),
    aug2P: augs.map((a) => a[1]),
    revP: wheel.revelations.map((r) => [0, 1, 2, 3].map((st) => revelationParts(v, r, st))),
    vesselP,
    baseP: baseParts(v),
  };
}

function blendTables(p: PartTables, blend: (p: Parts) => number, revScale: number[] = [1, 1, 1, 1]): Tables {
  const f = (ps: Parts[]) => Float64Array.from(ps.map(blend));
  return {
    ...p,
    ded: f(p.dedP),
    conv: f(p.convP),
    aug1: f(p.aug1P),
    aug2: f(p.aug2P),
    rev: p.revP.map((r, d) => Float64Array.from(r.map((x) => blend(x) * revScale[d]))),
    vessel: f(p.vesselP),
  };
}

/** Raw (unblended) value of a build. */
function rawTotals(wheel: EngineWheel, t: PartTables, alloc: ArrayLike<number>, stages: number[], withBase = true): Parts {
  let total = withBase ? t.baseP : ZERO;
  let vessels = 0;
  for (const sl of wheel.slices) {
    const i = sl.idx;
    if (alloc[i] <= 0) continue;
    total = add(total, t.dedP[i], alloc[i]);
    if (!isFull(wheel, alloc, i)) continue;
    if (sl.kind === 'augment') {
      const second = sl.twin >= 0 && isFull(wheel, alloc, sl.twin) && sl.twin < i;
      total = add(total, second ? t.aug2P[i] : t.aug1P[i]);
    } else if (sl.kind === 'vessel') total = add(total, t.vesselP[vessels++] ?? ZERO);
    else total = add(total, t.convP[i]);
  }
  stages.forEach((st, d) => (total = add(total, t.revP[d][st])));
  return total;
}

/** Owned Revelation Mastery gems → revelation points per domain for 0..8 unlocked vessels (greater vessels in order). */
function ownedRmOffsets(wheel: EngineWheel, gems: OwnedGem[]): number[][] {
  const vessels = wheel.definition.vessels;
  const greater = vessels.map((v, i) => (v.quality === 'greater' ? i : -1)).filter((i) => i >= 0);
  const rm = gems
    .filter((g) => g.quality === 'greater' && g.supreme)
    .map((g) => {
      const m = wheel.supremeMods.find((x) => x.id === g.supreme!.modId);
      if (m?.category !== 'revelationMastery') return null;
      const d = revelationIndex(wheel.revelations, m.revelation);
      return d >= 0 ? { d, pts: m.values[g.supreme!.grade - 1] ?? 0, id: g.id } : null;
    })
    .filter((x): x is { d: number; pts: number; id: string } => !!x)
    .sort((a, b) => b.pts - a.pts || a.id.localeCompare(b.id));
  return Array.from({ length: vessels.length + 1 }, (_, c) => {
    const out = [0, 0, 0, 0];
    rm.forEach((g, k) => {
      if (k < greater.length && greater[k] < c) out[g.d] += g.pts;
    });
    return out;
  });
}

// ---------------------------------------------------------------------------
// Reporting

const fmt = (x: number, digits = 0) => (Math.round(x * 10 ** digits) / 10 ** digits).toString();

function stat(key: EngineMessageKey, value: string, category: StatLine['category'], params?: Record<string, string | number>): StatLine {
  const t = text(key, params);
  return { label: t.text, labelMsg: t.msg, value, category };
}

function statLines(wheel: EngineWheel, alloc: Int32Array, stages: number[], env: GemEnv, vessels: OptimizerResult['vessels']): StatLine[] {
  let hp = 0;
  let mana = 0;
  let cap = 0;
  let mit = 0;
  let life = 0;
  let manaLeech = 0;
  let skill = 0;
  let skillName = '';
  let vesselSlices = 0;
  const augments = new Map<string, number>();
  const uniques: string[] = [];
  for (const sl of wheel.slices) {
    const pts = alloc[sl.idx];
    if (pts <= 0) continue;
    for (const d of sl.tile.dedication.perks) {
      if (d.id === 0) hp += d.perPoint * pts;
      else if (d.id === 1) mana += d.perPoint * pts;
      else if (d.id === 3) cap += d.perPoint * pts;
      else if (d.id === 4) mit += pts;
    }
    if (!isFull(wheel, alloc, sl.idx)) continue;
    const c = sl.tile.conviction;
    if (sl.kind === 'lifeLeech') life += c.numericValue ?? 0;
    else if (sl.kind === 'manaLeech') manaLeech += c.numericValue ?? 0;
    else if (sl.kind === 'skill') {
      skill += c.numericValue ?? 1;
      skillName = c.name.replace(/ Boost$/, '');
    } else if (sl.kind === 'vessel') vesselSlices++;
    else if (sl.kind === 'augment') augments.set(c.name, (augments.get(c.name) ?? 0) + 1);
    else if (sl.kind === 'unique') uniques.push(c.name);
  }
  const flat = stages.reduce((s, st) => s + REVELATION_FLAT_BONUS[st], 0) + vesselSlices;
  const lines: StatLine[] = [];
  if (hp > 0) lines.push(stat('stat.hitPoints', `+${fmt(hp)}`, 'defense'));
  if (mana > 0) lines.push(stat('stat.mana', `+${fmt(mana)}`, 'utility'));
  if (cap > 0) lines.push(stat('stat.capacity', `+${fmt(cap)}`, 'utility'));
  if (mit > 0) lines.push(stat('stat.mitigation', `+${fmt(Math.floor(mit * 7.5) / 100, 2)}%`, 'defense'));
  if (life > 0) lines.push(stat('stat.lifeLeech', `+${fmt(life, 2)}%`, 'defense'));
  if (manaLeech > 0) lines.push(stat('stat.manaLeech', `+${fmt(manaLeech, 2)}%`, 'utility'));
  if (skill > 0) lines.push(stat('stat.skill', `+${skill}`, 'offense', { skill: skillName }));
  if (flat > 0) lines.push(stat('stat.flatBonus', `+${flat}`, 'offense'));
  for (const [name, n] of augments) lines.push(stat('stat.augment', n >= 2 ? 'I + II' : 'I', 'offense', { name }));
  for (const name of uniques) lines.push(stat('stat.unique', 'Active', 'offense', { name }));
  const unlocked = vessels.filter((x) => x.unlocked).length;
  if (unlocked) lines.push(stat('stat.vessels', `${unlocked}/8`, 'utility'));

  // Owned gem mods active in their vessels.
  const sums = new Map<string, { value: number; unit: string; category: StatLine['category'] }>();
  for (const vs of vessels) {
    if (vs.source !== 'owned' || !vs.gem) continue;
    for (const slot of activeSlots(vs.gem.quality, vs.quality)) {
      const ref = vs.gem[slot];
      if (!ref) continue;
      if (slot === 'supreme') {
        const m = env.wheel.supremeMods.find((x) => x.id === ref.modId);
        if (m) lines.push(stat('stat.gemMod', m.gradeValues[ref.grade - 1] ?? '', 'offense', { name: m.name }));
        continue;
      }
      const m = env.wheel.basicMods.find((x) => x.id === ref.modId);
      for (const e of m?.effects ?? []) {
        const unit = /resistance|mitigation/i.test(e.name) ? '%' : '';
        const cur = sums.get(e.name) ?? { value: 0, unit, category: unit ? 'defense' : 'utility' };
        cur.value += e.values[ref.grade - 1] ?? 0;
        sums.set(e.name, cur);
      }
    }
  }
  for (const [name, s] of [...sums].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(stat('stat.gemMod', `${s.value >= 0 ? '+' : ''}${fmt(s.value, 2)}${s.unit}`, s.category, { name }));
  }
  return lines;
}

function namedConvictions(wheel: EngineWheel, alloc: Int32Array, path: number[]): Perk[] {
  const count = new Map<string, number>();
  const out: Perk[] = [];
  for (const i of path) {
    const sl = wheel.slices[i];
    if (!isFull(wheel, alloc, i)) continue;
    const { id, name, description, category } = sl.slice.conviction;
    if (sl.kind === 'augment') {
      const g = (count.get(name) ?? 0) + 1;
      count.set(name, g);
      out.push({ id, name: `${name} ${g === 1 ? 'I' : 'II'}`, description, category });
    } else out.push({ id, name, description, category });
  }
  return out;
}


function spellUsages(v: ValuationContext, stages: number[], wheel: EngineWheel): SpellUsage[] {
  const model = v.model;
  const rot = rotation(model, { stages });
  const out: (SpellUsage & { share: number })[] = [];
  const monster = v.monster;
  for (const name of model.wheelSpells) {
    const s = model.spells.get(name);
    if (!s) continue;
    const stage = s.stageDomain >= 0 ? stages[s.stageDomain] : 0;
    let useful = true;
    let share = 0;
    let targets = s.targets;
    let r: { msg: EngineMessage; text: string };
    if (s.avatar) {
      useful = model.context.mode === 'boss';
      targets = 1;
      r = text(useful ? 'spell.avatarBoss' : 'spell.avatarHunt');
    } else if (s.kind === 'damage') {
      const x = rot.rates.get(name);
      share = x ? (100 * x.rate * x.perCast) / rot.total : 0;
      const element = s.element ?? 'physical';
      const modifier = Math.round(s.elem * 100);
      if (model.context.mode === 'hunt' && s.singleTarget) {
        useful = false;
        targets = 1;
        r = text('spell.singleTargetHunt');
      } else if (s.elem <= 0 && monster) {
        useful = false;
        r = text('spell.immune', { monster: monster.name, element });
      } else if (s.revelation >= 0 && stage < 1) {
        useful = false;
        r = text('spell.revelationLocked', { revelation: wheel.revelations[s.revelation].data.name });
      } else if (!x) {
        // D20: transit slice, the spell is not cast in this rotation
        useful = false;
        r = text('spell.notInRotation');
      } else {
        useful = share >= USEFUL_SHARE;
        const params = { targets: round1(targets), element, modifier, share: Math.round(share) };
        r = text(useful ? 'spell.damage' : 'spell.lowShare', params);
      }
    } else if (s.kind === 'healing') {
      if (TEAM_HEALS.has(s.name)) {
        useful = model.context.mode === 'boss' || v.forced.has(s.name);
        r = text(useful ? 'spell.teamHealing' : 'spell.teamHealingSolo');
      } else r = text('spell.healing');
    } else if (v.forced.has(s.name)) r = text('spell.forced');
    else if (UTILITY_SPELLS.has(s.name)) {
      useful = false;
      r = text('spell.notInRotation');
    } else r = text('spell.support');
    out.push({ name: s.name, expectedTargets: round1(Math.max(1, targets)), useful, reason: r.text, reasonMsg: r.msg, share });
  }
  out.sort((a, b) => Number(b.useful) - Number(a.useful) || b.share - a.share || a.name.localeCompare(b.name));
  return out.map(({ share, ...u }) => (share > 0 && u.useful ? { ...u, share: round1(share) } : u));
}

/** Casts per minute (30 combat turns). */
const PER_MINUTE = 60 / 2;

function rotationUsage(p: Prepared, stages: number[], alloc: ArrayLike<number>): RotationUsage {
  const { v, wheel } = p;
  const augments = wheel.slices.filter((s) => s.kind === 'augment' && isFull(wheel, alloc, s.idx)).map((s) => s.tile);
  const rot = rotation(v.model, { stages, mods: augmentMods(v, augments) });
  const spells: RotationUsage['spells'] = [];
  for (const [name, x] of rot.rates) {
    if (x.rate <= 0) continue;
    const s = v.model.spells.get(name);
    spells.push({
      name,
      ratio: round1(x.rate * PER_MINUTE),
      share: round1((100 * x.rate * x.perCast) / rot.total),
      ...(s && s.revelation >= 0 ? { fromRevelation: true } : {}),
    });
  }
  if (v.context.mode === 'boss') {
    wheel.revelations.forEach((r, d) => {
      if (!r.data.isAvatar || stages[d] < 1) return;
      const off = avatarParts(v, stages[d]).off;
      const name = r.data.spells[0] ?? r.data.name;
      spells.push({ name, ratio: 0, share: round1((100 * off) / (100 + off)), fromRevelation: true });
    });
  }
  spells.sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));
  return { presetId: v.model.plan.id, auto: p.auto, spells };
}

type Msg = { msg: EngineMessage; text: string };

function rationale(p: Prepared, best: State, stages: number[], revPoints: number[], vesselsUnlocked: number, vesselSlices: number): Msg[] {
  const { input, wheel, v } = p;
  const ctx = v.context;
  const model = v.model;
  const out: Msg[] = [];
  const pr = Math.round(clampPriority(input.priority));
  out.push(text('rationale.priority', { priority: pr, offense: 100 - pr, defense: pr }));
  out.push(
    text('rationale.character', { level: v.level, hp: Math.round(v.hp), mitigation: round1(v.mitigation) }),
  );

  const damage = [...model.spells.values()].filter((s) => s.kind === 'damage' && !s.avatar && model.wheelSpells.includes(s.name));
  if (ctx.mode === 'boss') out.push(text('rationale.boss'));
  else {
    const area = damage.filter((s) => !s.singleTarget);
    const avg = area.length ? area.reduce((a, s) => a + s.targets, 0) / area.length : 1;
    out.push(text('rationale.hunt', { targets: round1(avg) }));
    const single = damage.filter((s) => s.singleTarget).map((s) => s.name).sort();
    if (single.length) out.push(text('rationale.singleTarget', { spells: single.join(', ') }));
    const avatar = wheel.revelations.find((r) => r.data.isAvatar);
    if (avatar) out.push(text('rationale.avatarIgnored', { avatar: avatar.data.name }));
  }
  const plan = model.plan;
  const rotName = plan.preset?.name ?? plan.id;
  out.push(text(p.auto ? 'rationale.rotationAuto' : 'rationale.rotationManual', { rotation: rotName }));
  if (!p.auto && plan.requires && !planValid(p, stages)) out.push(text('rationale.rotationRequires', { revelation: plan.requires }));
  out.push(model.stances?.length ? text('rationale.stances', { stances: model.stances.join(' + ') }) : text('rationale.noStance'));
  const f = p.forced;
  if (f.taken.length) out.push(text('rationale.forced', { spells: f.taken.join(', ') }));
  if (f.impossible.length) out.push(text('rationale.forcedImpossible', { spells: f.impossible.join(', ') }));
  if (f.noAugment.length) out.push(text('rationale.forcedNoAugment', { spells: f.noAugment.join(', ') }));

  if (model.monsters.length > 1) {
    const list = [...model.monsters]
      .sort((a, b) => b.weight - a.weight || a.monster.name.localeCompare(b.monster.name))
      .map((m) => `${m.monster.name} ${Math.round(m.weight * 100)}%`)
      .join(', ');
    out.push(text('rationale.spot', { list }));
  }
  const m = v.monster;
  if (m) {
    const elements = [...new Set(damage.map((s) => s.element).filter((e): e is Element => !!e))];
    const mod = (e: Element) => m.elementModifiers[e] ?? 100;
    const byShare = (es: Element[]) =>
      damage
        .filter((s) => s.element && es.includes(s.element) && s.usable)
        .sort((a, b) => b.targets - a.targets || a.name.localeCompare(b.name))
        .slice(0, 3)
        .map((s) => s.name)
        .join(', ');
    const weak = elements.filter((e) => mod(e) > 100).sort((a, b) => mod(b) - mod(a) || a.localeCompare(b));
    const immune = elements.filter((e) => mod(e) <= 0);
    const resisted = elements.filter((e) => mod(e) > 0 && mod(e) < 100);
    if (weak.length) {
      out.push(text('rationale.weak', { monster: m.name, list: weak.map((e) => `${mod(e)}% ${e}`).join(', '), spells: byShare(weak) || '-' }));
    } else out.push(text('rationale.noWeakness', { monster: m.name }));
    if (immune.length) out.push(text('rationale.immune', { monster: m.name, list: immune.join(', '), spells: byShare(immune) || '-' }));
    if (resisted.length) {
      out.push(text('rationale.resists', { monster: m.name, list: resisted.map((e) => `${e} (${mod(e)}%)`).join(', ') }));
    }
    if (m.damageTypes.length || m.maxDamage) {
      out.push(
        text(m.maxDamage ? 'rationale.threatMax' : 'rationale.threat', {
          monster: m.name,
          types: m.damageTypes.length ? m.damageTypes.join('/') : 'unknown',
          ...(m.maxDamage ? { max: m.maxDamage } : {}),
          threat: threatOf(m).toFixed(2),
        }),
      );
    }
  } else out.push(text('rationale.noMonster'));

  const hp = hpParts(v, 1).def;
  const mit = mitigationParts(v, 0.075).def;
  const hpPerPoint = wheel.slices.find((s) => s.tile.dedication.perks.length === 1 && s.tile.dedication.perks[0].id === 0)?.tile.dedication.perks[0].perPoint ?? 1;
  const ratio = mit > 0 ? (hp * hpPerPoint) / mit : 99;
  out.push(
    ratio >= 1
      ? text('rationale.hpOverMitigation', { ratio: round1(ratio) })
      : text('rationale.mitigationOverHp', { ratio: round1(1 / ratio) }),
  );

  const revs = wheel.revelations
    .map((r, d) => ({ name: r.data.name, st: stages[d], pts: revPoints[d] }))
    .filter((x) => x.st > 0)
    .map((x) => `${x.name} stage ${x.st} (${x.pts} pts)`);
  if (revs.length) out.push(text('rationale.revelations', { list: revs.join(', ') }));
  else if (best.used < 250) out.push(text('rationale.noRevelation'));
  if (vesselSlices > 0) out.push(text('rationale.vessels', { filled: vesselSlices, unlocked: vesselsUnlocked }));

  const total = wheel.definition.totalCapacity;
  const partial = best.path.find((i) => !isFull(wheel, best.alloc, i));
  if (input.points > total) out.push(text('rationale.surplus', { capacity: total, surplus: Math.floor(input.points) - total }));
  else if (partial !== undefined) {
    const sl = wheel.slices[partial];
    out.push(text('rationale.partial', { slice: sl.slice.id, points: best.alloc[partial], capacity: sl.capacity }));
  }
  return out;
}

// ---------------------------------------------------------------------------

const pointsOf = (input: Pick<OptimizerInput, 'points'>) =>
  Math.max(0, Math.floor(Number.isFinite(input.points) ? input.points : 0));

type ValuationInput = Pick<OptimizerInput, 'vocation' | 'points' | 'monster' | 'context' | 'character' | 'monsters'> &
  Partial<Pick<OptimizerInput, 'rotationId' | 'forcedSpells'>>;

/** Level used for valuation: `character.level`, else points + 50. */
export function levelFor(input: Pick<OptimizerInput, 'points' | 'character'>): number {
  const l = input.character?.level;
  return Math.round(Math.max(8, Number.isFinite(l) && l! > 0 ? l! : Math.max(60, pointsOf(input) + 50)));
}

/** Rotation preset of the vocation with this id, else null. */
export function presetById(vocation: OptimizerInput['vocation'], id: string | undefined): RotationPreset | null {
  return id ? (getRotationPresets(vocation).find((p) => p.id === id) ?? null) : null;
}

/** Context (hunt style ignored, D20), character with estimated gaps, normalised spot and the plain spell model. */
function modelInputs(input: ValuationInput) {
  const context: FightContext = { mode: input.context?.mode === 'boss' ? 'boss' : 'hunt' };
  const level = levelFor(input);
  const clean = (x: number | undefined) => (Number.isFinite(x) && x! >= 0 ? x : undefined);
  const character = resolveCharacterStats(input.vocation, {
    level,
    mainSkill: clean(input.character?.mainSkill),
    magicLevel: clean(input.character?.magicLevel),
    shielding: clean(input.character?.shielding),
  });
  const monsters = normaliseMonsters(input.monsters, input.monster ?? null);
  const model = buildSpellModel(input.vocation, context, monsters, character);
  return { context, level, character, monsters, model };
}

/**
 * D21: Positional Tactics (+3 distance 70 % of the time, else +3 holy & healing magic level) and Ballistic Mastery
 * (hunt/bow: +4 % physical & holy pierce; boss/crossbow: +10 % critical extra damage) as exact rotation deltas.
 */
function paladinUniques(
  mi: ReturnType<typeof modelInputs>,
  model: SpellModel,
  preset: RotationPreset | null,
  threat: number,
  at: (c: Required<CharacterStats>) => SpellModel,
): Partial<Record<string, Parts>> {
  const { context, monsters, character } = mi;
  const t0 = planTotal(mi.model, preset);
  const norm = (t: number) => (100 * (t - t0)) / model.total;
  const pt = POSITIONAL_TACTICS;
  const skill = planTotal(at({ ...character, mainSkill: character.mainSkill + pt.skillBonus }), preset);
  const ml = at({ ...character, magicLevel: character.magicLevel + pt.magicLevelBonus });
  const holySpells = new Map([...mi.model.spells].map(([n, s]) => [n, s.element === 'holy' ? ml.spells.get(n) ?? s : s]));
  const holy = planTotal({ ...mi.model, spells: holySpells }, preset);
  let heal = 0;
  for (const s of model.spells.values()) {
    if (s.kind !== 'healing') continue;
    const h0 = healingAverage(s.name, character, { vocation: 'paladin' });
    const h1 = healingAverage(s.name, character, { vocation: 'paladin', magicLevelBonus: pt.magicLevelBonus });
    if (h0 > 0) heal += (100 * (h1 / h0 - 1)) * healShare(model, s.name) * K.HEAL_EHP;
  }
  const positional: Parts = {
    off: pt.skillUptime * norm(skill) + (1 - pt.skillUptime) * norm(holy),
    def: (1 - pt.skillUptime) * heal * threat,
    util: 0,
  };
  let ballistic: number;
  if (context.mode === 'hunt') {
    const bm = BALLISTIC_MASTERY.bow;
    const pierced = (e: Element | null) => {
      if (!e || !(bm.elements as readonly Element[]).includes(e)) return null;
      if (!monsters.length) return pierceDamageMod(1, bm.piercePct);
      return monsters.reduce((a, m) => a + m.weight * pierceDamageMod(elementMultiplier(m.monster, e), bm.piercePct), 0);
    };
    const spells = new Map([...mi.model.spells].map(([n, s]) => {
      const e = s.kind === 'damage' ? pierced(s.element) : null;
      return [n, e === null ? s : { ...s, elem: e }];
    }));
    const phys = mi.model.spells.size ? pierced('physical')! : 1;
    const physNow = monsters.length ? monsters.reduce((a, m) => a + m.weight * elementMultiplier(m.monster, 'physical'), 0) : 1;
    const base = physNow > 0 ? (mi.model.base * phys) / physNow : mi.model.base;
    ballistic = norm(planTotal({ ...mi.model, spells, base }, preset));
  } else {
    const m = { ...mi.model, plan: withPlan(mi.model, preset).plan };
    ballistic = norm(rotationTotal(m, { stages: NO_STAGES, critExtra: BALLISTIC_MASTERY.crossbow.critExtraDamagePct }));
  }
  return { 'Positional Tactics': positional, 'Ballistic Mastery': { off: ballistic, def: 0, util: 0 } };
}

/**
 * Valuation context for an input and rotation preset (default: `input.rotationId`, else greedy).
 * `reference` = common T0 so values of different presets are comparable (default: the preset's own T0).
 */
export function valuationFor(
  input: ValuationInput,
  preset: RotationPreset | null = presetById(input.vocation, input.rotationId),
  reference?: number,
  stances: readonly StanceDef[] = [],
): ValuationContext {
  const mi0 = modelInputs(input);
  const { context, level, monsters } = mi0;
  const build = stanceBuilder(input.vocation, context, monsters, stances, preset);
  const character = stancedCharacter(mi0.character, stances);
  const mi = stances.length ? { ...mi0, character, model: build(character) } : mi0;
  const model = withPlan(mi.model, preset, reference);
  const t0 = planTotal(mi.model, preset);
  const mage = input.vocation === 'sorcerer' || input.vocation === 'druid';
  const boosted = mage ? { ...character, magicLevel: character.magicLevel + 1 } : { ...character, mainSkill: character.mainSkill + 1 };
  const skillOff = (100 * (planTotal(build(boosted), preset) - t0)) / model.total;
  const monster = spotMonster(monsters);
  const threat = threatOf(monster);
  const offhand = model.plan.shield ? 'shield' : undefined;
  const facts = characterFacts(input.vocation, level, character.shielding, offhand);
  // EHP reference without stances, so Protector's shielding counts.
  facts.mitigationRef = characterFacts(input.vocation, level, mi0.character.shielding).mitigationRef;
  return {
    vocation: input.vocation,
    context,
    monster,
    model,
    level,
    threat,
    ...facts,
    stanceDef: stanceDefense(model, mi0.character, stances, K.HEAL_EHP) * threat,
    incoming: incomingShares(monsters),
    skillOff: Math.max(0, skillOff),
    forced: new Set(input.forcedSpells ?? []),
    unique: input.vocation === 'paladin' ? paladinUniques(mi, model, preset, threat, build) : {},
  };
}

// ---------------------------------------------------------------------------
// Forced spells (D21)

interface ForcedInfo {
  /** Slices to fill first (unlock order). */
  seed: number[];
  taken: string[];
  impossible: string[];
  noAugment: string[];
}

/** Cheapest unlock path (Dijkstra over slice capacities) to an augment slice of each forced spell. */
function forcedSeed(wheel: EngineWheel, spells: readonly string[], budget: number): ForcedInfo {
  const out: ForcedInfo = { seed: [], taken: [], impossible: [], noAugment: [] };
  const n = wheel.slices.length;
  const next: number[][] = wheel.slices.map(() => []);
  wheel.slices.forEach((s) => s.unlockedBy.forEach((j) => next[j].push(s.idx)));
  const full = new Set<number>();
  let used = 0;
  for (const spell of [...new Set(spells)]) {
    const targets = wheel.slices.filter((s) => s.kind === 'augment' && s.tile.conviction.augment?.spells.includes(spell)).map((s) => s.idx);
    if (!targets.length) {
      out.noAugment.push(spell);
      continue;
    }
    if (targets.some((t) => full.has(t))) {
      out.taken.push(spell);
      continue;
    }
    const cost = (i: number) => (full.has(i) ? 0 : wheel.slices[i].capacity);
    const dist = new Array<number>(n).fill(Infinity);
    const prev = new Array<number>(n).fill(-1);
    const done = new Array<boolean>(n).fill(false);
    wheel.slices.forEach((s) => s.initiallyUnlocked && (dist[s.idx] = cost(s.idx)));
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0) break;
      done[u] = true;
      for (const j of next[u]) {
        const d = dist[u] + cost(j);
        if (d < dist[j]) {
          dist[j] = d;
          prev[j] = u;
        }
      }
    }
    const target = targets.reduce((a, b) => (dist[b] < dist[a] ? b : a));
    if (!(dist[target] < Infinity) || used + dist[target] > budget) {
      out.impossible.push(spell);
      continue;
    }
    const path: number[] = [];
    for (let i = target; i >= 0; i = prev[i]) if (!full.has(i)) path.unshift(i);
    path.forEach((i) => full.add(i));
    out.seed.push(...path);
    used += dist[target];
    out.taken.push(spell);
  }
  return out;
}

interface Prepared {
  input: OptimizerInput;
  wheel: EngineWheel;
  v: ValuationContext;
  budget: number;
  gems: OwnedGem[];
  gemRm: number[][];
  parts: PartTables;
  blend: (p: Parts) => number;
  tables: Tables;
  forced: ForcedInfo;
  /** Rotation picked by the engine (no manual preset). */
  auto: boolean;
}

interface PlanSpec {
  preset: RotationPreset | null;
  /** D24: stances of this plan. */
  stances: StanceDef[];
  /** Valuation already built while picking the stances. */
  v?: ValuationContext;
  reference: number;
  auto: boolean;
  forced: ForcedInfo;
}

function prepare(input: OptimizerInput, priority = input.priority, base?: Prepared, spec?: PlanSpec): Prepared {
  const wheel = getEngineWheel(input.vocation);
  const v = base?.v ?? spec?.v ?? valuationFor(input, spec?.preset ?? null, spec?.reference, spec?.stances);
  const budget = Math.min(wheel.definition.totalCapacity, pointsOf(input));
  const gems = input.gems ?? [];
  const blend = blendWith(weightsFor(priority));
  // Pre-search owned-gem estimate (D23: no recommended gems): revelation spells at the stage ~60 % of the budget reaches; RM gems are handled by gemRm.
  const assumed = stageFor(Math.min(1000, Math.round(budget * 0.6)));
  const preEnv: GemEnv = { v, wheel, blend, facts: factsFor([1e9, 1e9, 1e9, 1e9], new Map(), [assumed, assumed, assumed, assumed]) };
  const vesselP = vesselTable(preEnv, gems);
  const parts = base ? { ...base.parts, vesselP } : partTables(wheel, v, vesselP);
  return {
    input,
    wheel,
    v,
    budget,
    gems,
    gemRm: base?.gemRm ?? ownedRmOffsets(wheel, gems),
    parts,
    blend,
    tables: blendTables(parts, blend),
    forced: base?.forced ?? spec?.forced ?? forcedSeed(wheel, input.forcedSpells ?? [], budget),
    auto: base?.auto ?? spec?.auto ?? false,
  };
}

const gridStages = (p: Prepared, st: State) => DOMAIN_ORDER.map((_, d) => stageFor(st.domainPts[d] + RM_SLICE_POINTS * st.rmFull[d] + p.gemRm[st.vessels][d]));

/** Objective of a state under the main build's valuation. */
const objective = (p: Prepared, st: State) => p.blend(rawTotals(p.wheel, p.parts, st.alloc, gridStages(p, st)));

/** D20: a preset requiring a revelation is valid only when the build reaches it. */
function planValid(p: Prepared, stages: number[]): boolean {
  const req = p.v.model.plan.requires;
  if (!req) return true;
  const d = revelationIndex(p.wheel.revelations, req);
  return d >= 0 && stages[d] >= 1;
}

const runSearch = (p: Prepared, tables = p.tables, opts = FULL_SEARCH) => search(p.wheel, tables, p.budget, p.gemRm, p.forced.seed, opts);

const GATED_BOOST = 10;

/**
 * Search for one rotation plan. A plan gated on a revelation (D20) whose search misses that revelation gets a
 * second (full) run with the revelation boosted, so it is judged on a valid build; the better valid state wins.
 */
function searchPlan(p: Prepared, opts = FULL_SEARCH): State {
  const st = runSearch(p, p.tables, opts);
  const d = revelationIndex(p.wheel.revelations, p.v.model.plan.requires);
  if (d < 0 || planValid(p, gridStages(p, st))) return st;
  const boosted = runSearch(p, blendTables(p.parts, p.blend, [0, 1, 2, 3].map((x) => (x === d ? GATED_BOOST : 1))), FULL_SEARCH);
  return planValid(p, gridStages(p, boosted)) ? boosted : st;
}

type BuildResult = Omit<OptimizerResult, 'alternatives'>;

function assemble(p: Prepared, best: State): BuildResult {
  const { input, wheel, v, blend, gems } = p;
  const vesselSlices = wheel.vesselTiles.filter((i) => isFull(wheel, best.alloc, i)).length;
  const unlocked = Math.min(wheel.definition.vessels.length, vesselSlices);
  const gridRev = DOMAIN_ORDER.map((_, d) => best.domainPts[d] + RM_SLICE_POINTS * best.rmFull[d]);
  const wheelEffects = wheelEffectsFor(wheel, best.alloc);
  let env: GemEnv = { v, wheel, blend, facts: factsFor(gridRev, wheelEffects), grades: modGrades(p.gems) };
  const placed = placeGems(env, gems, unlocked);
  let vessels = vesselAssignments(env, unlocked, placed);
  const rmGem = placedRmPoints(env, vessels);
  const finalRev = gridRev.map((x, d) => x + rmGem[d]);
  if (rmGem.some((x) => x > 0)) {
    env = { ...env, facts: factsFor(finalRev, wheelEffects) };
    vessels = vesselAssignments(env, unlocked, placed);
  }
  const stages = env.facts.stages;

  const allocation: Record<string, number> = {};
  wheel.slices.forEach((s, i) => {
    if (best.alloc[i] > 0) allocation[s.slice.id] = best.alloc[i];
  });
  const domainPoints = {} as Record<Domain, number>;
  DOMAIN_ORDER.forEach((d, i) => (domainPoints[d] = best.domainPts[i]));
  const revelations: ActivatedRevelation[] = wheel.revelations.map((r, d) => ({ perk: r.perk, stage: stages[d], domainPoints: finalRev[d] }));

  const got = rawTotals(wheel, p.parts, best.alloc, stages, false);
  const max = rawTotals(wheel, p.parts, wheel.slices.map((s) => s.capacity), [3, 3, 3, 3], false);
  const norm = (a: number, b: number) => (b > 0 ? Math.max(0, Math.min(100, Math.round((a / b) * 100))) : 0);
  const why = rationale(p, best, stages, finalRev, unlocked, vesselSlices);

  return {
    allocation,
    path: best.path.map((i) => wheel.slices[i].slice.id),
    pointsUsed: best.used,
    pointsTotal: pointsOf(input),
    domainPoints,
    revelations,
    convictions: namedConvictions(wheel, best.alloc, best.path),
    stats: statLines(wheel, best.alloc, stages, env, vessels),
    offenseScore: norm(got.off, max.off),
    defenseScore: norm(got.def, max.def),
    rationale: why.map((x) => x.text),
    rationaleMsgs: why.map((x) => x.msg),
    vessels,
    gemRecommendations: recommendations(env),
    // Fragment Workshop upgrades only once every unlocked vessel holds a gem.
    upgradeRecommendations: vessels.every((vs) => !vs.unlocked || vs.gem) ? upgrades(env, vessels) : [],
    spells: spellUsages(v, stages, wheel),
    plannerCode: plannerCodeFor(input.vocation, allocation, vessels),
    rotation: rotationUsage(p, stages, best.alloc),
    stances: v.model.stances ?? [],
  };
}

// ---------------------------------------------------------------------------
// Planner export

/** Gem as the planner stores it: exactly the slots of the vessel quality (else the planner drops it). */
function plannerVessel(v: VesselAssignment): PlannerVessel | null {
  const g = v.gem;
  if (!v.unlocked || !g) return null;
  const slots = activeSlots(v.quality, v.quality);
  if (slots.some((s) => !g[s])) return null;
  const pv: PlannerVessel = { vesselId: v.vesselId };
  for (const s of slots) pv[s] = g[s]!.modId;
  return pv;
}

export function plannerCodeFor(vocation: OptimizerInput['vocation'], allocation: Record<string, number>, vessels: VesselAssignment[]): string {
  const points: Record<number, number> = {};
  for (const [id, pts] of Object.entries(allocation)) points[gridForSliceId(id, vocation)] = pts;
  const pv = vessels.map(plannerVessel).filter((x): x is PlannerVessel => !!x && plannerVesselIssues(vocation, [x]).length === 0);
  return encodePlannerCode({ vocation, points, vessels: pv });
}

// ---------------------------------------------------------------------------
// Alternatives

interface AltCandidate {
  kind: 'revelationFocus' | 'avatarFocus' | 'defensive' | 'offensive';
  priority: number;
  revScale: number[];
}

function topDomain(stages: number[], pts: number[], exclude: number[] = []): number {
  let best = -1;
  for (let d = 0; d < 4; d++) {
    if (exclude.includes(d) || stages[d] < 1) continue;
    if (best < 0 || stages[d] > stages[best] || (stages[d] === stages[best] && pts[d] > pts[best])) best = d;
  }
  return best;
}

function allocDistance(a: Int32Array, b: Int32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / 2;
}

const signed = (x: number) => (x > 0 ? `+${x}` : `${x}`);

/** Best valid rotation plan for a state (auto mode: every prepared plan; manual: the chosen one). */
function bestPlan(plans: Prepared[], st: State): { p: Prepared; obj: number } {
  let best: { p: Prepared; obj: number } | null = null;
  for (const q of plans) {
    if (plans.length > 1 && !planValid(q, gridStages(q, st))) continue;
    const obj = objective(q, st);
    if (!best || obj > best.obj + 1e-9) best = { p: q, obj };
  }
  return best ?? { p: plans[0], obj: objective(plans[0], st) };
}

/**
 * Alternatives to `main`. A candidate that beats the main build on the main objective (the beam is heuristic)
 * is promoted to main in place; alternatives too close to the new main are dropped.
 */
function alternatives(p: Prepared, plans: Prepared[], main: State, count: number): OptimizerResult {
  if (count <= 0 || p.budget < 100) return { ...assemble(p, main), alternatives: [] };
  const prio = clampPriority(p.input.priority);
  const stages = gridStages(p, main);
  const pts = DOMAIN_ORDER.map((_, d) => main.domainPts[d]);
  const top = topDomain(stages, pts);
  const second = top >= 0 ? topDomain(stages, pts, [top]) : -1;
  const scale = (ds: number[], k: number) => [0, 1, 2, 3].map((d) => (ds.includes(d) ? k : 1));
  const shift: AltCandidate = prio <= 65
    ? { kind: 'defensive', priority: Math.min(100, prio + 35), revScale: [1, 1, 1, 1] }
    : { kind: 'offensive', priority: Math.max(0, prio - 35), revScale: [1, 1, 1, 1] };
  const cands: AltCandidate[] = [];
  const avatar = p.wheel.revelations.findIndex((r) => r.data.isAvatar);
  if (p.v.context.mode === 'boss' && avatar >= 0 && stages[avatar] < 3) cands.push({ kind: 'avatarFocus', priority: prio, revScale: scale([avatar], 8) });
  if (top >= 0) cands.push({ kind: 'revelationFocus', priority: prio, revScale: scale([top], 0) });
  cands.push(shift);
  if (top >= 0 && second >= 0) cands.push({ kind: 'revelationFocus', priority: prio, revScale: scale([top, second], 0) });
  cands.push(shift.kind === 'defensive'
    ? { kind: 'offensive', priority: Math.max(0, prio - 35), revScale: [1, 1, 1, 1] }
    : { kind: 'defensive', priority: Math.min(100, prio + 35), revScale: [1, 1, 1, 1] });
  // fallbacks: push each other revelation that is not maxed
  for (let d = 0; d < 4; d++) if (d !== top && d !== avatar && stages[d] < 3) cands.push({ kind: 'revelationFocus', priority: prio, revScale: scale([d], 4) });

  const minDiff = Math.max(50, Math.round(0.1 * p.budget));
  const base = p;
  let mainObj = objective(p, main);
  let found: { c: AltCandidate; st: State; plan: { p: Prepared; obj: number } }[] = [];
  for (const c of cands) {
    if (found.length >= count) break;
    const q = c.priority === prio ? base : prepare(base.input, c.priority, base);
    const st = runSearch(base, c.revScale.every((x) => x === 1) ? q.tables : blendTables(q.parts, q.blend, c.revScale), LIGHT_SEARCH);
    const plan = bestPlan(plans, st);
    if (plan.obj > mainObj + 1e-9) {
      main = st;
      p = plan.p;
      mainObj = plan.obj;
      found = found.filter((f) => allocDistance(f.st.alloc, st.alloc) >= minDiff);
      continue;
    }
    if (allocDistance(main.alloc, st.alloc) < minDiff || found.some((f) => allocDistance(f.st.alloc, st.alloc) < minDiff)) continue;
    found.push({ c, st, plan });
  }
  const mainResult = assemble(p, main);
  const out: AlternativeBuild[] = [];
  const revNameOf = (stages: number[], st: State, all: boolean) => {
    const altTop = topDomain(stages, DOMAIN_ORDER.map((_, d) => st.domainPts[d]));
    if (altTop < 0) return '';
    const ds = DOMAIN_ORDER.map((_, d) => d).filter((d) => (all ? stages[d] > 0 : stages[d] === stages[altTop]));
    return ds.sort((a, b) => stages[b] - stages[a] || a - b).map((d) => p.wheel.revelations[d].data.name).join(' + ');
  };
  // All revelations at the alternative's highest stage, so e.g. 'A + B focus' and 'B focus' stay distinguishable;
  // when two focus alternatives would share that name, every active revelation is listed.
  const shortNames = found.map(({ st }) => revNameOf(gridStages(p, st), st, false));
  for (const [k, { c, st, plan }] of found.entries()) {
    const qa = c.priority === prio ? plan.p : prepare(p.input, c.priority, plan.p);
    const result = assemble(qa, st);
    const clash = shortNames.some((n, j) => j !== k && n === shortNames[k] && found[j].c.kind === 'revelationFocus');
    const revName = clash ? revNameOf(gridStages(p, st), st, true) : shortNames[k];
    const label =
      c.kind === 'avatarFocus'
        ? text('alt.avatarFocus', { revelation: p.wheel.revelations[avatar].data.name })
        : c.kind === 'revelationFocus'
          ? revName ? text('alt.revelationFocus', { revelation: revName }) : text('alt.noRevelation')
          : text(c.kind === 'defensive' ? 'alt.defensive' : 'alt.offensive');
    const relativeScore = mainObj > 0 ? Math.round((1000 * plan.obj) / mainObj) / 10 : 100;
    const revList = result.revelations.filter((r) => r.stage > 0).map((r) => `${r.perk.name} ${r.stage}`).join(', ') || '-';
    const tradeoff = text('alt.tradeoff', {
      offense: signed(result.offenseScore - mainResult.offenseScore),
      defense: signed(result.defenseScore - mainResult.defenseScore),
      score: relativeScore,
      revelations: revList,
    });
    out.push({ label: label.text, labelMsg: label.msg, tradeoff: tradeoff.text, tradeoffMsg: tradeoff.msg, relativeScore, result });
  }
  return { ...mainResult, alternatives: out.sort((a, b) => b.relativeScore - a.relativeScore) };
}

/**
 * The beam commits to revelation thresholds early; re-searching with one reached
 * domain damped lets other revelation mixes compete. Kept only if the exact objective improves
 * and the rotation stays valid.
 */
function refine(p: Prepared, best: State): State {
  if (p.budget >= p.wheel.definition.totalCapacity) return best;
  let bestObj = objective(p, best);
  const stages = gridStages(p, best);
  for (let d = 0; d < 4; d++) {
    if (stages[d] < 1 || stages[d] > 2) continue;
    const st = runSearch(p, blendTables(p.parts, p.blend, [0, 1, 2, 3].map((x) => (x === d ? 0.2 : 1))), LIGHT_SEARCH);
    const obj = objective(p, st);
    if (obj > bestObj + 1e-9 && (!p.auto || planValid(p, gridStages(p, st)))) {
      best = st;
      bestObj = obj;
    }
  }
  return best;
}

/**
 * Rotation plans to evaluate: the chosen preset, or (auto) every preset of the vocation plus the greedy
 * schedule in boss mode. All share one reference T0 (best plan without a revelation requirement).
 */
export function planSpecs(input: OptimizerInput): PlanSpec[] {
  const chosen = presetById(input.vocation, input.rotationId);
  const boss = input.context?.mode === 'boss';
  const all = getRotationPresets(input.vocation);
  const autoPlans: (RotationPreset | null)[] = [...all, ...(boss || !all.length ? [null] : [])];
  const presets = chosen ? [chosen] : autoPlans;
  const base = modelInputs(input).model;
  // Same reference in manual and auto mode, so offense values stay comparable.
  const reference = Math.max(1, ...autoPlans.filter((x) => !x?.requires?.revelation).map((x) => planTotal(base, x)));
  const wheel = getEngineWheel(input.vocation);
  const forced = forcedSeed(wheel, input.forcedSpells ?? [], Math.min(wheel.definition.totalCapacity, pointsOf(input)));
  const blend = blendWith(weightsFor(input.priority));
  return presets.map((preset) => {
    const { stances, v } = pickStances(input, preset, reference, blend);
    return { preset, stances, v, reference, auto: !chosen, forced };
  });
}

/**
 * D24: stances per plan, picked by their build-independent value (damage vs the reference, EHP) at the
 * user's priority; a preset may name its stance (monk virtues).
 */
export function pickStances(input: OptimizerInput, preset: RotationPreset | null, reference: number, blend: (p: Parts) => number) {
  const fixed = preset?.stance ? getStance(preset.stance) : undefined;
  const combos = fixed ? [[fixed]] : stanceCombos(input.vocation);
  let best = { stances: [] as StanceDef[], v: null as ValuationContext | null, score: -Infinity };
  for (const stances of combos) {
    const v = valuationFor(input, preset, reference, stances);
    const score = blend(baseParts(v));
    if (score > best.score + 1e-9) best = { stances, v, score };
  }
  return { stances: best.stances, v: best.v ?? undefined };
}

export function runOptimizer(raw: OptimizerInput): OptimizerResult {
  const input = raw.gems?.length ? { ...raw, gems: withSharedGrades(raw.gems) } : raw;
  const { p, plans, main } = bestBuild(input);
  const n = Math.max(0, Math.min(5, Math.floor(input.alternatives ?? DEFAULT_ALTERNATIVES)));
  const count = Number.isFinite(n) ? n : DEFAULT_ALTERNATIVES;
  const result = alternatives(p, plans, main, count);
  result.gemRecommendations = withRmReoptimized(input, p, main, result.gemRecommendations);
  return result;
}

/**
 * Revelation Mastery gems are valued by re-optimizing the wheel with the gem owned (grade I, in a greater
 * vessel): the gain covers a new stage as well as points freed for other slices. Light searches keep it cheap;
 * their bias cancels in the with/without difference.
 */
function withRmReoptimized(input: OptimizerInput, p: Prepared, main: State, recs: GemRecommendation[]): GemRecommendation[] {
  // A full wheel has no points to move: the static stage valuation is exact.
  if (p.budget >= p.wheel.definition.totalCapacity) return recs;
  const greater = recs.find((r) => r.quality === 'greater');
  const basic = (k: number) => {
    const m = greater?.mods.filter((x) => x.kind === 'basic')[k];
    return m ? { modId: m.modId, grade: m.grade } : null;
  };
  const rest = recs.filter((r) => !r.mods.some((m) => m.kind === 'supreme' && p.wheel.supremeMods.find((s) => s.id === m.modId)?.category === 'revelationMastery'));
  const out = [...rest];
  const grades = modGrades(p.gems);
  const probe = (supreme: GemModRef | null) => {
    const gem: OwnedGem = { id: 'rm-probe', quality: 'greater', basic1: basic(0), basic2: basic(1), supreme };
    const gems = [...p.gems, gem];
    // Same rotation plan and valuation; only the owned gems (vessel values, RM offsets) change.
    const q: Prepared = { ...prepare({ ...input, gems }, input.priority, p), gemRm: ownedRmOffsets(p.wheel, gems) };
    return { p: q, main: searchPlan(q, PROBE_SEARCH) };
  };
  const basicsGain = recs.find((r) => r.quality === 'regular')?.gain ?? 0;
  const plain = probe(null);
  const plainObj = objective(plain.p, plain.main);
  const before = gridStages(p, main);
  for (const m of p.wheel.supremeMods) {
    if (m.category !== 'revelationMastery') continue;
    const d = revelationIndex(p.wheel.revelations, m.revelation);
    // Avatars are not recommended for hunting.
    if (d < 0 || (p.wheel.revelations[d].data.isAvatar && p.v.context.mode !== 'boss')) continue;
    const grade = Math.max(NEW_GEM_GRADE, grades.get(modKey('supreme', m.id)) ?? 0) as ModGrade;
    const hypo = probe({ modId: m.id, grade });
    const obj = objective(hypo.p, hypo.main);
    // RM value = the same greater gem with vs without the mod (both re-optimized); basics as valued statically.
    const rmGain = obj - plainObj;
    if (rmGain <= 0.05) continue;
    const gain = basicsGain + rmGain;
    const stage = gridStages(hypo.p, hypo.main)[d];
    const revelation = m.revelation ?? '';
    const msg = stage > before[d] ? text('gem.rmReopt', { revelation, stage }) : text('gem.rmReoptFree', { revelation });
    out.push({
      quality: 'greater',
      mods: [
        ...(greater?.mods.filter((x) => x.kind === 'basic') ?? []),
        { kind: 'supreme', modId: m.id, name: m.name, grade },
      ],
      gain: round1(gain),
      reason: msg.text,
      reasonMsg: msg.msg,
      similar: [],
    });
  }
  return out.sort((a, b) => b.gain - a.gain);
}

/** Best build (plan + allocation) for an input, without alternatives. */
function bestBuild(input: OptimizerInput): { p: Prepared; plans: Prepared[]; main: State } {
  const plans = planSpecs(input).map((spec) => prepare(input, input.priority, undefined, spec));
  // D20: the rotation is chosen jointly with the build: a light search per plan screens them, the best (and a
  // runner-up within 2 %) get a full search; the best valid objective wins.
  let p = plans[0];
  let best: State | null = null;
  let bestObj = -Infinity;
  const consider = (q: Prepared, st: State) => {
    if (plans.length > 1 && !planValid(q, gridStages(q, st))) return;
    const obj = objective(q, st);
    if (obj > bestObj + 1e-9) {
      p = q;
      best = st;
      bestObj = obj;
    }
  };
  let finalists = plans;
  if (plans.length > 2) {
    const screened = plans.map((q) => {
      const st = searchPlan(q, SCREEN_SEARCH);
      consider(q, st);
      return { q, obj: planValid(q, gridStages(q, st)) ? objective(q, st) : -Infinity };
    });
    screened.sort((a, b) => b.obj - a.obj);
    finalists = screened.filter((x, i) => i === 0 || (i === 1 && x.obj >= screened[0].obj - 0.02 * Math.abs(screened[0].obj))).map((x) => x.q);
  }
  for (const q of finalists) consider(q, searchPlan(q));
  return { p, plans, main: refine(p, best ?? runSearch(p)) };
}
