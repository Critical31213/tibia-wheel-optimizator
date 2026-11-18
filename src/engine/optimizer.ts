/**
 * Beam search over complete slice fills (directed unlock graph) with revelation look-ahead (incl. owned
 * Revelation Mastery gems), greedy completion with a partially filled last slice, gem placement,
 * alternatives and planner export code.
 */
import type {
  ActivatedRevelation,
  AlternativeBuild,
  Domain,
  EngineMessage,
  Element,
  OptimizerInput,
  OptimizerResult,
  OwnedGem,
  Perk,
  SpellUsage,
  StatLine,
  VesselAssignment,
} from '../types';
import { encodePlannerCode, gridForSliceId, plannerVesselIssues, type PlannerVessel } from '../data/wheel/plannerCode';
import { resolveCharacterStats } from '../data/character';
import {
  activeSlots,
  bestGems,
  type GemEnv,
  gemParts,
  placedRmPoints,
  placeGems,
  recommendations,
  round1,
  upgrades,
  vesselAssignments,
} from './gems';
import { type EngineMessageKey, text } from './messages';
import { buildSpellModel, DEFAULT_CONTEXT, normaliseMonsters, rotation, TEAM_HEALS } from './spells';
import {
  add,
  augmentParts,
  type BuildFacts,
  characterFacts,
  convictionParts,
  dedicationParts,
  flatParts,
  hpParts,
  incomingShares,
  mitigationParts,
  type Parts,
  parseEffects,
  revelationIndex,
  revelationParts,
  type SpellEffect,
  spikeFactor,
  spotMonster,
  threatOf,
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

function search(wheel: EngineWheel, t: Tables, budget: number, gemRm: number[][]): State {
  const n = wheel.slices.length;
  let density = 0;
  wheel.slices.forEach((sl, i) => {
    const conv =
      sl.kind === 'augment' ? (t.aug1[i] + t.aug2[i]) / 2 : sl.kind === 'vessel' ? t.vessel[0] : sl.kind === 'rm' ? 0 : t.conv[i];
    density += Math.max(0, t.ded[i] + conv / sl.capacity);
  });
  density /= n;
  const s: Search = { wheel, t, budget, density, gemRm };
  const empty: State = {
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
      .slice(0, BEAM_WIDTH)
      .map((c) => extend(s, c.st, c.i, wheel.slices[c.i].capacity, c.delta));
    for (const st of beam.slice(0, COMPLETE_TOP)) {
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

/** Value of vessels 0..7 when unlocked one by one (owned gems first, else a grade-I recommendation). */
function vesselTable(env: GemEnv, gems: OwnedGem[]): Parts[] {
  const vessels = env.wheel.definition.vessels;
  const rec = new Map(
    (['lesser', 'regular', 'greater'] as const).map((q) => [q, bestGems(env, q, 1)[0]?.parts ?? ZERO] as const),
  );
  const prefix: Parts[] = [ZERO];
  for (let c = 1; c <= vessels.length; c++) {
    const placed = gems.length ? placeGems(env, gems, c) : [];
    let total = ZERO;
    for (let i = 0; i < c; i++) {
      const recP = rec.get(vessels[i].quality)!;
      const g = placed[i];
      const own = g ? gemParts(env, g, vessels[i].quality) : null;
      total = add(total, own && env.blend(own) > env.blend(recP) ? own : recP);
    }
    prefix.push(total);
  }
  const flat = flatParts(env.v, 1);
  return vessels.map((_, k) => add(add(prefix[k + 1], prefix[k], -1), flat));
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
function rawTotals(wheel: EngineWheel, t: PartTables, alloc: ArrayLike<number>, stages: number[]): Parts {
  let total = ZERO;
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
      } else {
        useful = share >= USEFUL_SHARE;
        const params = { targets: round1(targets), element, modifier, share: Math.round(share) };
        r = text(useful ? 'spell.damage' : 'spell.lowShare', params);
      }
    } else if (s.kind === 'healing') {
      if (TEAM_HEALS.has(s.name)) {
        useful = !(model.context.mode === 'hunt' && model.context.huntStyle === 'solo');
        r = text(useful ? 'spell.teamHealing' : 'spell.teamHealingSolo');
      } else r = text('spell.healing');
    } else r = text('spell.support');
    out.push({ name: s.name, expectedTargets: round1(Math.max(1, targets)), useful, reason: r.text, reasonMsg: r.msg, share });
  }
  out.sort((a, b) => Number(b.useful) - Number(a.useful) || b.share - a.share || a.name.localeCompare(b.name));
  return out.map(({ share, ...u }) => (share > 0 && u.useful ? { ...u, share: round1(share) } : u));
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
    out.push(text('rationale.hunt', { style: ctx.huntStyle, targets: round1(avg) }));
    const single = damage.filter((s) => s.singleTarget).map((s) => s.name).sort();
    if (single.length) out.push(text('rationale.singleTarget', { spells: single.join(', ') }));
    const avatar = wheel.revelations.find((r) => r.data.isAvatar);
    if (avatar) out.push(text('rationale.avatarIgnored', { avatar: avatar.data.name }));
  }

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

type ValuationInput = Pick<OptimizerInput, 'vocation' | 'points' | 'monster' | 'context' | 'character' | 'monsters'>;

/** Level used for valuation: `character.level`, else points + 50. */
export function levelFor(input: Pick<OptimizerInput, 'points' | 'character'>): number {
  const l = input.character?.level;
  return Math.round(Math.max(8, Number.isFinite(l) && l! > 0 ? l! : Math.max(60, pointsOf(input) + 50)));
}

/** Valuation context for an input (character stats estimated where missing). */
export function valuationFor(input: ValuationInput): ValuationContext {
  const context = input.context ?? DEFAULT_CONTEXT;
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
  const mage = input.vocation === 'sorcerer' || input.vocation === 'druid';
  const boosted = mage ? { ...character, magicLevel: character.magicLevel + 1 } : { ...character, mainSkill: character.mainSkill + 1 };
  const skillOff = (100 * (buildSpellModel(input.vocation, context, monsters, boosted).total - model.total)) / model.total;
  const monster = spotMonster(monsters);
  const facts = characterFacts(input.vocation, level, character.shielding);
  return {
    vocation: input.vocation,
    context,
    monster,
    model,
    level,
    threat: threatOf(monster),
    ...facts,
    spikeFactor: spikeFactor(input.vocation, level, monsters),
    incoming: incomingShares(monsters),
    skillOff: Math.max(0, skillOff),
  };
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
}

function prepare(input: OptimizerInput, priority = input.priority, base?: Prepared): Prepared {
  const wheel = getEngineWheel(input.vocation);
  const v = base?.v ?? valuationFor(input);
  const budget = Math.min(wheel.definition.totalCapacity, pointsOf(input));
  const gems = input.gems ?? [];
  const blend = blendWith(weightsFor(priority));
  // Pre-search gem estimate: revelation spells at the stage ~60 % of the budget reaches; RM gems are handled by gemRm.
  const assumed = stageFor(Math.min(1000, Math.round(budget * 0.6)));
  const preEnv: GemEnv = { v, wheel, blend, facts: factsFor([1e9, 1e9, 1e9, 1e9], new Map(), [assumed, assumed, assumed, assumed]) };
  const vesselP = vesselTable(preEnv, gems);
  const parts = base ? { ...base.parts, vesselP } : partTables(wheel, v, vesselP);
  return { input, wheel, v, budget, gems, gemRm: base?.gemRm ?? ownedRmOffsets(wheel, gems), parts, blend, tables: blendTables(parts, blend) };
}

const gridStages = (p: Prepared, st: State) => DOMAIN_ORDER.map((_, d) => stageFor(st.domainPts[d] + RM_SLICE_POINTS * st.rmFull[d] + p.gemRm[st.vessels][d]));

/** Objective of a state under the main build's valuation. */
const objective = (p: Prepared, st: State) => p.blend(rawTotals(p.wheel, p.parts, st.alloc, gridStages(p, st)));

type BuildResult = Omit<OptimizerResult, 'alternatives'>;

function assemble(p: Prepared, best: State): BuildResult {
  const { input, wheel, v, blend, gems } = p;
  const vesselSlices = wheel.vesselTiles.filter((i) => isFull(wheel, best.alloc, i)).length;
  const unlocked = Math.min(wheel.definition.vessels.length, vesselSlices);
  const gridRev = DOMAIN_ORDER.map((_, d) => best.domainPts[d] + RM_SLICE_POINTS * best.rmFull[d]);
  const wheelEffects = wheelEffectsFor(wheel, best.alloc);
  let env: GemEnv = { v, wheel, blend, facts: factsFor(gridRev, wheelEffects) };
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

  const got = rawTotals(wheel, p.parts, best.alloc, stages);
  const max = rawTotals(wheel, p.parts, wheel.slices.map((s) => s.capacity), [3, 3, 3, 3]);
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
    upgradeRecommendations: upgrades(env, vessels),
    spells: spellUsages(v, stages, wheel),
    plannerCode: plannerCodeFor(input.vocation, allocation, vessels),
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

/** Alternatives to `main`; returns `better` instead when a candidate beats the main build on the main objective. */
function alternatives(p: Prepared, main: State, mainResult: BuildResult, count: number): { alts: AlternativeBuild[]; better?: State } {
  if (count <= 0 || p.budget < 100) return { alts: [] };
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
  const accepted: State[] = [main];
  const out: AlternativeBuild[] = [];
  const mainObj = objective(p, main);
  for (const c of cands) {
    if (out.length >= count) break;
    const q = c.priority === prio ? p : prepare(p.input, c.priority, p);
    const tables = c.revScale.every((x) => x === 1) ? q.tables : blendTables(q.parts, q.blend, c.revScale);
    const st = search(p.wheel, tables, p.budget, p.gemRm);
    if (objective(p, st) > mainObj + 1e-9) return { alts: [], better: st };
    if (accepted.some((a) => allocDistance(a.alloc, st.alloc) < minDiff)) continue;
    accepted.push(st);
    const result = assemble(q, st);
    const altStages = gridStages(p, st);
    const altTop = topDomain(altStages, DOMAIN_ORDER.map((_, d) => st.domainPts[d]));
    // All revelations at the alternative's highest stage, so e.g. 'A + B focus' and 'B focus' stay distinguishable.
    const revName = altTop >= 0
      ? DOMAIN_ORDER.map((_, d) => d).filter((d) => altStages[d] === altStages[altTop]).map((d) => p.wheel.revelations[d].data.name).join(' + ')
      : '-';
    const label =
      c.kind === 'avatarFocus'
        ? text('alt.avatarFocus', { revelation: p.wheel.revelations[avatar].data.name })
        : c.kind === 'revelationFocus'
          ? text('alt.revelationFocus', { revelation: revName })
          : text(c.kind === 'defensive' ? 'alt.defensive' : 'alt.offensive');
    const relativeScore = mainObj > 0 ? Math.round((1000 * objective(p, st)) / mainObj) / 10 : 100;
    const revList = result.revelations.filter((r) => r.stage > 0).map((r) => `${r.perk.name} ${r.stage}`).join(', ') || '-';
    const tradeoff = text('alt.tradeoff', {
      offense: signed(result.offenseScore - mainResult.offenseScore),
      defense: signed(result.defenseScore - mainResult.defenseScore),
      score: relativeScore,
      revelations: revList,
    });
    out.push({ label: label.text, labelMsg: label.msg, tradeoff: tradeoff.text, tradeoffMsg: tradeoff.msg, relativeScore, result });
  }
  return { alts: out.sort((a, b) => b.relativeScore - a.relativeScore) };
}

/**
 * The beam commits to revelation thresholds early; re-searching with one reached
 * domain damped lets other revelation mixes compete. Kept only if the exact objective improves.
 */
function refine(p: Prepared, best: State): State {
  if (p.budget >= p.wheel.definition.totalCapacity) return best;
  let bestObj = objective(p, best);
  const stages = gridStages(p, best);
  for (let d = 0; d < 4; d++) {
    if (stages[d] < 1 || stages[d] > 2) continue;
    const st = search(p.wheel, blendTables(p.parts, p.blend, [0, 1, 2, 3].map((x) => (x === d ? 0.2 : 1))), p.budget, p.gemRm);
    const obj = objective(p, st);
    if (obj > bestObj + 1e-9) {
      best = st;
      bestObj = obj;
    }
  }
  return best;
}

export function runOptimizer(input: OptimizerInput): OptimizerResult {
  const p = prepare(input);
  let best = refine(p, search(p.wheel, p.tables, p.budget, p.gemRm));
  const n = Math.max(0, Math.min(5, Math.floor(input.alternatives ?? DEFAULT_ALTERNATIVES)));
  const count = Number.isFinite(n) ? n : DEFAULT_ALTERNATIVES;
  // An alternative search may beat the main one (objective is not convex): promote it and retry.
  for (let k = 0; ; k++) {
    const result = assemble(p, best);
    const { alts, better } = alternatives(p, best, result, count);
    if (!better || k >= 3) return { ...result, alternatives: alts };
    best = better;
  }
}
