/**
 * Beam search over full-slice fills with revelation look-ahead, followed by a
 * greedy completion that spends leftover points (partial last slice).
 */
import type {
  ActivatedRevelation,
  Domain,
  Element,
  OptimizerInput,
  OptimizerResult,
  Perk,
  StatLine,
} from '../types';
import {
  buildTables,
  makeContext,
  modifierOf,
  rawTotals,
  type ScoreTables,
  type ScoringContext,
  stageFor,
} from './scoring';
import { type EngineWheel, getEngineWheel } from './wheel/build';
import { DOMAIN_ORDER } from './wheel/geometry';
import { REVELATION_FLAT_BONUS, type PerkStats } from './wheel/perks';

export const BEAM_WIDTH = 24;
/** Fraction of the next revelation stage credited proportionally to progress (ranking only). */
const LOOKAHEAD_WEIGHT = 0.6;

interface State {
  alloc: Int32Array;
  used: number;
  domainPts: number[];
  score: number;
  path: number[];
  key: number;
  rank: number;
}

interface Search {
  wheel: EngineWheel;
  t: ScoreTables;
  budget: number;
  density: number;
}

function isFull(w: EngineWheel, alloc: Int32Array, i: number): boolean {
  return alloc[i] >= w.slices[i].slice.capacity;
}

export function isAvailable(w: EngineWheel, alloc: ArrayLike<number>, i: number): boolean {
  const s = w.slices[i];
  if (alloc[i] >= s.slice.capacity) return false;
  if (s.slice.ring === 1) return true;
  return s.adj.some((j) => alloc[j] >= w.slices[j].slice.capacity);
}

function revDelta(s: Search, st: State, d: number, add: number): number {
  const th = s.wheel.revelations[d].thresholds;
  const before = stageFor(st.domainPts[d], th);
  const after = stageFor(st.domainPts[d] + add, th);
  return s.t.rev[d][after] - s.t.rev[d][before];
}

function rankOf(s: Search, st: State): number {
  const remaining = s.budget - st.used;
  let shaping = 0;
  s.wheel.revelations.forEach((r, d) => {
    const dp = st.domainPts[d];
    const stage = stageFor(dp, r.thresholds);
    if (stage >= r.thresholds.length) return;
    const target = r.thresholds[stage];
    const prev = stage > 0 ? r.thresholds[stage - 1] : 0;
    if (target - dp > remaining) return;
    const gain = s.t.rev[d][stage + 1] - s.t.rev[d][stage];
    shaping += gain * ((dp - prev) / (target - prev)) * LOOKAHEAD_WEIGHT;
  });
  return st.score + shaping + remaining * s.density;
}

/** Adds `pts` to slice i (returns a new state). */
function extend(s: Search, st: State, i: number, pts: number): State {
  const sl = s.wheel.slices[i];
  const alloc = st.alloc.slice();
  alloc[i] += pts;
  const domainPts = st.domainPts.slice();
  const delta =
    s.t.ded[i] * pts + (alloc[i] >= sl.slice.capacity ? s.t.conv[i] : 0) + revDelta(s, st, sl.domainIdx, pts);
  domainPts[sl.domainIdx] += pts;
  const next: State = {
    alloc,
    used: st.used + pts,
    domainPts,
    score: st.score + delta,
    path: st.path.includes(i) ? st.path : [...st.path, i],
    key: alloc[i] >= sl.slice.capacity ? st.key + 2 ** i : st.key,
    rank: 0,
  };
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
      const room = s.wheel.slices[i].slice.capacity - st.alloc[i];
      const pts = Math.min(room, left);
      const fills = pts === room;
      const gain =
        s.t.ded[i] * pts + (fills ? s.t.conv[i] : 0) + revDelta(s, st, s.wheel.slices[i].domainIdx, pts);
      const ratio = gain / pts;
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

function search(wheel: EngineWheel, t: ScoreTables, budget: number): State {
  const n = wheel.slices.length;
  let density = 0;
  wheel.slices.forEach((sl, i) => {
    density += t.ded[i] + t.conv[i] / sl.slice.capacity;
  });
  density /= n;
  const s: Search = { wheel, t, budget, density };
  const empty: State = {
    alloc: new Int32Array(n),
    used: 0,
    domainPts: [0, 0, 0, 0],
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
        const cap = wheel.slices[i].slice.capacity;
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

function sumStats(wheel: EngineWheel, alloc: Int32Array, stages: number[]): Required<PerkStats> {
  const r: Required<PerkStats> = {
    hp: 0,
    mana: 0,
    capacity: 0,
    mitigation: 0,
    lifeLeech: 0,
    manaLeech: 0,
    skill: 0,
    flatDamage: 0,
    flatHealing: 0,
  };
  const add = (p: PerkStats | undefined, k: number) => {
    if (!p) return;
    for (const key of Object.keys(p) as (keyof PerkStats)[]) r[key] += (p[key] ?? 0) * k;
  };
  wheel.slices.forEach((s, i) => {
    add(s.dedStats, alloc[i]);
    if (alloc[i] >= s.slice.capacity) add(s.conv.stats, 1);
  });
  for (const st of stages) {
    r.flatDamage += REVELATION_FLAT_BONUS[st];
    r.flatHealing += REVELATION_FLAT_BONUS[st];
  }
  return r;
}

const fmt = (x: number, digits = 0) => (Math.round(x * 10 ** digits) / 10 ** digits).toString();

function statLines(wheel: EngineWheel, alloc: Int32Array, stages: number[], convictions: Perk[]): StatLine[] {
  const t = sumStats(wheel, alloc, stages);
  const lines: StatLine[] = [];
  const push = (cond: boolean, label: string, value: string, category: StatLine['category']) => {
    if (cond) lines.push({ label, value, category });
  };
  push(t.hp > 0, 'Hit points', `+${fmt(t.hp)}`, 'defense');
  push(t.mana > 0, 'Mana', `+${fmt(t.mana)}`, 'utility');
  push(t.capacity > 0, 'Capacity', `+${fmt(t.capacity)}`, 'utility');
  push(t.mitigation > 0, 'Mitigation', `+${fmt(t.mitigation, 2)}%`, 'defense');
  push(t.lifeLeech > 0, 'Life leech', `+${fmt(t.lifeLeech, 2)}%`, 'defense');
  push(t.manaLeech > 0, 'Mana leech', `+${fmt(t.manaLeech, 2)}%`, 'utility');
  push(t.skill > 0, wheel.spec.skillName, `+${t.skill}`, 'offense');
  push(t.flatDamage > 0, 'Damage & healing (revelations)', `+${t.flatDamage}`, 'offense');
  for (const c of convictions) {
    if (/ I{1,2}$/.test(c.name)) push(true, c.name.replace(/ I{1,2}$/, ''), `Augment ${c.name.split(' ').pop()}`, c.category);
  }
  // Keep only the highest grade line per spell.
  const seen = new Map<string, number>();
  lines.forEach((l, i) => seen.set(l.label, i));
  const dedup = lines.filter((l, i) => seen.get(l.label) === i);
  const vessels = convictions.filter((c) => c.name.startsWith('Vessel Resonance')).length;
  if (vessels) dedup.push({ label: 'Vessel resonances', value: `${vessels}`, category: 'utility' });
  for (const c of convictions) {
    const passive = wheel.slices.find((s) => s.conv.id === c.id)?.geo.conviction;
    if (passive === 'passiveGreen' || passive === 'passivePurple')
      dedup.push({ label: c.name, value: 'Active', category: c.category });
  }
  return dedup;
}

function namedConvictions(wheel: EngineWheel, alloc: Int32Array, path: number[]): Perk[] {
  const grades = new Map<string, number>();
  const out: Perk[] = [];
  for (const i of path) {
    const s = wheel.slices[i];
    if (alloc[i] < s.slice.capacity) continue;
    const { id, name, description, category, spell } = s.conv;
    if (spell) {
      const g = (grades.get(spell) ?? 0) + 1;
      grades.set(spell, g);
      out.push({ id, name: `${spell} ${g === 1 ? 'I' : 'II'}`, description, category });
    } else {
      out.push({ id, name, description, category });
    }
  }
  return out;
}

function elementList(es: Element[]): string {
  return es.join('/');
}

function rationale(
  input: OptimizerInput,
  wheel: EngineWheel,
  ctx: ScoringContext,
  best: State,
  stages: number[],
  budget: number,
): string[] {
  const out: string[] = [];
  const p = Math.round(Math.min(100, Math.max(0, input.priority)));
  out.push(
    `Priority ${p}/100: offense weighted ${Math.round((1 - p / 100) * 100)}%, survivability ${p}% — ${
      p < 40 ? 'damage perks and offensive revelations come first' : p > 60 ? 'HP, mitigation, healing and Gift of Life come first' : 'a balanced mix of damage and defense perks'
    }.`,
  );

  const m = input.monster;
  if (m) {
    const offPerks = [
      ...best.path.filter((i) => isFull(wheel, best.alloc, i)).map((i) => wheel.slices[i].conv),
      ...wheel.revelations.filter((_, d) => stages[d] > 0),
    ];
    const vocElements = new Set<Element>();
    const allOff = [
      ...wheel.slices.map((s) => s.conv.value.offElements ?? []),
      ...wheel.revelations.map((r) => r.stageValues[0].offElements ?? []),
    ];
    allOff.forEach((es) => es.forEach((e) => vocElements.add(e)));
    const weak = [...vocElements].filter((e) => modifierOf(m, e) > 100).sort((a, b) => modifierOf(m, b) - modifierOf(m, a));
    const resisted = [...vocElements].filter((e) => modifierOf(m, e) < 100);
    if (weak.length) {
      const chosen = offPerks
        .filter((pk) => {
          const es = 'value' in pk ? pk.value.offElements : pk.stageValues[0].offElements;
          return es?.some((e) => weak.includes(e));
        })
        .map((pk) => pk.name.replace(/ augment$/, ''));
      out.push(
        `${m.name} takes ${weak.map((e) => `${modifierOf(m, e)}% ${e}`).join(', ')} damage, so ${
          chosen.length ? [...new Set(chosen)].join(', ') : `${elementList(weak)} perks`
        } were favoured${chosen.length ? '' : ' where reachable'}.`,
      );
    } else {
      out.push(`${m.name} has no weakness to this vocation's elemental perks, so element-neutral damage (skills, passives, avatar) was preferred.`);
    }
    if (resisted.length) {
      out.push(
        `${m.name} resists ${resisted.map((e) => `${e} (${modifierOf(m, e)}%)`).join(', ')}: perks dealing those elements were de-prioritised.`,
      );
    }
    if (m.damageTypes.length || m.maxDamage) {
      out.push(
        `${m.name} deals ${m.damageTypes.length ? elementList(m.damageTypes) : 'unknown'} damage${
          m.maxDamage ? ` (up to ~${m.maxDamage}/turn)` : ''
        }: defense value scaled ×${ctx.threat.toFixed(2)}${
          m.damageTypes.some((t) => t !== 'physical') ? ', vessel resonances (gem elemental resistances) weighted up' : ''
        }.`,
      );
    }
  } else {
    out.push('No monster selected: generic build without elemental tailoring.');
  }

  const revs = wheel.revelations
    .map((r, d) => ({ r, st: stages[d], pts: best.domainPts[d] }))
    .filter((x) => x.st > 0)
    .map((x) => `${x.r.name} stage ${x.st} (${x.pts} pts)`);
  if (revs.length) out.push(`Revelations reached: ${revs.join(', ')}.`);
  else if (budget < 250) out.push('Not enough points for a revelation (needs 250 in one domain); points go into the best inner slices.');

  const partial = best.path.find((i) => best.alloc[i] < wheel.slices[i].slice.capacity);
  if (input.points > wheel.definition.totalCapacity) {
    out.push(`Only ${wheel.definition.totalCapacity} points fit in the wheel; ${input.points - wheel.definition.totalCapacity} are surplus.`);
  } else if (partial !== undefined) {
    out.push(`Last slice ${wheel.slices[partial].slice.id} is partially filled (${best.alloc[partial]}/${wheel.slices[partial].slice.capacity}) with the leftover points.`);
  }
  return out.slice(0, 5);
}

export function runOptimizer(input: OptimizerInput): OptimizerResult {
  const wheel = getEngineWheel(input.vocation);
  const total = wheel.definition.totalCapacity;
  const budget = Math.max(0, Math.min(total, Math.floor(Number.isFinite(input.points) ? input.points : 0)));
  const ctx = makeContext(input.priority, input.monster);
  const tables = buildTables(wheel, ctx);
  const best = search(wheel, tables, budget);

  const allocation: Record<string, number> = {};
  wheel.slices.forEach((s, i) => {
    if (best.alloc[i] > 0) allocation[s.slice.id] = best.alloc[i];
  });
  const domainPoints = {} as Record<Domain, number>;
  DOMAIN_ORDER.forEach((d, i) => (domainPoints[d] = best.domainPts[i]));
  const stages = wheel.revelations.map((r, d) => stageFor(best.domainPts[d], r.thresholds));
  const revelations: ActivatedRevelation[] = wheel.revelations.map((_, d) => ({
    perk: wheel.definition.revelations[d],
    stage: stages[d],
    domainPoints: best.domainPts[d],
  }));
  const convictions = namedConvictions(wheel, best.alloc, best.path);

  const got = rawTotals(wheel, best.alloc, ctx);
  const max = rawTotals(wheel, wheel.slices.map((s) => s.slice.capacity), ctx);
  const norm = (a: number, b: number) => (b > 0 ? Math.max(0, Math.min(100, Math.round((a / b) * 100))) : 0);

  return {
    allocation,
    path: best.path.map((i) => wheel.slices[i].slice.id),
    pointsUsed: best.used,
    pointsTotal: Math.max(0, Math.floor(Number.isFinite(input.points) ? input.points : 0)),
    domainPoints,
    revelations,
    convictions,
    stats: statLines(wheel, best.alloc, stages, convictions),
    offenseScore: norm(got.off, max.off),
    defenseScore: norm(got.def, max.def),
    rationale: rationale(input, wheel, ctx, best, stages, budget),
    vessels: [],
    gemRecommendations: [],
    upgradeRecommendations: [],
    spells: [],
  };
}

