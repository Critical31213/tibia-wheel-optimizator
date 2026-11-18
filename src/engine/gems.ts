/**
 * Gem valuation, optimal vessel placement (Hungarian assignment), best-gem recommendations
 * and mod-grade upgrade ranking.
 *
 * Vessel rule: any gem fits any vessel; a vessel activates only the mods its quality allows
 * (lesser → basic 1, regular → basic 1+2, greater → basic 1+2+supreme). Vessel ids are 0-based.
 * D23: vessels hold only owned gems; recommendations are advice and never fill a vessel.
 */
import type {
  EngineMessage,
  GemModRef,
  GemQuality,
  GemRecommendation,
  ModGrade,
  ModKind,
  OwnedGem,
  UpgradeRecommendation,
  VesselAssignment,
} from '../types';
import type { WheelBasicMod, WheelSupremeMod } from '../data/wheel';
import { displayShare } from './spells';
import { text } from './messages';
import {
  add,
  basicModParts,
  type BuildFacts,
  EFFECT_HP,
  EFFECT_MITIGATION,
  incomingShare,
  type Parts,
  RESIST_EFFECT,
  revelationIndex,
  supremeModParts,
  type ValuationContext,
  ZERO,
} from './values';
import { type EngineWheel, stageFor } from './wheel/build';

export type GemSlot = 'basic1' | 'basic2' | 'supreme';
export const SLOTS_BY_QUALITY: Record<GemQuality, GemSlot[]> = {
  lesser: ['basic1'],
  regular: ['basic1', 'basic2'],
  greater: ['basic1', 'basic2', 'supreme'],
};
const QUALITY_RANK: Record<GemQuality, number> = { lesser: 0, regular: 1, greater: 2 };

export interface GemEnv {
  v: ValuationContext;
  wheel: EngineWheel;
  facts: BuildFacts;
  blend: (p: Parts) => number;
}

/** Slots of `gem` active in a vessel of quality `vessel`. */
export function activeSlots(gem: GemQuality, vessel: GemQuality): GemSlot[] {
  return SLOTS_BY_QUALITY[QUALITY_RANK[gem] <= QUALITY_RANK[vessel] ? gem : vessel];
}

const findBasic = (w: EngineWheel, id: number) => w.basicMods.find((m) => m.id === id);
const findSupreme = (w: EngineWheel, id: number) => w.supremeMods.find((m) => m.id === id);

export function modParts(env: GemEnv, slot: GemSlot, modId: number, grade: number): Parts {
  if (slot === 'supreme') {
    const m = findSupreme(env.wheel, modId);
    return m ? supremeModParts(env.v, env.wheel.revelations, env.facts, m, grade) : ZERO;
  }
  const m = findBasic(env.wheel, modId);
  return m ? basicModParts(env.v, m, grade) : ZERO;
}

export function gemParts(env: GemEnv, gem: OwnedGem, vessel: GemQuality): Parts {
  let p = ZERO;
  for (const slot of activeSlots(gem.quality, vessel)) {
    const ref = gem[slot];
    if (ref) p = add(p, modParts(env, slot, ref.modId, ref.grade));
  }
  return p;
}

// ---------------------------------------------------------------------------
// Assignment

/** Max-weight assignment of rows to distinct columns (Hungarian, O(n²m)). Returns column per row or -1. */
export function assign(weights: number[][]): number[] {
  const rows = weights.length;
  if (!rows) return [];
  const cols = Math.max(rows, ...weights.map((r) => r.length));
  const n = rows;
  const m = cols;
  const cost = (i: number, j: number) => -(weights[i][j] ?? 0);
  const u = new Array<number>(n + 1).fill(0);
  const vv = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(Infinity);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost(i0 - 1, j - 1) - u[i0] - vv[j];
        if (cur < minv[j] - 1e-12) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta - 1e-12) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          vv[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const res = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j] > 0) res[p[j] - 1] = j - 1;
  return res.map((c, i) => (c >= 0 && c < weights[i].length && (weights[i][c] ?? 0) > 1e-9 ? c : -1));
}

/** Places owned gems into the first `unlocked` vessels maximising the blended value. */
export function placeGems(env: GemEnv, gems: OwnedGem[], unlocked: number): (OwnedGem | null)[] {
  const vessels = env.wheel.definition.vessels.slice(0, unlocked);
  // +ε: an owned gem worth 0 here (e.g. a resistance the spot does not need) still beats an empty vessel.
  const w = vessels.map((vs) => gems.map((g) => env.blend(gemParts(env, g, vs.quality)) + 1e-6));
  const cols = assign(w);
  return vessels.map((_, i) => (cols[i] >= 0 ? gems[cols[i]] : null));
}

// ---------------------------------------------------------------------------
// Recommendations

interface ModPick {
  slot: GemSlot;
  kind: ModKind;
  id: number;
  name: string;
  parts: Parts;
  score: number;
}

/** D18: basic slot 1 recommendations are only Hit Points or Mitigation Multiplier. */
const SLOT1_EFFECTS = new Set([EFFECT_HP, EFFECT_MITIGATION]);

function rankBasic(env: GemEnv, slotNo: 1 | 2, grade: number): ModPick[] {
  const slot: GemSlot = slotNo === 1 ? 'basic1' : 'basic2';
  return env.wheel.basicMods
    .filter((m) => m.slots.includes(slotNo) && (slotNo === 2 || m.effects.every((e) => SLOT1_EFFECTS.has(e.effectId))))
    .map((m) => {
      const parts = basicModParts(env.v, m, grade);
      return { slot, kind: 'basic' as const, id: m.id, name: m.name, parts, score: env.blend(parts) };
    })
    .sort((a, b) => b.score - a.score || a.id - b.id);
}

function rankSupreme(env: GemEnv, grade: number): ModPick[] {
  return env.wheel.supremeMods
    .map((m) => {
      const parts = supremeModParts(env.v, env.wheel.revelations, env.facts, m, grade);
      return { slot: 'supreme' as const, kind: 'supreme' as const, id: m.id, name: m.name, parts, score: env.blend(parts) };
    })
    .sort((a, b) => b.score - a.score || a.id - b.id);
}

export interface BestGem {
  quality: GemQuality;
  picks: ModPick[];
  parts: Parts;
  score: number;
}

function gemFromPicks(quality: GemQuality, picks: ModPick[]): BestGem {
  const parts = picks.reduce((p, x) => add(p, x.parts), ZERO);
  return { quality, picks, parts, score: picks.reduce((s, x) => s + x.score, 0) };
}

/** Best gem(s) of a quality at `grade`; greater returns `alternatives` supreme variants. */
export function bestGems(env: GemEnv, quality: GemQuality, grade: number, alternatives = 1): BestGem[] {
  const b1 = rankBasic(env, 1, grade)[0];
  const picks: ModPick[] = b1 && b1.score > 0 ? [b1] : [];
  if (quality !== 'lesser') {
    const b2 = rankBasic(env, 2, grade).find((m) => m.id !== b1?.id);
    if (b2 && b2.score > 0) picks.push(b2);
  }
  if (quality !== 'greater') return [gemFromPicks(quality, picks)];
  const sup = rankSupreme(env, grade).filter((s) => s.score > 0).slice(0, alternatives);
  return sup.length ? sup.map((s) => gemFromPicks(quality, [...picks, s])) : [gemFromPicks(quality, picks)];
}

export function toOwnedGem(id: string, g: BestGem, grade: ModGrade): OwnedGem {
  const ref = (slot: GemSlot): GemModRef | null => {
    const p = g.picks.find((x) => x.slot === slot);
    return p ? { modId: p.id, grade } : null;
  };
  return { id, quality: g.quality, basic1: ref('basic1'), basic2: ref('basic2'), supreme: ref('supreme') };
}

function pickReason(env: GemEnv, pick: ModPick): { msg: EngineMessage; text: string } {
  const { v, wheel } = env;
  if (pick.kind === 'supreme') {
    const m = wheel.supremeMods.find((x) => x.id === pick.id)!;
    return supremeReason(env, m);
  }
  const m = wheel.basicMods.find((x) => x.id === pick.id)!;
  return basicReason(env, m, v.monster?.name);
}

function basicReason(env: GemEnv, m: WheelBasicMod, monster: string | undefined) {
  const res = m.effects
    .map((e) => RESIST_EFFECT[e.effectId])
    .filter((e) => e !== undefined)
    .sort((a, b) => incomingShare(env.v, b) - incomingShare(env.v, a));
  if (res.length && m.effects.every((e) => RESIST_EFFECT[e.effectId] !== undefined)) {
    const element = res[0];
    if (monster && incomingShare(env.v, element) > 0) return text('gem.resistMonster', { monster, element });
    return text('gem.resist', { element });
  }
  if (m.effects.every((e) => e.effectId === 11 || e.effectId === 12)) return text('gem.utility', { mod: m.name });
  return text('gem.survival', { mod: m.name });
}

function supremeReason(env: GemEnv, m: WheelSupremeMod) {
  const { v, wheel, facts } = env;
  if (m.category === 'revelationMastery') {
    const d = revelationIndex(wheel.revelations, m.revelation);
    const after = d >= 0 ? stageFor(facts.revPoints[d] + (m.values[3] ?? 0)) : 0;
    const revelation = m.revelation ?? '';
    return d >= 0 && after > facts.stages[d]
      ? text('gem.rmStage', { revelation, stage: after })
      : text('gem.rmNoStage', { revelation });
  }
  const spell = m.spell ?? '';
  const s = v.model.spells.get(spell);
  if (m.category === 'augCooldown') {
    if (s?.avatar) return text('gem.avatar', { spell });
    return text('gem.cooldown', { spell });
  }
  if (m.category === 'augHealing') return text('gem.healing', { spell });
  if (s && s.kind === 'damage') {
    if (!s.usable) return text('gem.singleTargetHunt', { spell });
    const share = displayShare(v.model, spell, facts.stages);
    return text('gem.spell', { spell, targets: round1(s.targets), share: Math.round(share) });
  }
  return text('gem.effect', { mod: m.name });
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** D22: substitutes within this share of the chosen mod's gain are listed as near-equal. */
export const SIMILAR_THRESHOLD = 0.9;

function similarFor(env: GemEnv, picks: ModPick[]): NonNullable<GemRecommendation['similar']> {
  const out: NonNullable<GemRecommendation['similar']> = [];
  const used = new Set(picks.map((p) => p.kind + p.id));
  for (const p of picks) {
    if (p.score <= 0) continue;
    const ranked = p.slot === 'supreme' ? rankSupreme(env, NEW_GEM_GRADE) : rankBasic(env, p.slot === 'basic1' ? 1 : 2, NEW_GEM_GRADE);
    for (const r of ranked) {
      if (used.has(r.kind + r.id) || r.score < p.score * SIMILAR_THRESHOLD) continue;
      if (out.length >= 3) break;
      out.push({ slot: p.slot, modId: r.id, name: r.name, relative: Math.round((100 * r.score) / p.score) });
    }
  }
  return out;
}

/** A newly revealed gem has all mods at grade I (higher grades come from the Fragment Workshop). */
export const NEW_GEM_GRADE = 1;

export function recommendations(env: GemEnv): GemRecommendation[] {
  const list = [
    ...bestGems(env, 'greater', NEW_GEM_GRADE),
    ...bestGems(env, 'regular', NEW_GEM_GRADE),
    ...bestGems(env, 'lesser', NEW_GEM_GRADE),
  ].filter((g) => g.score > 0);
  return list
    .map((g) => {
      const top = g.picks.find((p) => p.kind === 'supreme' && p.score > 0) ?? [...g.picks].sort((a, b) => b.score - a.score || a.id - b.id)[0];
      const r = pickReason(env, top);
      return {
        quality: g.quality,
        mods: g.picks.map((p) => ({ kind: p.kind, modId: p.id, name: p.name, grade: NEW_GEM_GRADE as ModGrade })),
        gain: round1(g.score),
        reason: r.text,
        reasonMsg: r.msg,
        similar: similarFor(env, g.picks),
      };
    })
    .sort((a, b) => b.gain - a.gain || QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality]);
}

// ---------------------------------------------------------------------------
// Vessels + upgrades

/** D23: a vessel holds only a gem the player owns; unlocked vessels without one stay empty. */
export function vesselAssignments(
  env: GemEnv,
  unlocked: number,
  placed: (OwnedGem | null)[],
): VesselAssignment[] {
  return env.wheel.definition.vessels.map((vs, i) => {
    const own = i < unlocked ? placed[i] : null;
    return own
      ? { vesselId: vs.id, quality: vs.quality, unlocked: true, gem: own, source: 'owned' }
      : { vesselId: vs.id, quality: vs.quality, unlocked: i < unlocked, gem: null, source: 'empty' };
  });
}

export function upgrades(env: GemEnv, vessels: VesselAssignment[]): UpgradeRecommendation[] {
  const out: UpgradeRecommendation[] = [];
  for (const vs of vessels) {
    const gem = vs.gem;
    if (vs.source !== 'owned' || !gem) continue;
    for (const slot of activeSlots(gem.quality, vs.quality)) {
      const ref = gem[slot];
      if (!ref || ref.grade >= 4) continue;
      const to = (ref.grade + 1) as ModGrade;
      const cur = env.blend(modParts(env, slot, ref.modId, ref.grade));
      const gain = env.blend(modParts(env, slot, ref.modId, to)) - cur;
      if (gain <= 1e-6) continue;
      const gainToMax = to === 4 ? gain : env.blend(modParts(env, slot, ref.modId, 4)) - cur;
      const mod = slot === 'supreme' ? findSupreme(env.wheel, ref.modId) : findBasic(env.wheel, ref.modId);
      out.push({
        gemId: gem.id,
        slot,
        modId: ref.modId,
        name: mod?.name ?? `#${ref.modId}`,
        fromGrade: ref.grade,
        toGrade: to,
        gain: Math.round(gain * 100) / 100,
        gainToMax: Math.round(gainToMax * 100) / 100,
      });
    }
  }
  return out.sort((a, b) => b.gain - a.gain || a.gemId.localeCompare(b.gemId) || a.slot.localeCompare(b.slot));
}

/** Revelation points added by owned RM gems placed in active greater vessels, per domain. */
export function placedRmPoints(env: GemEnv, vessels: VesselAssignment[]): number[] {
  const pts = [0, 0, 0, 0];
  for (const vs of vessels) {
    if (vs.source !== 'owned' || !vs.gem?.supreme || !activeSlots(vs.gem.quality, vs.quality).includes('supreme')) continue;
    const m = findSupreme(env.wheel, vs.gem.supreme.modId);
    if (m?.category !== 'revelationMastery') continue;
    const d = revelationIndex(env.wheel.revelations, m.revelation);
    if (d >= 0) pts[d] += m.values[vs.gem.supreme.grade - 1] ?? 0;
  }
  return pts;
}
