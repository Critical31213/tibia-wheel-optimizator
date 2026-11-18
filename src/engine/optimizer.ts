/**
 * Beam search over complete slice fills (directed unlock graph) with revelation look-ahead,
 * greedy completion with a partially filled last slice, then gem placement and reporting.
 */
import type {
  ActivatedRevelation,
  Domain,
  EngineMessage,
  Element,
  FightContext,
  OptimizerInput,
  OptimizerResult,
  OwnedGem,
  Perk,
  SpellUsage,
  StatLine,
} from '../types';
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
import { buildSpellModel, DEFAULT_CONTEXT, displayShare, type SpellModel, targetsAt, TEAM_HEALS } from './spells';
import {
  add,
  augmentParts,
  type BuildFacts,
  convictionParts,
  dedicationParts,
  flatParts,
  type Parts,
  parseEffects,
  revelationParts,
  type SpellEffect,
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
/** Fraction of the next revelation stage credited proportionally to progress (ranking only). */
const LOOKAHEAD_WEIGHT = 0.6;
const UTIL_WEIGHT = 0.1;
const MIN_WEIGHT = 0.05;
/** A damage spell counts as useful from this share (%) of total damage. */
export const USEFUL_SHARE = 3;

export interface Weights {
  off: number;
  def: number;
  util: number;
}

export function weightsFor(priority: number): Weights {
  const p = Math.min(100, Math.max(0, Number.isFinite(priority) ? priority : 50)) / 100;
  return { off: Math.max(MIN_WEIGHT, 1 - p), def: Math.max(MIN_WEIGHT, p), util: UTIL_WEIGHT };
}

export const blendWith = (w: Weights) => (p: Parts) => w.off * p.off + w.def * p.def + w.util * p.util;

/** Per-slice / per-stage value tables (Parts + blended scalars). */
interface Tables {
  dedP: Parts[];
  convP: Parts[];
  aug1P: Parts[];
  aug2P: Parts[];
  revP: Parts[][];
  /** Value of unlocking vessel k (incl. its +1 flat bonus). */
  vesselP: Parts[];
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
}

const isFull = (w: EngineWheel, alloc: ArrayLike<number>, i: number) => alloc[i] >= w.slices[i].capacity;
const revPts = (st: State, d: number) => st.domainPts[d] + RM_SLICE_POINTS * st.rmFull[d];

function rankOf(s: Search, st: State): number {
  const remaining = s.budget - st.used;
  let shaping = 0;
  for (let d = 0; d < 4; d++) {
    const dp = revPts(st, d);
    const stage = stageFor(dp);
    if (stage >= REVELATION_THRESHOLDS.length) continue;
    const target = REVELATION_THRESHOLDS[stage];
    const prev = stage > 0 ? REVELATION_THRESHOLDS[stage - 1] : 0;
    if (target - dp > remaining) continue;
    const gain = s.t.rev[d][stage + 1] - s.t.rev[d][stage];
    shaping += gain * ((dp - prev) / (target - prev)) * LOOKAHEAD_WEIGHT;
  }
  return st.score + shaping + remaining * s.density;
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
  const d = sl.domainIdx;
  const before = revPts(st, d);
  const after = before + pts + (fills && sl.kind === 'rm' ? RM_SLICE_POINTS : 0);
  const rev = s.t.rev[d][stageFor(after)] - s.t.rev[d][stageFor(before)];
  return s.t.ded[i] * pts + (fills ? convGain(s, st, i) : 0) + rev;
}

function extend(s: Search, st: State, i: number, pts: number): State {
  const sl = s.wheel.slices[i];
  const fills = st.alloc[i] + pts >= sl.capacity;
  const delta = gainOf(s, st, i, pts);
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
    vessels: fills && sl.kind === 'vessel' ? st.vessels + 1 : st.vessels,
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

function search(wheel: EngineWheel, t: Tables, budget: number): State {
  const n = wheel.slices.length;
  let density = 0;
  wheel.slices.forEach((sl, i) => {
    const conv =
      sl.kind === 'augment' ? (t.aug1[i] + t.aug2[i]) / 2 : sl.kind === 'vessel' ? t.vessel[0] : sl.kind === 'rm' ? 0 : t.conv[i];
    density += Math.max(0, t.ded[i] + conv / sl.capacity);
  });
  density /= n;
  const s: Search = { wheel, t, budget, density };
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
  let beam = [empty];
  while (beam.length) {
    const next = new Map<number, State>();
    for (const st of beam) {
      const remaining = budget - st.used;
      for (let i = 0; i < n; i++) {
        const cap = wheel.slices[i].capacity;
        if (cap > remaining || !isAvailable(wheel, st.alloc, i)) continue;
        const ns = extend(s, st, i, cap);
        const prev = next.get(ns.key);
        if (!prev || ns.rank > prev.rank) next.set(ns.key, ns);
      }
    }
    beam = [...next.values()].sort((a, b) => b.rank - a.rank || a.key - b.key).slice(0, BEAM_WIDTH);
    for (const st of beam) {
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

function factsFor(revPoints: number[], wheelEffects: Map<string, SpellEffect[]>): BuildFacts {
  return { revPoints, stages: revPoints.map((p) => stageFor(p)), wheelEffects };
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

function buildTables(wheel: EngineWheel, v: ValuationContext, blend: (p: Parts) => number, vesselP: Parts[]): Tables {
  const dedP = wheel.slices.map((s) => dedicationParts(v, s.tile));
  const convP = wheel.slices.map((s) => (s.kind === 'augment' || s.kind === 'rm' || s.kind === 'vessel' ? ZERO : convictionParts(v, s.tile)));
  const augs = wheel.slices.map((s): [Parts, Parts] => (s.kind === 'augment' ? augmentParts(v, s.tile) : [ZERO, ZERO]));
  const revP = wheel.revelations.map((r) => [0, 1, 2, 3].map((st) => revelationParts(v, r, st)));
  const f = (ps: Parts[]) => Float64Array.from(ps.map(blend));
  return {
    dedP,
    convP,
    aug1P: augs.map((a) => a[0]),
    aug2P: augs.map((a) => a[1]),
    revP,
    vesselP,
    ded: f(dedP),
    conv: f(convP),
    aug1: f(augs.map((a) => a[0])),
    aug2: f(augs.map((a) => a[1])),
    rev: revP.map(f),
    vessel: f(vesselP),
  };
}

/** Raw (unblended) value of a build. */
function rawTotals(wheel: EngineWheel, t: Tables, alloc: ArrayLike<number>, stages: number[]): Parts {
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

function spellUsages(model: SpellModel, wheel: EngineWheel, stages: number[]): SpellUsage[] {
  const out: (SpellUsage & { share: number })[] = [];
  const monster = model.monster;
  for (const s of model.spells.values()) {
    const stage = s.revelation >= 0 ? stages[s.revelation] : 3;
    let useful = true;
    let share = 0;
    let targets = s.revelation >= 0 ? targetsAt(model, s, Math.max(1, stage)) : s.targets;
    let r: { msg: EngineMessage; text: string };
    if (s.avatar) {
      useful = model.context.mode === 'boss';
      targets = 1;
      r = text(useful ? 'spell.avatarBoss' : 'spell.avatarHunt');
    } else if (s.kind === 'damage') {
      share = displayShare(model, s.name, Math.max(1, stage));
      const element = s.element ?? 'physical';
      const modifier = monster ? Math.round(s.elem * 100) : 100;
      if (s.elem <= 0 && monster) {
        useful = false;
        r = text('spell.immune', { monster: monster.name, element });
      } else {
        useful = share >= USEFUL_SHARE;
        const params = { targets: round1(targets), element, modifier, share: Math.round(share) };
        r = text(useful ? 'spell.damage' : 'spell.lowShare', params);
        if (s.revelation >= 0 && stage < 1) {
          r = text('spell.revelationLocked', { revelation: wheel.revelations[s.revelation].data.name });
        }
      }
    } else if (s.kind === 'healing') {
      if (TEAM_HEALS.has(s.name)) {
        useful = !(model.context.mode === 'hunt' && model.context.huntStyle === 'solo');
        r = text(useful ? 'spell.teamHealing' : 'spell.teamHealingSolo');
      } else r = text('spell.healing');
    } else r = text('spell.support');
    out.push({ name: s.name, expectedTargets: round1(targets), useful, reason: r.text, reasonMsg: r.msg, share });
  }
  out.sort((a, b) => Number(b.useful) - Number(a.useful) || b.share - a.share || a.name.localeCompare(b.name));
  return out.map(({ name, expectedTargets, useful, reason, reasonMsg }) => ({ name, expectedTargets, useful, reason, reasonMsg }));
}

function rationale(
  input: OptimizerInput,
  ctx: FightContext,
  wheel: EngineWheel,
  model: SpellModel,
  best: State,
  stages: number[],
  revPoints: number[],
  vesselsUnlocked: number,
  vesselSlices: number,
): { msg: EngineMessage; text: string }[] {
  const out: { msg: EngineMessage; text: string }[] = [];
  const p = Math.round(Math.min(100, Math.max(0, Number.isFinite(input.priority) ? input.priority : 50)));
  out.push(text('rationale.priority', { priority: p, offense: 100 - p, defense: p }));

  const damage = [...model.spells.values()].filter((s) => s.kind === 'damage' && !s.avatar);
  if (ctx.mode === 'boss') out.push(text('rationale.boss'));
  else {
    const area = damage.filter((s) => s.meta && s.meta.area !== 'single');
    const avg = area.length ? area.reduce((a, s) => a + s.targets, 0) / area.length : 1;
    const targets = round1(avg);
    out.push(text('rationale.hunt', { style: ctx.huntStyle, targets }));
    const avatar = wheel.revelations.find((r) => r.data.isAvatar);
    if (avatar) out.push(text('rationale.avatarIgnored', { avatar: avatar.data.name }));
  }

  const m = input.monster;
  if (m) {
    const elements = [...new Set(damage.map((s) => s.element).filter((e): e is Element => !!e))];
    const mod = (e: Element) => m.elementModifiers[e] ?? 100;
    const byShare = (es: Element[]) =>
      damage
        .filter((s) => s.element && es.includes(s.element))
        .sort((a, b) => b.weight * b.targets - a.weight * a.targets || a.name.localeCompare(b.name))
        .slice(0, 3)
        .map((s) => s.name)
        .join(', ');
    const weak = elements.filter((e) => mod(e) > 100).sort((a, b) => mod(b) - mod(a) || a.localeCompare(b));
    const immune = elements.filter((e) => mod(e) <= 0);
    const resisted = elements.filter((e) => mod(e) > 0 && mod(e) < 100);
    if (weak.length) {
      out.push(text('rationale.weak', { monster: m.name, list: weak.map((e) => `${mod(e)}% ${e}`).join(', '), spells: byShare(weak) }));
    } else out.push(text('rationale.noWeakness', { monster: m.name }));
    if (immune.length) out.push(text('rationale.immune', { monster: m.name, list: immune.join(', '), spells: byShare(immune) }));
    if (resisted.length) {
      out.push(text('rationale.resists', { monster: m.name, list: resisted.map((e) => `${e} (${mod(e)}%)`).join(', ') }));
    }
    if (m.damageTypes.length || m.maxDamage) {
      out.push(
        text('rationale.threat', {
          monster: m.name,
          types: m.damageTypes.length ? m.damageTypes.join('/') : 'unknown',
          max: m.maxDamage ? ` (up to ~${m.maxDamage}/turn)` : '',
          threat: threatOf(m).toFixed(2),
        }),
      );
    }
  } else out.push(text('rationale.noMonster'));

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

/** Valuation context for an input (level ≈ points + 50). */
export function valuationFor(input: Pick<OptimizerInput, 'vocation' | 'points' | 'monster' | 'context'>): ValuationContext {
  const context = input.context ?? DEFAULT_CONTEXT;
  return {
    vocation: input.vocation,
    context,
    monster: input.monster,
    model: buildSpellModel(input.vocation, context, input.monster),
    level: Math.max(60, pointsOf(input) + 50),
    threat: threatOf(input.monster),
  };
}

export function runOptimizer(input: OptimizerInput): OptimizerResult {
  const wheel = getEngineWheel(input.vocation);
  const v = valuationFor(input);
  const ctx = v.context;
  const model = v.model;
  const total = wheel.definition.totalCapacity;
  const rawPoints = pointsOf(input);
  const budget = Math.min(total, rawPoints);
  const gems = input.gems ?? [];
  const blend = blendWith(weightsFor(input.priority));

  // Pre-search gem estimate: revelation spells assumed at the stage ~60 % of the budget reaches.
  const assumed = Math.min(1000, Math.round(budget * 0.6));
  const preEnv: GemEnv = { v, wheel, blend, facts: factsFor([assumed, assumed, assumed, assumed], new Map()) };
  const tables = buildTables(wheel, v, blend, vesselTable(preEnv, gems));
  const best = search(wheel, tables, budget);

  // Final gem placement on the chosen wheel.
  const vesselSlices = wheel.vesselTiles.filter((i) => isFull(wheel, best.alloc, i)).length;
  const unlocked = Math.min(wheel.definition.vessels.length, vesselSlices);
  const gridRev = DOMAIN_ORDER.map((_, d) => revPts(best, d));
  const wheelEffects = wheelEffectsFor(wheel, best.alloc);
  let env: GemEnv = { v, wheel, blend, facts: factsFor(gridRev, wheelEffects) };
  const placed = placeGems(env, gems, unlocked);
  let vessels = vesselAssignments(env, unlocked, placed);
  const rmGem = placedRmPoints(env, vessels);
  const finalRev = gridRev.map((p, d) => p + rmGem[d]);
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
  const revelations: ActivatedRevelation[] = wheel.revelations.map((r, d) => ({
    perk: r.perk,
    stage: stages[d],
    domainPoints: finalRev[d],
  }));

  const got = rawTotals(wheel, tables, best.alloc, stages);
  const max = rawTotals(wheel, tables, wheel.slices.map((s) => s.capacity), [3, 3, 3, 3]);
  const norm = (a: number, b: number) => (b > 0 ? Math.max(0, Math.min(100, Math.round((a / b) * 100))) : 0);
  const why = rationale(input, ctx, wheel, model, best, stages, finalRev, unlocked, vesselSlices);

  return {
    allocation,
    path: best.path.map((i) => wheel.slices[i].slice.id),
    pointsUsed: best.used,
    pointsTotal: rawPoints,
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
    spells: spellUsages(model, wheel, stages),
  };
}
