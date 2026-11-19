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
  GainEffect,
  FightContext,
  GemModRef,
  GemRecommendation,
  ModGrade,
  OptimizerInput,
  OptimizerResult,
  OwnedGem,
  OwnedWeapon,
  Perk,
  RevelationOption,
  RevelationReach,
  RotationPreset,
  RotationUsage,
  SpellUsage,
  StatLine,
  VesselAssignment,
  WeaponPick,
  WeaponReshape,
  WeaponResult,
} from '../types';
import { ammoFor, shapedPerk, shapingId, shapingOptions, weaponsFor, type Ammo, type Perk as ProfPerk, type Weapon } from '../data/proficiency';
import { choosePerks, loadoutCharacter, loadoutOf, loadoutParts, ownedOptions, type Loadout } from './proficiency';
import { encodePlannerCode, gridForSliceId, plannerVesselIssues, type PlannerVessel } from '../data/wheel/plannerCode';
import { resolveCharacterStats } from '../data/character';
import { BALLISTIC_MASTERY, healingAverage, pierceDamageMod, POSITIONAL_TACTICS, TURN_SECONDS } from '../data/damage';
import { getRotationPresets } from '../data/damage/rotations';
import { getStance, stanceCombos, type StanceDef } from '../data/damage/stances';
import { stanceBuilder, stanceDefense, stancedCharacter } from './stances';
import {
  activeSlots,
  effectOf,
  type GemEnv,
  gemParts,
  modGrades,
  modKey,
  withSharedGrades,
  NEW_GEM_GRADE,
  placedRmPoints,
  placeGems,
  recommendations,
  withRoom,
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
  NO_BONUS,
  normaliseMonsters,
  planFor,
  planTotal,
  cooldownTurns,
  reducedCooldown,
  REVELATION_SPELLS,
  rotation,
  rotationTotal,
  targetsAt,
  spellCooldown,
  type RotationInput,
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
  leechEhp,
  mitigationParts,
  type Parts,
  parseEffects,
  revelationIndex,
  revelationParts,
  type SpellEffect,
  spotMonster,
  sub,
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

/** `leech` = % EHP per +1 % damage (D29: life leech sustain), added to the offense weight. */
export function weightsFor(priority: number, leech = 0): Weights {
  const p = clampPriority(priority) / 100;
  const def = Math.max(MIN_WEIGHT, p);
  return { off: Math.max(MIN_WEIGHT, 1 - p) + def * leech, def, util: UTIL_WEIGHT };
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
  /** Revelation points from slices per domain: domainPts + full RM slices. */
  slicesRev: number[];
  vessels: number;
  score: number;
  path: number[];
  key: number;
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
  /** complete() results by the full-slice states its greedy chain passed (beam states repeat that chain). */
  completed: Map<number, { from: State; done: State }>;
}

const isFull = (w: EngineWheel, alloc: ArrayLike<number>, i: number) => alloc[i] >= w.slices[i].capacity;
const revPts = (s: Search, st: State, d: number, vessels: number) => st.slicesRev[d] + s.gemRm[vessels][d];

/** Beam rank of st after adding `pts` to slice i, without allocating the new state. */
function rankOf(s: Search, st: State, i: number, pts: number, delta: number): number {
  const sl = s.wheel.slices[i];
  const fills = st.alloc[i] + pts >= sl.capacity;
  const vessels = fills && sl.kind === 'vessel' ? Math.min(st.vessels + 1, s.gemRm.length - 1) : st.vessels;
  const remaining = s.budget - st.used - pts;
  let shaping = 0;
  for (let d = 0; d < 4; d++) {
    let dp = revPts(s, st, d, vessels);
    if (d === sl.domainIdx) dp += pts + (fills && sl.kind === 'rm' ? RM_SLICE_POINTS : 0);
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
    const before = revPts(s, st, d, st.vessels);
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
  const rmFill = fills && sl.kind === 'rm';
  const rmFull = rmFill ? st.rmFull.map((x, d) => (d === sl.domainIdx ? x + 1 : x)) : st.rmFull;
  const slicesRev = st.slicesRev.slice();
  slicesRev[sl.domainIdx] += pts + (rmFill ? RM_SLICE_POINTS : 0);
  const next: State = {
    alloc,
    used: st.used + pts,
    domainPts,
    rmFull,
    slicesRev,
    vessels: fills && sl.kind === 'vessel' ? Math.min(st.vessels + 1, s.gemRm.length - 1) : st.vessels,
    score: 0,
    path: st.path.includes(i) ? st.path : [...st.path, i],
    key: fills ? st.key + 2 ** i : st.key,
  };
  next.score = st.score + delta;
  return next;
}

/** Greedily spends leftover points; only the last touched slice may be partial. */
function complete(s: Search, start: State): State {
  const hit = s.completed.get(start.key);
  if (hit && sameState(hit.from, start)) return hit.done;
  const chain: State[] = [];
  const done = greedyFill(s, start, chain);
  for (const st of chain) s.completed.set(st.key, { from: st, done });
  return done;
}

/** Exactly equal (score bits and fill order), so a remembered completion is the one complete() would compute. */
const sameState = (a: State, b: State) =>
  a === b || (a.score === b.score && a.path.length === b.path.length && a.path.every((x, k) => x === b.path[k]));

function greedyFill(s: Search, start: State, chain: State[]): State {
  let st = start;
  const n = s.wheel.slices.length;
  for (;;) {
    chain.push(st);
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

/** Rebuilds a state from full slices (any valid order) and an optional partial one; null when not connected. */
function replay(s: Search, start: State, full: number[], partial: number, partialPts: number): State | null {
  let st = start;
  let left = full;
  while (left.length) {
    const k = left.findIndex((i) => isAvailable(s.wheel, st.alloc, i));
    if (k < 0) return null;
    const i = left[k];
    st = extend(s, st, i, s.wheel.slices[i].capacity);
    left = [...left.slice(0, k), ...left.slice(k + 1)];
  }
  if (partial < 0) return st;
  return isAvailable(s.wheel, st.alloc, partial) ? extend(s, st, partial, partialPts) : null;
}

/**
 * D59: 1-for-1 swaps of a full slice for an empty one of the same capacity (e.g. a Revelation Mastery slice whose
 * points cross no threshold vs a skill boost next to it). The beam's revelation look-ahead can miss these.
 */
function improveSwaps(s: Search, start: State, best: State): State {
  const n = s.wheel.slices.length;
  for (let round = 0; round < 4; round++) {
    const full = best.path.filter((i) => isFull(s.wheel, best.alloc, i));
    const partial = best.path.find((i) => best.alloc[i] > 0 && !isFull(s.wheel, best.alloc, i)) ?? -1;
    let found: State | null = null;
    for (const i of full) {
      if (start.alloc[i] > 0) continue;
      for (let j = 0; j < n; j++) {
        if (best.alloc[j] > 0 || s.wheel.slices[j].capacity !== s.wheel.slices[i].capacity) continue;
        const st = replay(s, start, full.filter((x) => x !== i && start.alloc[x] === 0).concat(j), partial, partial >= 0 ? best.alloc[partial] : 0);
        if (st && st.score > (found ?? best).score + 1e-9) found = st;
      }
    }
    if (!found) return best;
    best = found;
  }
  return best;
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
  const s: Search = { wheel, t, budget, density, gemRm, pairs, completed: new Map() };
  let empty: State = {
    alloc: new Int32Array(n),
    used: 0,
    domainPts: [0, 0, 0, 0],
    rmFull: [0, 0, 0, 0],
    slicesRev: [0, 0, 0, 0],
    vessels: 0,
    score: 0,
    path: [],
    key: 0,
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
  return opts === FULL_SEARCH ? improveSwaps(s, empty, best) : best;
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

/**
 * Build-independent value of a plan: rotation + stance (+ weapon) offense vs the reference, offhand mitigation,
 * stance defense and weapon sustain.
 */
export function baseParts(v: ValuationContext): Parts {
  const p = {
    off: v.model.baseOff,
    def: 100 * ((100 - v.mitigationRef) / Math.max(50, 100 - v.mitigation) - 1) * v.threat + (v.stanceDef ?? 0),
    util: 0,
  };
  return v.weapon ? add(p, v.weapon) : p;
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
    // D59: ties by domain, not gem id, so a recommendation probe and the gem the player adds land the same way.
    .sort((a, b) => b.pts - a.pts || a.d - b.d || a.id.localeCompare(b.id));
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
const PER_MINUTE = 60 / TURN_SECONDS;

/** D67: damage window shown under the rotation (s). */
const DAMAGE_WINDOW = 30;

function rotationUsage(p: Prepared, stages: number[], alloc: ArrayLike<number>): RotationUsage {
  const { v, wheel } = p;
  const augments = wheel.slices.filter((s) => s.kind === 'augment' && isFull(wheel, alloc, s.idx)).map((s) => s.tile);
  const mods = augmentMods(v, augments);
  const vesselSlices = wheel.vesselTiles.filter((i) => isFull(wheel, alloc, i)).length;
  const flat = stages.reduce((a, st) => a + REVELATION_FLAT_BONUS[st], 0) + vesselSlices;
  const rot = rotation(v.model, { stages, mods, flat });
  const turns = DAMAGE_WINDOW / TURN_SECONDS;
  const spells: RotationUsage['spells'] = [];
  for (const [name, x] of rot.rates) {
    if (x.rate <= 0) continue;
    const s = v.model.spells.get(name);
    const targets = s ? targetsAt(v.model, s, s.stageDomain >= 0 ? stages[s.stageDomain] ?? 0 : 0, mods.get(name)?.extraTargets ?? 0) : 1;
    spells.push({
      name,
      ratio: round1(x.rate * PER_MINUTE),
      share: round1((100 * x.rate * x.perCast) / rot.total),
      ...(s && s.revelation >= 0 ? { fromRevelation: true } : {}),
      damage: { casts: round1(x.rate * turns), targets: round1(s?.singleTarget ? 1 : targets), perCast: Math.round(x.perCast), total: Math.round(x.rate * turns * x.perCast) },
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
  const autoAttack = round1((100 * v.model.base) / rot.total);
  const window = { seconds: DAMAGE_WINDOW, autoAttack: Math.round(v.model.base * turns), total: Math.round(rot.total * turns) };
  return { presetId: v.model.plan.id, auto: p.auto, spells, ...(autoAttack > 0 ? { autoAttack } : {}), window };
}

type Msg = { msg: EngineMessage; text: string };

const UNIQUE_REASON: Partial<Record<string, EngineMessageKey>> = {
  'Positional Tactics': 'rationale.uniquePositional',
  'Battle Instinct': 'rationale.uniqueBattleInstinct',
  'Battle Healing': 'rationale.uniqueBattleHealing',
  'Runic Mastery': 'rationale.uniqueRunic',
  'Focus Mastery': 'rationale.uniqueFocus',
  'Healing Link': 'rationale.uniqueHealingLink',
  Sanctuary: 'rationale.uniqueSanctuary',
};

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
  const r = f.rotation;
  if (r?.taken.length) out.push(text('rationale.rotationCooldown', { spells: r.taken.map((x) => (r.stage2.includes(x) ? `${x} II` : x)).join(', ') }));
  if (r?.missing.length) out.push(text('rationale.rotationCooldownMissing', { spells: r.missing.join(', ') }));
  if (r?.tooLong.length) out.push(text('rationale.rotationCooldownTooLong', { spells: r.tooLong.join(', ') }));
  const extra = f.taken.filter((s) => !p.input.forcedStage2?.includes(s) && wheel.slices.some((sl) => sl.kind === 'augment' && sl.twin > sl.idx && sl.tile.conviction.augment?.spells.includes(s) && isFull(wheel, best.alloc, sl.idx) && isFull(wheel, best.alloc, sl.twin)));
  if (extra.length) out.push(text('rationale.forcedExtra', { spells: extra.join(', ') }));
  if (p.revBlocked.length) out.push(text('rationale.revelationBlocked', { revelations: p.revBlocked.join(', ') }));
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

  // D61: why each chosen unique conviction (Ballistic Mastery, Positional Tactics, …) is in the build.
  const signed = (x: number) => `${x >= 0 ? '+' : '−'}${round1(Math.abs(x))}%`;
  for (const i of best.path) {
    const sl = wheel.slices[i];
    if (sl.kind !== 'unique' || !isFull(wheel, best.alloc, i)) continue;
    const perk = sl.tile.conviction.name;
    const e = effectOf(v, p.parts.convP[i]);
    if (Math.abs(e.dmg) < 0.05 && Math.abs(e.ehp) < 0.05) {
      out.push(text('rationale.uniquePath', { perk }));
      continue;
    }
    const key: EngineMessageKey =
      perk === 'Ballistic Mastery' ? (ctx.mode === 'boss' ? 'rationale.uniqueBallisticBoss' : 'rationale.uniqueBallisticHunt') : (UNIQUE_REASON[perk] ?? 'rationale.uniqueOther');
    const gain = [Math.abs(e.dmg) >= 0.05 ? `${signed(e.dmg)} damage` : '', Math.abs(e.ehp) >= 0.05 ? `${signed(e.ehp)} EHP` : ''].filter(Boolean).join(', ');
    out.push(text(key, { perk, gain }));
  }

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
  loadout?: Loadout,
  preCd?: ReadonlyMap<string, number>,
): ValuationContext {
  const mi0 = modelInputs(input);
  const { context, level, monsters } = mi0;
  const build = stanceBuilder(input.vocation, context, monsters, stances, preset, loadout, preCd);
  const armed = loadout ? loadoutCharacter(mi0.character, input.vocation, loadout) : mi0.character;
  const character = stancedCharacter(armed, stances);
  const mi = stances.length || loadout || preCd ? { ...mi0, character, model: build(character) } : mi0;
  const model = withPlan(mi.model, preset, reference);
  const t0 = planTotal(mi.model, preset);
  const mage = input.vocation === 'sorcerer' || input.vocation === 'druid';
  const boosted = mage ? { ...character, magicLevel: character.magicLevel + 1 } : { ...character, mainSkill: character.mainSkill + 1 };
  const skillOff = (100 * (planTotal(build(boosted), preset) - t0)) / model.total;
  const monster = spotMonster(monsters);
  const threat = threatOf(monster);
  const offhand = model.plan.shield ? 'shield' : undefined;
  const facts = characterFacts(input.vocation, level, character.shielding, offhand);
  // EHP reference without stances and weapon, so Protector's (and the weapon's) shielding counts.
  facts.mitigationRef = characterFacts(input.vocation, level, mi0.character.shielding).mitigationRef;
  const v: ValuationContext = {
    vocation: input.vocation,
    context,
    monster,
    model,
    level,
    threat,
    ...facts,
    leech: leechEhp(model, threat),
    stanceDef: stanceDefense(model, armed, stances, K.HEAL_EHP) * threat,
    incoming: incomingShares(monsters),
    skillOff: Math.max(0, skillOff),
    forced: new Set(input.forcedSpells ?? []),
    ...(preCd ? { preCd } : {}),
    unique: input.vocation === 'paladin' ? paladinUniques(mi, model, preset, threat, build) : {},
  };
  if (loadout) v.weapon = loadoutParts(v, loadout);
  return v;
}

// ---------------------------------------------------------------------------
// Forced spells (D21)

interface ForcedInfo {
  /** Slices to fill first (unlock order). */
  seed: number[];
  taken: string[];
  impossible: string[];
  noAugment: string[];
  /** D65: augments the preset's ratio needs (shorter cooldown): taken, out of budget, or none reaches it. */
  rotation?: { taken: string[]; missing: string[]; tooLong: string[]; stage2: string[]; cut: ReadonlyMap<string, number> };
}

/**
 * D65: cooldown augments a preset needs. A spell with ratio r in a preset of ratio sum R is cast every R/r
 * turns, so its cooldown (on the 2 s grid, after proficiency) must fit; else the cheapest augment stage that fits.
 */
export function presetCooldownNeeds(wheel: EngineWheel, model: SpellModel, entries: readonly { name: string; ratio: number }[], preCd?: ReadonlyMap<string, number>) {
  const sum = entries.reduce((a, e) => a + e.ratio, 0);
  const out = { stage1: [] as string[], stage2: [] as string[], tooLong: [] as string[], cut: new Map<string, number>() };
  for (const e of entries) {
    if (e.ratio <= 0 || REVELATION_SPELLS[e.name]) continue;
    const base = spellCooldown(e.name);
    const own = (model.spells.get(e.name)?.cd ?? 0) - (preCd?.get(e.name) ?? 0);
    const fits = (red: number) => cooldownTurns(reducedCooldown(base, own + red)) <= sum / e.ratio + 1e-9;
    if (fits(0)) continue;
    const tile = wheel.slices.find((sl) => sl.kind === 'augment' && sl.tile.conviction.augment?.spells.includes(e.name))?.tile.conviction.augment;
    const cd = (t: string) => parseEffects(t).reduce((a, x) => a + (x.kind === 'cd' ? x.amount : 0), 0);
    const one = tile ? cd(tile.stage1) : 0;
    if (tile && one > 0 && fits(one)) {
      out.stage1.push(e.name);
      out.cut.set(e.name, one);
    } else if (tile && fits(one + cd(tile.stage2))) {
      out.stage2.push(e.name);
      out.cut.set(e.name, one + cd(tile.stage2));
    } else out.tooLong.push(e.name);
  }
  return out;
}

/** D65: forced augments of a plan: the user's plus those its preset's cooldowns need. */
function planForced(wheel: EngineWheel, input: OptimizerInput, budget: number, model?: SpellModel, preCd?: ReadonlyMap<string, number>): ForcedInfo {
  const user = input.forcedSpells ?? [];
  const userStage2 = input.forcedStage2 ?? [];
  const needs = model?.plan.preset ? presetCooldownNeeds(wheel, model, model.plan.entries, preCd) : null;
  if (!needs) return forcedSeed(wheel, user, budget, userStage2);
  const extra = [...needs.stage1, ...needs.stage2];
  const stage2 = [...new Set([...userStage2, ...needs.stage2])];
  const f = forcedSeed(wheel, [...user, ...extra], budget, stage2);
  const mine = (x: string) => extra.includes(x) && !user.includes(x);
  return {
    ...f,
    taken: f.taken.filter((x) => !mine(x)),
    impossible: f.impossible.filter((x) => !mine(x)),
    rotation: { taken: f.taken.filter(mine), missing: f.impossible.filter(mine), tooLong: needs.tooLong, stage2: needs.stage2, cut: needs.cut },
  };
}

/** D69: cooldown cuts of the rotation augments a plan always takes; its valuation starts from them. */
function preCdOf(f: ForcedInfo): Map<string, number> | undefined {
  const r = f.rotation;
  if (!r?.taken.length) return undefined;
  return new Map(r.taken.map((x) => [x, r.cut.get(x) ?? 0]));
}

const sameCd = (a?: ReadonlyMap<string, number>, b?: ReadonlyMap<string, number>) =>
  (a?.size ?? 0) === (b?.size ?? 0) && [...(a ?? [])].every(([k, x]) => b?.get(k) === x);

/** Cheapest unlock path (Dijkstra over slice capacities, filled slices free) to one of `targets`; new slices only. */
function cheapestPath(wheel: EngineWheel, full: ReadonlySet<number>, targets: readonly number[]): { cost: number; path: number[] } | null {
  const n = wheel.slices.length;
  const next: number[][] = wheel.slices.map(() => []);
  wheel.slices.forEach((s) => s.unlockedBy.forEach((j) => next[j].push(s.idx)));
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
  if (!(dist[target] < Infinity)) return null;
  const path: number[] = [];
  for (let i = target; i >= 0; i = prev[i]) if (!full.has(i)) path.unshift(i);
  return { cost: dist[target], path };
}

/** Cheapest unlock path to an augment slice of each forced spell. */
function forcedSeed(wheel: EngineWheel, spells: readonly string[], budget: number, stage2: readonly string[] = []): ForcedInfo {
  const out: ForcedInfo = { seed: [], taken: [], impossible: [], noAugment: [] };
  const full = new Set<number>();
  let used = 0;
  for (const spell of [...new Set(spells)]) {
    const augs = wheel.slices.filter((s) => s.kind === 'augment' && s.tile.conviction.augment?.spells.includes(spell));
    const targets = augs.map((s) => s.idx);
    if (!targets.length) {
      out.noAugment.push(spell);
      continue;
    }
    if (stage2.includes(spell)) {
      // D35: both slices of the cheapest pair.
      let best: { cost: number; path: number[] } | null = null;
      for (const s of augs) {
        if (s.twin < s.idx) continue;
        const p = pairPath(wheel, full, [s.idx, s.twin]);
        if (p && (!best || p.cost < best.cost)) best = p;
      }
      if (!best || used + best.cost > budget) out.impossible.push(spell);
      else {
        best.path.forEach((i) => full.add(i));
        out.seed.push(...best.path);
        used += best.cost;
        out.taken.push(spell);
      }
      continue;
    }
    if (targets.some((t) => full.has(t))) {
      out.taken.push(spell);
      continue;
    }
    const p = cheapestPath(wheel, full, targets);
    if (!p || used + p.cost > budget) {
      out.impossible.push(spell);
      continue;
    }
    p.path.forEach((i) => full.add(i));
    out.seed.push(...p.path);
    used += p.cost;
    out.taken.push(spell);
  }
  return out;
}

/** Cheapest new slices (and their cost) to fill both slices of an augment pair, given the filled set. */
function pairPath(wheel: EngineWheel, filled: ReadonlySet<number>, pair: readonly [number, number]): { cost: number; path: number[] } | null {
  const full = new Set(filled);
  const path: number[] = [];
  let cost = 0;
  for (let k = 0; k < 2; k++) {
    const left = pair.filter((i) => !full.has(i));
    if (!left.length) break;
    const p = cheapestPath(wheel, full, left);
    if (!p) return null;
    p.path.forEach((i) => full.add(i));
    path.push(...p.path);
    cost += p.cost;
  }
  return { cost, path };
}

/** Seed: `base` plus the cheapest paths to both slices of an augment pair; null when over budget. */
function pairSeed(wheel: EngineWheel, base: readonly number[], pair: readonly [number, number], budget: number): number[] | null {
  const p = pairPath(wheel, new Set(base), pair);
  const used = base.reduce((a, i) => a + wheel.slices[i].capacity, 0);
  return p && used + p.cost <= budget ? [...base, ...p.path] : null;
}

/**
 * D35: fewest wheel points that bring domain `d` to `need` revelation points (domain slices from the centre,
 * RM slices add their bonus; a partial last slice counts). Greedy by revelation points per wheel point.
 * `base`: slices already filled (free); their domain points count.
 */
function domainCost(wheel: EngineWheel, d: number, need: number, base?: Int32Array): number {
  const alloc = base ? Int32Array.from(base) : new Int32Array(wheel.slices.length);
  let have = 0;
  for (const s of wheel.slices) if (s.domainIdx === d && isFull(wheel, alloc, s.idx)) have += s.capacity + (s.kind === 'rm' ? RM_SLICE_POINTS : 0);
  if (have >= need) return 0;
  let cost = 0;
  for (;;) {
    let best = -1;
    let bestRatio = -1;
    for (const s of wheel.slices) {
      if (s.domainIdx !== d || alloc[s.idx] > 0) continue;
      if (!s.initiallyUnlocked && !s.unlockedBy.some((j) => isFull(wheel, alloc, j))) continue;
      const ratio = (s.capacity + (s.kind === 'rm' ? RM_SLICE_POINTS : 0)) / s.capacity;
      if (ratio > bestRatio + 1e-9 || (Math.abs(ratio - bestRatio) < 1e-9 && s.capacity < wheel.slices[best].capacity)) {
        best = s.idx;
        bestRatio = ratio;
      }
    }
    if (best < 0) return Infinity;
    const s = wheel.slices[best];
    const gain = s.capacity + (s.kind === 'rm' ? RM_SLICE_POINTS : 0);
    if (have + gain >= need && s.kind !== 'rm') return cost + (need - have);
    alloc[best] = s.capacity;
    have += gain;
    cost += s.capacity;
    if (have >= need) return cost;
  }
}

/**
 * D38: cheapest fills that unlock 0..8 vessels (index = vessel count), greedy nearest vessel node; one variant
 * prefers nodes of domain `d` (they also add revelation points there). An RM gem counts only in an unlocked
 * greater vessel, so its reach must pay for those nodes.
 */
function vesselFills(wheel: EngineWheel, d: number): { alloc: Int32Array; cost: number }[][] {
  return [false, true].map((prefer) => {
    const full = new Set<number>();
    let cost = 0;
    const out = [{ alloc: new Int32Array(wheel.slices.length), cost: 0 }];
    for (let c = 1; c <= wheel.vesselTiles.length; c++) {
      const left = wheel.vesselTiles.filter((i) => !full.has(i));
      const own = left.filter((i) => wheel.slices[i].domainIdx === d);
      const p = left.length ? cheapestPath(wheel, full, prefer && own.length ? own : left) : null;
      if (!p) break;
      p.path.forEach((i) => full.add(i));
      cost += p.cost;
      const alloc = new Int32Array(wheel.slices.length);
      full.forEach((i) => (alloc[i] = wheel.slices[i].capacity));
      out.push({ alloc, cost });
    }
    return out;
  });
}

/** D35: reach of every revelation stage for the input's budget and owned gems. */
export function revelationOptions(input: Pick<OptimizerInput, 'vocation' | 'points' | 'gems' | 'character'>): RevelationOption[] {
  const wheel = getEngineWheel(input.vocation);
  const budget = Math.min(wheel.definition.totalCapacity, pointsOf(input as OptimizerInput));
  const owned = input.gems ?? [];
  return wheel.revelations.map((r) => {
    const d = r.domainIdx;
    const mod = wheel.supremeMods.find((m) => m.category === 'revelationMastery' && m.revelation === r.data.name);
    const gem = owned.find((g) => g.quality === 'greater' && g.supreme?.modId === mod?.id);
    const fills = vesselFills(wheel, d);
    // Reachable when some vessel count c (RM gems placed by ownedRmOffsets) plus the domain points fit the budget.
    const fits = (gems: OwnedGem[], t: number) => {
      const offsets = ownedRmOffsets(wheel, gems);
      return fills.some((f) => f.some((x, c) => x.cost + domainCost(wheel, d, t - offsets[Math.min(c, offsets.length - 1)][d], x.alloc) <= budget));
    };
    const others = owned.filter((g) => g !== gem);
    const withGrade = (g: number): OwnedGem[] => [...others, { id: 'reach-probe', quality: 'greater', basic1: null, basic2: null, supreme: { modId: mod!.id, grade: g as ModGrade } }];
    const stages = REVELATION_THRESHOLDS.map((t): RevelationReach => {
      if (fits(owned, t)) return { status: 'ok' };
      if (mod) {
        for (let g = gem ? gem.supreme!.grade + 1 : 1; g <= 4; g++) {
          if (fits(withGrade(g), t)) return { status: gem ? 'upgrade' : 'gem', grade: g as 1 | 2 | 3 | 4 };
        }
      }
      return { status: 'impossible' };
    });
    return { name: r.data.name, stages };
  });
}

/** D35: minimum stage per domain from the forced revelations reachable now; the rest are reported. */
function forcedStages(input: OptimizerInput, wheel: EngineWheel): { min: number[]; blocked: string[] } {
  const min = [0, 0, 0, 0];
  const blocked: string[] = [];
  const forced = input.forcedRevelations ?? [];
  if (!forced.length) return { min, blocked };
  const reach = revelationOptions(input);
  for (const f of forced) {
    const d = revelationIndex(wheel.revelations, f.name);
    if (d < 0) continue;
    if (reach[d]?.stages[f.stage - 1]?.status === 'ok') min[d] = Math.max(min[d], f.stage);
    else blocked.push(`${f.name} ${ROMAN_STAGE[f.stage]}`);
  }
  return { min, blocked };
}

const ROMAN_STAGE = ['', 'I', 'II', 'III'];
/** D35: revelation value below a forced stage. */
const FORCED_PENALTY = 1e4;

/** D35: tables with a penalty on revelation stages below the forced ones, graded per missing stage (D38) so the search sees progress. */
function forceTables(t: Tables, min: readonly number[]): Tables {
  if (min.every((x) => x === 0)) return t;
  return { ...t, rev: t.rev.map((r, d) => Float64Array.from(r, (x, k) => (k < min[d] ? x - FORCED_PENALTY * (min[d] - k) : x))) };
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
  /** D35: forced minimum revelation stage per domain; forced stages out of reach. */
  minStages: number[];
  revBlocked: string[];
  /** D45: the plan this was prepared from (weapon re-choice). */
  spec?: PlanSpec;
  weapon?: WeaponChoice;
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
  /** D69: cooldown cuts (s) of the plan's rotation augments, already in its valuation. */
  preCd?: ReadonlyMap<string, number>;
  /** D45: weapon and perks of this plan. */
  weapon?: WeaponChoice;
}

function prepare(input: OptimizerInput, priority = input.priority, base?: Prepared, spec?: PlanSpec): Prepared {
  const wheel = getEngineWheel(input.vocation);
  const v = base?.v ?? spec?.v ?? valuationFor(input, spec?.preset ?? null, spec?.reference, spec?.stances, spec?.weapon && choiceLoadout(spec.weapon), spec?.preCd);
  const budget = Math.min(wheel.definition.totalCapacity, pointsOf(input));
  const gems = input.gems ?? [];
  const blend = blendWith(weightsFor(priority, v.leech));
  // Pre-search owned-gem estimate (D23: no recommended gems): revelation spells at the stage ~60 % of the budget reaches; RM gems are handled by gemRm.
  const assumed = stageFor(Math.min(1000, Math.round(budget * 0.6)));
  const preEnv: GemEnv = { v, wheel, blend, facts: factsFor([1e9, 1e9, 1e9, 1e9], new Map(), [assumed, assumed, assumed, assumed]) };
  const vesselP = vesselTable(preEnv, gems);
  const parts = base ? { ...base.parts, vesselP } : partTables(wheel, v, vesselP);
  const fs = base ? { min: base.minStages, blocked: base.revBlocked } : forcedStages(input, wheel);
  return {
    input,
    wheel,
    v,
    budget,
    gems,
    gemRm: base?.gemRm ?? ownedRmOffsets(wheel, gems),
    parts,
    blend,
    tables: forceTables(blendTables(parts, blend), fs.min),
    forced: base?.forced ?? spec?.forced ?? forcedSeed(wheel, input.forcedSpells ?? [], budget, input.forcedStage2),
    auto: base?.auto ?? spec?.auto ?? false,
    minStages: fs.min,
    revBlocked: fs.blocked,
    spec: base?.spec ?? spec,
    weapon: base?.weapon ?? spec?.weapon,
  };
}

const gridStages = (p: Prepared, st: State) => DOMAIN_ORDER.map((_, d) => stageFor(st.domainPts[d] + RM_SLICE_POINTS * st.rmFull[d] + p.gemRm[st.vessels][d]));

/** Objective of a state under the main build's valuation. */
const objectiveParts = (p: Prepared, st: State) => rawTotals(p.wheel, p.parts, st.alloc, gridStages(p, st));
const objective = (p: Prepared, st: State) => p.blend(objectiveParts(p, st));

/** D20: a preset requiring a revelation is valid only when the build reaches it. */
function planValid(p: Prepared, stages: number[]): boolean {
  if (stages.some((s, d) => s < p.minStages[d])) return false;
  const req = p.v.model.plan.requires;
  if (!req) return true;
  const d = revelationIndex(p.wheel.revelations, req);
  return d >= 0 && stages[d] >= 1;
}

/** D65: 2 = valid, 1 = valid but its cooldown augment is out of budget (auto mode prefers others), 0 = invalid. */
const planRank = (p: Prepared, st: State) => (!planValid(p, gridStages(p, st)) ? 0 : p.forced.rotation?.missing.length ? 1 : 2);

const runSearch = (p: Prepared, tables = p.tables, opts = FULL_SEARCH) => search(p.wheel, tables, p.budget, p.gemRm, p.forced.seed, opts);

const GATED_BOOST = 10;

/**
 * Search for one rotation plan, plus seeded searches for stage-II augment pairs (D34); the best valid state wins.
 */
function searchPlan(p: Prepared, opts = FULL_SEARCH): State {
  let st = searchGated(p, opts);
  let obj = planValid(p, gridStages(p, st)) ? objective(p, st) : -Infinity;
  for (const pair of pairTries(p, st)) {
    const seed = pairSeed(p.wheel, p.forced.seed, pair, p.budget);
    if (!seed) continue;
    const alt = searchGated({ ...p, forced: { ...p.forced, seed } }, opts);
    const o = planValid(p, gridStages(p, alt)) ? objective(p, alt) : -Infinity;
    if (o > obj + 1e-9) {
      st = alt;
      obj = o;
    }
  }
  return st;
}

/** D34: tries per plan for augment pairs whose value is mostly in stage II. */
const PAIR_TRIES = 2;

/**
 * D34: augment pairs worth more as a pair than as two singles (stage II ≫ stage I), not both in `st`. The beam
 * values the first slice by stage I only, so it rarely walks to two far slices; these get a seeded search.
 */
function pairTries(p: Prepared, st: State): [number, number][] {
  const { wheel, tables: t } = p;
  return wheel.slices
    .filter((sl) => sl.kind === 'augment' && sl.twin > sl.idx && !(isFull(wheel, st.alloc, sl.idx) && isFull(wheel, st.alloc, sl.twin)))
    .filter((sl) => t.aug2[sl.twin] > Math.max(0, t.aug1[sl.idx]))
    .sort((a, b) => t.aug2[b.twin] - t.aug2[a.twin])
    .slice(0, PAIR_TRIES)
    .map((sl): [number, number] => [sl.idx, sl.twin]);
}

/**
 * A plan gated on a revelation (D20) whose search misses that revelation gets a second (full) run with the
 * revelation boosted, so it is judged on a valid build.
 */
function searchGated(p: Prepared, opts: SearchOpts): State {
  const st = runSearch(p, p.tables, opts);
  const d = revelationIndex(p.wheel.revelations, p.v.model.plan.requires);
  if (d < 0 || planValid(p, gridStages(p, st))) return st;
  const boosted = runSearch(p, forceTables(blendTables(p.parts, p.blend, [0, 1, 2, 3].map((x) => (x === d ? GATED_BOOST : 1))), p.minStages), FULL_SEARCH);
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
    wheelEffect: effectOf(v, got),
    rationale: why.map((x) => x.text),
    rationaleMsgs: why.map((x) => x.msg),
    vessels,
    gemRecommendations: withRoom(env, vessels, recommendations(env)),
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
  let best: { p: Prepared; obj: number; rank: number } | null = null;
  for (const q of plans) {
    const rank = plans.length > 1 ? planRank(q, st) : 2;
    if (!rank) continue;
    const obj = objective(q, st);
    if (!best || rank > best.rank || (rank === best.rank && obj > best.obj + 1e-9)) best = { p: q, obj, rank };
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
    const st = runSearch(base, c.revScale.every((x) => x === 1) ? q.tables : forceTables(blendTables(q.parts, q.blend, c.revScale), q.minStages), LIGHT_SEARCH);
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
    const st = runSearch(p, forceTables(blendTables(p.parts, p.blend, [0, 1, 2, 3].map((x) => (x === d ? 0.2 : 1))), p.minStages), LIGHT_SEARCH);
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
  const mi = modelInputs(input);
  const base = mi.model;
  // Same reference in manual and auto mode, so offense values stay comparable.
  const reference = Math.max(1, ...autoPlans.filter((x) => !x?.requires?.revelation).map((x) => planTotal(base, x)));
  const wheel = getEngineWheel(input.vocation);
  const budget = Math.min(wheel.definition.totalCapacity, pointsOf(input));
  const blend = blendWith(weightsFor(input.priority, leechEhp(base, threatOf(spotMonster(mi.monsters)))));
  const owned = ownedChoices(input);
  const specs = presets.map((preset): PlanSpec | null => {
    const plain0 = pickStances(input, preset, reference, blend);
    const forced = planForced(wheel, input, budget, plain0.v?.model);
    const preCd = preCdOf(forced);
    const plain = preCd ? pickStances(input, preset, reference, blend, undefined, preCd) : plain0;
    const spec: PlanSpec = { preset, stances: plain.stances, v: plain.v, reference, auto: !chosen, forced, ...(preCd ? { preCd } : {}) };
    const fit = owned.filter((w) => fitsPlan(w.weapon, preset));
    // A shield plan without a one-handed weapon: dropped in auto mode, weaponless when chosen by the user.
    if (owned.length && !fit.length) return chosen ? spec : null;
    if (!fit.length || !plain.v) return spec;
    // D45: weapons ranked with this plan's stances; the best two get their own stance pick.
    const ranked = rankWeapons(fit, loadoutScorer(input, spec, blend, plain.v), mi.level).slice(0, WEAPON_FINALISTS);
    let best = { spec, score: -Infinity };
    for (const weapon of ranked) {
      const lo = choiceLoadout(weapon);
      let pick = pickStances(input, preset, reference, blend, lo, preCd);
      // The weapon's own cooldown perks may change which rotation augments are needed.
      const wf = planForced(wheel, input, budget, pick.v?.model, preCd);
      const wcd = preCdOf(wf);
      if (!sameCd(wcd, preCd)) pick = pickStances(input, preset, reference, blend, lo, wcd);
      const { stances, v } = pick;
      const score = v ? blend(baseParts(v)) : -Infinity;
      if (score > best.score + 1e-9) best = { spec: { ...spec, stances, v, weapon, forced: wf, preCd: wcd }, score };
    }
    return best.spec;
  });
  return specs.filter((s): s is PlanSpec => !!s);
}

/**
 * D24: stances per plan, picked by their build-independent value (damage vs the reference, EHP) at the
 * user's priority; a preset may name its stance (monk virtues).
 */
export function pickStances(input: OptimizerInput, preset: RotationPreset | null, reference: number, blend: (p: Parts) => number, loadout?: Loadout, preCd?: ReadonlyMap<string, number>) {
  const fixed = preset?.stance ? getStance(preset.stance) : undefined;
  const manual = input.stances?.map(getStance).filter((s): s is StanceDef => !!s);
  const combos = manual ? [manual] : fixed ? [[fixed]] : stanceCombos(input.vocation);
  let best = { stances: [] as StanceDef[], v: null as ValuationContext | null, score: -Infinity };
  for (const stances of combos) {
    const v = valuationFor(input, preset, reference, stances, loadout, preCd);
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
  const weapon = weaponResult(p, main);
  if (weapon) result.weapon = weapon;
  return result;
}

const RM_PROBE_ID = 'rm-probe';

/** D43: vessels of state `st` holding the owned gems of `p` (as in `assemble`, without the RM re-placement). */
function vesselsAt(p: Prepared, st: State): { env: GemEnv; vessels: VesselAssignment[] } {
  const { wheel, v, blend, gems } = p;
  const unlocked = Math.min(wheel.definition.vessels.length, wheel.vesselTiles.filter((i) => isFull(wheel, st.alloc, i)).length);
  const gridRev = DOMAIN_ORDER.map((_, d) => st.domainPts[d] + RM_SLICE_POINTS * st.rmFull[d]);
  const effects = wheelEffectsFor(wheel, st.alloc);
  const env: GemEnv = { v, wheel, blend, facts: factsFor(gridRev, effects), grades: modGrades(gems) };
  const vessels = vesselAssignments(env, unlocked, placeGems(env, gems, unlocked));
  // Same facts as the shown build: placed RM gems' points included (placedValue subtracts them per gem).
  const rm = placedRmPoints(env, vessels);
  return { env: { ...env, facts: factsFor(gridRev.map((x, d) => x + rm[d]), effects) }, vessels };
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
    const gem: OwnedGem = { id: RM_PROBE_ID, quality: 'greater', basic1: basic(0), basic2: basic(1), supreme };
    const gems = [...p.gems, gem];
    // Same rotation plan and valuation; only the owned gems (vessel values, RM offsets) change.
    const q: Prepared = { ...prepare({ ...input, gems }, input.priority, p), gemRm: ownedRmOffsets(p.wheel, gems) };
    return { p: q, main: searchPlan(q, PROBE_SEARCH) };
  };
  const regular = recs.find((r) => r.quality === 'regular');
  const basicsGain = regular?.gain ?? 0;
  const plain = probe(null);
  const plainObj = objective(plain.p, plain.main);
  const mainObj = objective(p, main);
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
    const rmEffect = effectOf(p.v, sub(objectiveParts(hypo.p, hypo.main), objectiveParts(plain.p, plain.main)));
    // D43: the re-optimized wheel with the gem must also beat the build the player has now.
    if (rmGain <= 0.05 || obj <= mainObj + 0.05) continue;
    const gain = basicsGain + rmGain;
    const stage = gridStages(hypo.p, hypo.main)[d];
    const revelation = m.revelation ?? '';
    const msg = stage > before[d] ? text('gem.rmReopt', { revelation, stage }) : text('gem.rmReoptFree', { revelation });
    // D43: the D30 room rule, checked on the re-optimized wheel (it may unlock a new greater vessel for the gem).
    let st = hypo.main;
    const unlockedGreater = (vs: VesselAssignment[]) => vs.filter((x) => x.unlocked && x.quality === 'greater').length;
    if (unlockedGreater(vesselsAt(p, st).vessels) > unlockedGreater(vesselsAt(p, main).vessels)) {
      // Room only from a vessel the light probe unlocked: confirm with a full search.
      st = searchPlan(hypo.p);
      if (objective(hypo.p, st) <= mainObj + 0.05) continue;
    }
    // Gem placement must actually put the new gem in a vessel (else it would sit unused).
    if (!vesselsAt(hypo.p, st).vessels.some((x) => x.gem?.id === RM_PROBE_ID)) continue;
    const room = vesselsAt(p, st);
    out.push(...withRoom(room.env, room.vessels, [{
      quality: 'greater',
      mods: [
        ...(greater?.mods.filter((x) => x.kind === 'basic') ?? []),
        { kind: 'supreme', modId: m.id, name: m.name, grade },
      ],
      gain: round1(gain),
      effect: { dmg: round1((regular?.effect?.dmg ?? 0) + rmEffect.dmg), ehp: round1((regular?.effect?.ehp ?? 0) + rmEffect.ehp) },
      reason: msg.text,
      reasonMsg: msg.msg,
      similar: [],
    }]));
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
  let bestRank = 0;
  const consider = (q: Prepared, st: State) => {
    const rank = plans.length > 1 ? planRank(q, st) : 2;
    if (!rank) return;
    const obj = objective(q, st);
    if (rank > bestRank || (rank === bestRank && obj > bestObj + 1e-9)) {
      p = q;
      best = st;
      bestObj = obj;
      bestRank = rank;
    }
  };
  let finalists = plans;
  if (plans.length > 2) {
    const screened = plans.map((q) => {
      const st = searchPlan(q, SCREEN_SEARCH);
      consider(q, st);
      const rank = planRank(q, st);
      return { q, rank, obj: rank ? objective(q, st) : -Infinity };
    });
    screened.sort((a, b) => b.rank - a.rank || b.obj - a.obj);
    const top = screened[0];
    finalists = screened.filter((x, i) => i === 0 || (i === 1 && x.rank === top.rank && x.obj >= top.obj - 0.02 * Math.abs(top.obj))).map((x) => x.q);
  }
  for (const q of finalists) consider(q, searchPlan(q));
  let main = refine(p, best ?? runSearch(p));
  // D45: perks and weapon re-chosen with the build's rotation (stages, augments); kept when the re-searched build is better.
  const again = rechooseWeapon(p, main, plans.length > 1);
  if (again) ({ p, main } = again);
  return { p, plans, main };
}

// ---------------------------------------------------------------------------
// D45 weapon proficiency

interface WeaponChoice {
  owned: OwnedWeapon;
  weapon: Weapon;
  options: ProfPerk[][];
  /** Option index per unlocked level. */
  choice: number[];
  /** D51: ammunition picked for bows / crossbows. */
  ammo?: Ammo;
}

/** Weapons ranked with their own stance pick per plan. */
const WEAPON_FINALISTS = 2;
/** At most two reshaped slots per weapon; reshapes are offered from this proficiency level. */
const MAX_SHAPED = 2;
const RESHAPE_MIN_LEVEL = 3;
const MIN_WEAPON_GAIN = 0.05;
/** Unowned weapons scored with all perks at their first option before the perk choice. */
const SUGGEST_PRESCREEN = 10;

/** Weapons that break on use (not suggested). */
const NOT_SUGGESTED = new Set(['ice-rapier']);

const choiceLoadout = (w: WeaponChoice): Loadout => loadoutOf(w.weapon, w.options, w.choice, w.ammo);

/** D51: a knight's weapons of another melee skill than the trained one are skipped. */
const skillFits = (input: OptimizerInput, w: Weapon) => input.vocation !== 'knight' || !input.meleeSkill || w.type === input.meleeSkill;

/** Two-handed weapons leave no hand for the shield a plan requires. */
const fitsPlan = (w: Weapon, preset: RotationPreset | null | undefined) => !(preset?.requires?.shield && w.hands === 2);

function ownedChoices(input: OptimizerInput, preset?: RotationPreset | null): Omit<WeaponChoice, 'choice'>[] {
  const out: Omit<WeaponChoice, 'choice'>[] = [];
  for (const owned of input.weapons ?? []) {
    const r = ownedOptions(owned);
    if (r && r.weapon.vocations.includes(input.vocation) && skillFits(input, r.weapon) && fitsPlan(r.weapon, preset)) out.push({ owned, ...r });
  }
  return out;
}

/**
 * Cheap score of a loadout under a plan (blend units): rotation damage vs the reference (with `ri`, e.g. the
 * build's stages and augments), shielding mitigation and weapon sustain. Differences between loadouts match
 * `baseParts` up to the plan-constant terms.
 */
function loadoutScorer(input: OptimizerInput, spec: Pick<PlanSpec, 'preset' | 'reference' | 'stances' | 'preCd'>, blend: (p: Parts) => number, v0: ValuationContext, ri: RotationInput = NO_BONUS) {
  const val = loadoutValuer(input, spec, v0, ri);
  return (lo: Loadout): number => blend(val(lo));
}

/** Unblended `loadoutScorer`. */
function loadoutValuer(input: OptimizerInput, spec: Pick<PlanSpec, 'preset' | 'reference' | 'stances' | 'preCd'>, v0: ValuationContext, ri: RotationInput = NO_BONUS) {
  const mi = modelInputs(input);
  const offhand = v0.model.plan.shield ? 'shield' : undefined;
  const { preset, reference, stances, preCd } = spec;
  return (lo: Loadout): Parts => {
    const c = stancedCharacter(loadoutCharacter(mi.character, input.vocation, lo), stances);
    const m0 = stanceBuilder(input.vocation, mi.context, mi.monsters, stances, preset, lo, preCd)(c);
    const model: SpellModel = { ...m0, plan: planFor(m0, preset), total: reference };
    const off = (100 * (rotationTotal(model, ri) - reference)) / reference;
    const mitigation = characterFacts(input.vocation, mi.level, c.shielding, offhand).mitigation;
    const def = 100 * ((100 - v0.mitigationRef) / Math.max(50, 100 - mitigation) - 1) * v0.threat;
    return add({ off, def, util: 0 }, loadoutParts({ ...v0, model }, lo));
  };
}

type Candidate = Omit<WeaponChoice, 'choice' | 'ammo'>;

/** D51: the best ammunition of a bow / crossbow at the character level for these perks (undefined otherwise). */
function bestAmmo(c: Candidate, choice: readonly number[], score: (lo: Loadout) => number, level: number): Ammo | undefined {
  let best: Ammo | undefined;
  let top = -Infinity;
  for (const a of ammoFor(c.weapon, level)) {
    const s = score(loadoutOf(c.weapon, c.options, choice, a));
    if (s > top + 1e-9) [best, top] = [a, s];
  }
  return best;
}

/** Weapons with their best perks (manual choices kept) and ammunition, best first. */
function rankWeapons(cands: Candidate[], score: (lo: Loadout) => number, level: number): (WeaponChoice & { score: number })[] {
  return cands
    .map((c) => {
      const first = bestAmmo(c, (c.owned.perks ?? []).map((x) => x ?? 0), score, level);
      const choice = choosePerks(c.options, c.owned.perks ?? [], (ch) => score(loadoutOf(c.weapon, c.options, ch, first)));
      const ammo = bestAmmo(c, choice, score, level);
      return { ...c, choice, ammo, score: score(loadoutOf(c.weapon, c.options, choice, ammo)) };
    })
    .sort((a, b) => b.score - a.score || a.weapon.id.localeCompare(b.weapon.id));
}

/** The build's rotation input: revelation stages and the augments of its full slices. */
function buildRotation(p: Prepared, st: State): RotationInput {
  const augments = p.wheel.slices.filter((s) => s.kind === 'augment' && isFull(p.wheel, st.alloc, s.idx)).map((s) => s.tile);
  return { stages: gridStages(p, st), mods: augmentMods(p.v, augments) };
}

const weaponValuer = (p: Prepared, st: State) => loadoutValuer(p.input, p.spec!, p.v, buildRotation(p, st));
const weaponScorer = (p: Prepared, st: State) => loadoutScorer(p.input, p.spec!, p.blend, p.v, buildRotation(p, st));

const sameChoice = (a: WeaponChoice, b: WeaponChoice) => a.weapon.id === b.weapon.id && a.choice.join() === b.choice.join() && a.ammo?.id === b.ammo?.id;

function rechooseWeapon(p: Prepared, main: State, checkPlan: boolean): { p: Prepared; main: State } | null {
  if (!p.weapon || !p.spec) return null;
  const top = rankWeapons(ownedChoices(p.input, p.spec.preset), weaponScorer(p, main), p.v.level)[0];
  if (!top || sameChoice(top, p.weapon)) return null;
  const q = prepare(p.input, p.input.priority, undefined, { ...p.spec, v: undefined, weapon: top });
  const st = refine(q, searchPlan(q));
  if (checkPlan && !planValid(q, gridStages(q, st))) return null;
  return objective(q, st) > objective(p, main) + 1e-9 ? { p: q, main: st } : null;
}

/** Loadout value vs the chosen weapon as a D55 effect. */
type Effect = (lo: Loadout) => GainEffect;

const pick = (w: WeaponChoice, delta: number, effect?: GainEffect): WeaponPick => ({
  weaponId: w.weapon.id,
  perks: [...w.choice],
  delta: round1(delta),
  ...(effect ? { effect } : {}),
  ...(w.ammo ? { ammo: w.ammo.id } : {}),
});

function weaponResult(p: Prepared, main: State): WeaponResult | undefined {
  const chosen = p.weapon;
  if (!chosen || !p.spec) return undefined;
  const val = weaponValuer(p, main);
  const score = (lo: Loadout) => p.blend(val(lo));
  const baseP = val(choiceLoadout(chosen));
  const base = p.blend(baseP);
  const effect: Effect = (lo) => effectOf(p.v, sub(val(lo), baseP));
  const others = rankWeapons(ownedChoices(p.input, p.spec.preset).filter((c) => c.owned !== chosen.owned), score, p.v.level);
  const best = pick(chosen, 0);
  // D56: the same weapon with every perk left to the engine.
  const better = chosen.owned.perks?.some((x) => x != null)
    ? rankWeapons([{ owned: { ...chosen.owned, perks: undefined }, weapon: chosen.weapon, options: chosen.options }], score, p.v.level)[0]
    : undefined;
  return {
    best,
    ...(better && better.score > base + MIN_WEAPON_GAIN ? { better: pick(better, better.score - base, effect(choiceLoadout(better))) } : {}),
    ranking: [best, ...others.map((w) => pick(w, w.score - base, effect(choiceLoadout(w))))],
    reshapes: reshapes(p, chosen, score, base, effect),
    ...(p.input.suggestWeapons ? { suggestions: suggestions(p, score, base, effect) } : {}),
  };
}

/** Best dust reshapes of the chosen weapon: one shaping option (rank 10) taken at a level without a reshape; best level per option. */
function reshapes(p: Prepared, w: WeaponChoice, score: (lo: Loadout) => number, base: number, effect: Effect): WeaponReshape[] {
  const shaped = w.owned.shaped ?? [];
  if (shaped.length >= MAX_SHAPED || w.owned.level < RESHAPE_MIN_LEVEL) return [];
  const out: WeaponReshape[] = [];
  const opts = shapingOptions(p.input.vocation);
  w.options.forEach((level, L) => {
    if (shaped.some((s) => s.level === L + 1)) return;
    // The shaped perk is taken; it replaces an option not chosen now (the only one on single-option levels).
    const replaces = level.length > 1 ? (w.choice[L] === 0 ? 1 : 0) : 0;
    const choice = w.choice.map((c, i) => (i === L ? 0 : c));
    for (const o of opts) {
      const options = w.options.map((x, i) => (i === L ? [shapedPerk(o)] : x));
      const lo = loadoutOf(w.weapon, options, choice, w.ammo);
      const gain = score(lo) - base;
      if (gain > MIN_WEAPON_GAIN) out.push({ level: L + 1, replaces, option: shapingId(o), gain: round1(gain), effect: effect(lo) });
    }
  });
  out.sort((a, b) => b.gain - a.gain || a.level - b.level);
  return out.filter((r, i) => out.findIndex((x) => x.option === r.option) === i).slice(0, 3);
}

/** Unowned weapons for the character's level (all proficiency levels), better than the chosen one. */
function suggestions(p: Prepared, score: (lo: Loadout) => number, base: number, effect: Effect): WeaponPick[] {
  const owned = new Set((p.input.weapons ?? []).map((w) => w.weaponId));
  const cands = weaponsFor(p.input.vocation, p.v.level)
    .filter((w) => !owned.has(w.id) && !NOT_SUGGESTED.has(w.id) && skillFits(p.input, w) && fitsPlan(w, p.spec?.preset))
    .map((weapon) => ({ owned: { weaponId: weapon.id, level: weapon.levels.length }, weapon, options: weapon.levels }));
  const screened = cands
    .map((c) => ({ c, s: score(loadoutOf(c.weapon, c.options, [], bestAmmo(c, [], score, p.v.level))) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, SUGGEST_PRESCREEN)
    .map((x) => x.c);
  return rankWeapons(screened, score, p.v.level)
    .filter((w) => w.score > base + MIN_WEAPON_GAIN)
    .slice(0, 3)
    .map((w) => pick(w, w.score - base, effect(choiceLoadout(w))));
}
