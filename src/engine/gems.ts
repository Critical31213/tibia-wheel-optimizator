/**
 * Gem valuation, optimal vessel placement (Hungarian assignment), best-gem recommendations
 * and mod-grade upgrade ranking.
 *
 * Vessel rule (D28): a gem fits only a vessel of its own quality (lesser → lesser, regular → regular,
 * greater → greater) and then all its mods are active. Vessel ids are 0-based.
 * D88 live wheel (Vessel Resonance): any gem fits a domain's vessel and uses its first n mod slots at resonance n
 * (vessel quality lesser / regular / greater = resonance I / II / III); a matching quality adds +1 damage & healing
 * (+2 for a greater gem).
 * D23: vessels hold only owned gems; recommendations are advice and never fill a vessel.
 */
import type {
  EngineMessage,
  GainEffect,
  GemModRef,
  GemQuality,
  GemRecommendation,
  ModGrade,
  ModKind,
  ModSwapRecommendation,
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
  flatParts,
  type BuildFacts,
  EFFECT_HP,
  EFFECT_MITIGATION,
  incomingShare,
  type Parts,
  RESIST_EFFECT,
  revelationIndex,
  sub,
  supremeModParts,
  type ValuationContext,
  ZERO,
} from './values';
import { type EngineWheel, REVELATION_THRESHOLDS, stageFor, type VesselSpot } from './wheel/build';

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
  /** D27: the character's mod grades (`modKey` → grade); recommended gems carry them. */
  grades?: ReadonlyMap<string, number>;
}

export const modKey = (kind: ModKind, id: number) => `${kind}:${id}`;
const kindOf = (slot: GemSlot): ModKind => (slot === 'supreme' ? 'supreme' : 'basic');

/** D27: Fragment Workshop grades belong to the character, so a mod's grade is the highest any gem shows. */
export function modGrades(gems: readonly OwnedGem[]): Map<string, ModGrade> {
  const out = new Map<string, ModGrade>();
  for (const g of gems)
    for (const slot of SLOTS_BY_QUALITY[g.quality]) {
      const ref = g[slot];
      if (!ref) continue;
      const k = modKey(kindOf(slot), ref.modId);
      if (ref.grade > (out.get(k) ?? 0)) out.set(k, ref.grade);
    }
  return out;
}

/** Gems with every mod at its shared (character) grade. */
export function withSharedGrades(gems: readonly OwnedGem[]): OwnedGem[] {
  const grades = modGrades(gems);
  return gems.map((g) => {
    const out = { ...g };
    for (const slot of SLOTS_BY_QUALITY[g.quality]) {
      const ref = g[slot];
      const grade = ref && grades.get(modKey(kindOf(slot), ref.modId));
      if (ref && grade && grade !== ref.grade) out[slot] = { ...ref, grade };
    }
    return out;
  });
}

/** D28: a gem fits only a vessel of the same quality (D88 live: any vessel). */
export const fits = (gem: GemQuality, vessel: GemQuality, resonance = false) => resonance || gem === vessel;

/** Slots of `gem` active in a vessel of quality `vessel` (none when it does not fit; live: the first n at resonance n). */
export function activeSlots(gem: GemQuality, vessel: GemQuality, resonance = false): GemSlot[] {
  if (resonance) return SLOTS_BY_QUALITY[gem].slice(0, QUALITY_RANK[vessel] + 1);
  return fits(gem, vessel) ? SLOTS_BY_QUALITY[gem] : [];
}

/** D88 live: damage & healing of a gem whose quality matches the vessel resonance (+2 for greater). */
export const matchBonus = (gem: GemQuality, vessel: GemQuality, resonance: boolean) =>
  resonance && gem === vessel ? (gem === 'greater' ? 2 : 1) : 0;

const isRes = (env: GemEnv) => env.wheel.gemSystem === 'resonance';

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
  for (const slot of activeSlots(gem.quality, vessel, isRes(env))) {
    const ref = gem[slot];
    if (ref) p = add(p, modParts(env, slot, ref.modId, ref.grade));
  }
  const flat = matchBonus(gem.quality, vessel, isRes(env));
  return flat ? add(p, flatParts(env.v, flat)) : p;
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

/** Places owned gems into the unlocked vessels (`spots`, see `vesselSpots`) maximising the blended value. */
export function placeGems(env: GemEnv, gems: OwnedGem[], spots: readonly VesselSpot[]): (OwnedGem | null)[] {
  // +ε: an owned gem worth 0 here (e.g. a resistance the spot does not need) still beats an empty vessel.
  const w = spots.map((vs) =>
    gems.map((g) => (vs.unlocked && fits(g.quality, vs.quality, isRes(env)) ? env.blend(gemParts(env, g, vs.quality)) + 1e-6 : 0)),
  );
  const cols = assign(w);
  return spots.map((_, i) => (cols[i] >= 0 ? gems[cols[i]] : null));
}

// ---------------------------------------------------------------------------
// Recommendations

interface ModPick {
  slot: GemSlot;
  kind: ModKind;
  id: number;
  name: string;
  grade: number;
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
      const g = Math.max(grade, env.grades?.get(modKey('basic', m.id)) ?? 0);
      const parts = basicModParts(env.v, m, g);
      return { slot, kind: 'basic' as const, id: m.id, name: m.name, grade: g, parts, score: env.blend(parts) };
    })
    .sort((a, b) => b.score - a.score || a.id - b.id);
}

function rankSupreme(env: GemEnv, grade: number): ModPick[] {
  return env.wheel.supremeMods
    .map((m) => {
      const g = Math.max(grade, env.grades?.get(modKey('supreme', m.id)) ?? 0);
      const parts = supremeModParts(env.v, env.wheel.revelations, env.facts, m, g);
      const share = m.spell ? displayShare(env.v.model, m.spell, env.facts.stages) : 0;
      return { slot: 'supreme' as const, kind: 'supreme' as const, id: m.id, name: m.name, grade: g, parts, score: env.blend(parts), share };
    })
    // Ties (e.g. Ice / Terra Burst sharing a cooldown): the spell the rotation already casts.
    .sort((a, b) => (Math.abs(b.score - a.score) > 1e-6 ? b.score - a.score : b.share - a.share || a.id - b.id));
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

/** D55: Parts → % damage and % EHP (`def` carries the monster threat factor). */
export function effectOf(v: Pick<ValuationContext, 'threat'>, p: Parts): GainEffect {
  const r2 = (x: number) => Math.round(x * 100) / 100 || 0;
  return { dmg: r2(p.off), ehp: r2(p.def / Math.max(1e-9, v.threat)) };
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
        mods: g.picks.map((p) => ({ kind: p.kind, modId: p.id, name: p.name, grade: p.grade as ModGrade })),
        gain: round1(g.score),
        effect: effectOf(env.v, g.parts),
        reason: r.text,
        reasonMsg: r.msg,
        similar: similarFor(env, g.picks),
      };
    })
    .sort((a, b) => b.gain - a.gain || QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality]);
}

/**
 * D30: a gem needs room. With every unlocked vessel of its quality filled, it only replaces the weakest gem there
 * (gain = difference; none → not recommended). Qualities without an unlocked vessel keep their recommendations.
 */
/**
 * D43: value of a gem already in a vessel. `env.facts` include placed RM gems' points, so an RM mod is valued as
 * the stage with vs without its own points (valued on top of them it would look worthless and always replaceable).
 */
function placedParts(env: GemEnv, gem: OwnedGem, vessel: GemQuality): Parts {
  return gemParts(withoutOwnRm(env, gem, vessel), gem, vessel);
}

export function withRoom(env: GemEnv, vessels: readonly VesselAssignment[], recs: GemRecommendation[]): GemRecommendation[] {
  return recs.flatMap((r) => {
    const same = vessels.filter((vs) => vs.unlocked && vs.quality === r.quality);
    if (!same.length || same.some((vs) => !vs.gem)) return [r];
    const placed = same.flatMap((vs) => (vs.gem ? [placedParts(env, vs.gem, vs.quality)] : []));
    if (!placed.length) return [];
    const weakest = placed.reduce((a, b) => (env.blend(b) < env.blend(a) ? b : a));
    const gain = round1(r.gain - env.blend(weakest));
    const w = effectOf(env.v, weakest);
    const effect = r.effect && { dmg: Math.round((r.effect.dmg - w.dmg) * 100) / 100, ehp: Math.round((r.effect.ehp - w.ehp) * 100) / 100 };
    return gain > 0 ? [{ ...r, gain, effect, replaces: true }] : [];
  });
}

// ---------------------------------------------------------------------------
// Vessels + upgrades

/** D23: a vessel holds only a gem the player owns; unlocked vessels without one stay empty. */
export function vesselAssignments(
  env: GemEnv,
  spots: readonly VesselSpot[],
  placed: (OwnedGem | null)[],
): VesselAssignment[] {
  return spots.map((vs, i) => {
    const own = vs.unlocked ? placed[i] : null;
    const live = vs.resonance === undefined ? {} : { domain: vs.vessel.domain, resonance: vs.resonance };
    if (own) {
      const idle = idleMods(env, own, vs.quality);
      const bonus = matchBonus(own.quality, vs.quality, isRes(env));
      return {
        vesselId: vs.vessel.id,
        quality: vs.quality,
        unlocked: true,
        gem: own,
        source: 'owned',
        ...live,
        ...(bonus ? { matchBonus: bonus } : {}),
        ...(idle.length ? { idle } : {}),
      };
    }
    return { vesselId: vs.vessel.id, quality: vs.quality, unlocked: vs.unlocked, gem: null, source: 'empty', ...live };
  });
}

/** D72: active mods of a placed gem worth ~0 here (an RM below the next stage, a resistance nobody deals, ...). */
function idleMods(env: GemEnv, gem: OwnedGem, vessel: GemQuality): NonNullable<VesselAssignment['idle']> {
  const base = withoutOwnRm(env, gem, vessel);
  const out: NonNullable<VesselAssignment['idle']> = [];
  for (const slot of activeSlots(gem.quality, vessel, isRes(env))) {
    const ref = gem[slot];
    if (!ref || Math.abs(env.blend(modParts(base, slot, ref.modId, ref.grade))) > 1e-3) continue;
    const r = idleReason(base, slot, ref.modId, ref.grade);
    out.push({ slot, reason: r.text, reasonMsg: r.msg });
  }
  return out;
}

function idleReason(env: GemEnv, slot: GemSlot, modId: number, grade: number) {
  if (slot !== 'supreme') {
    const m = findBasic(env.wheel, modId);
    if (m?.effects.every((e) => RESIST_EFFECT[e.effectId] !== undefined)) return text('gem.idleResist', {});
    return text('gem.idle', {});
  }
  const m = findSupreme(env.wheel, modId);
  if (m?.category === 'revelationMastery') {
    const d = revelationIndex(env.wheel.revelations, m.revelation);
    if (d >= 0) {
      const points = env.facts.revPoints[d] + (m.values[grade - 1] ?? 0);
      const stage = stageFor(points);
      const revelation = m.revelation ?? '';
      if (stage >= REVELATION_THRESHOLDS.length) return text('gem.idleRmMax', { revelation });
      return text('gem.idleRm', { revelation, points: Math.round(points), next: REVELATION_THRESHOLDS[stage], stage: stage + 1 });
    }
  }
  const spell = m?.spell ?? '';
  if (spell && env.v.model.spells.get(spell)?.avatar && env.v.context.mode !== 'boss') return text('gem.idleAvatar', { spell });
  if (spell) return text('gem.idleSpell', { spell });
  return text('gem.idle', {});
}

/**
 * D27: +1 grade per mod. A grade belongs to the character, so the gain sums over every placed gem with the mod.
 */
export function upgrades(env: GemEnv, vessels: VesselAssignment[]): UpgradeRecommendation[] {
  const byMod = new Map<string, { slot: GemSlot; modId: number; grade: ModGrade; gemIds: string[] }>();
  const uses: { key: string; slot: GemSlot; modId: number }[] = [];
  for (const vs of vessels) {
    const gem = vs.gem;
    if (vs.source !== 'owned' || !gem) continue;
    for (const slot of activeSlots(gem.quality, vs.quality, isRes(env))) {
      const ref = gem[slot];
      if (!ref) continue;
      const key = modKey(kindOf(slot), ref.modId);
      uses.push({ key, slot, modId: ref.modId });
      const m = byMod.get(key);
      if (m) m.gemIds.push(gem.id);
      else byMod.set(key, { slot, modId: ref.modId, grade: ref.grade, gemIds: [gem.id] });
    }
  }
  const out: UpgradeRecommendation[] = [];
  for (const [key, m] of byMod) {
    if (m.grade >= 4) continue;
    const to = (m.grade + 1) as ModGrade;
    const atP = (grade: number) => uses.filter((u) => u.key === key).reduce((a, u) => add(a, modParts(env, u.slot, u.modId, grade)), ZERO);
    const curP = atP(m.grade);
    const nextP = sub(atP(to), curP);
    const maxP = to === 4 ? nextP : sub(atP(4), curP);
    const gain = env.blend(nextP);
    if (gain <= 1e-6) continue;
    const gainToMax = env.blend(maxP);
    const mod = m.slot === 'supreme' ? findSupreme(env.wheel, m.modId) : findBasic(env.wheel, m.modId);
    out.push({
      gemId: m.gemIds[0],
      gems: m.gemIds.length,
      slot: m.slot,
      kind: kindOf(m.slot),
      modId: m.modId,
      name: mod?.name ?? `#${m.modId}`,
      fromGrade: m.grade,
      toGrade: to,
      gain: Math.round(gain * 100) / 100,
      effect: effectOf(env.v, nextP),
      gainToMax: Math.round(gainToMax * 100) / 100,
      effectToMax: effectOf(env.v, maxP),
    });
  }
  return out.sort((a, b) => b.gain - a.gain || a.kind.localeCompare(b.kind) || a.modId - b.modId);
}

/** Env without the revelation points of `gem`'s own RM mod (D43), so its supreme slot is valued as with vs without. */
function withoutOwnRm(env: GemEnv, gem: OwnedGem, vessel: GemQuality): GemEnv {
  const ref = gem.supreme;
  const m = ref && activeSlots(gem.quality, vessel, isRes(env)).includes('supreme') ? findSupreme(env.wheel, ref.modId) : undefined;
  const d = m?.category === 'revelationMastery' ? revelationIndex(env.wheel.revelations, m.revelation) : -1;
  if (!m || !ref || d < 0) return env;
  const x = m.values[ref.grade - 1] ?? 0;
  return { ...env, facts: { ...env.facts, revPoints: env.facts.revPoints.map((p, i) => (i === d ? p - x : p)) } };
}

/**
 * D71: per active basic slot of each placed owned gem, the best replacement mod (slot rules as for new gems, not the gem's
 * other basic mod) at the character's grade on that mod. Gain only; the swap cost is not judged.
 */
export function modSwaps(env: GemEnv, vessels: readonly VesselAssignment[]): ModSwapRecommendation[] {
  const out: ModSwapRecommendation[] = [];
  for (const vs of vessels) {
    const gem = vs.gem;
    if (vs.source !== 'owned' || !gem || !vs.unlocked) continue;
    const base = withoutOwnRm(env, gem, vs.quality);
    const beforeParts = gemParts(base, gem, vs.quality);
    const before = base.blend(beforeParts);
    for (const slot of activeSlots(gem.quality, vs.quality, isRes(env))) {
      const ref = gem[slot];
      // D72: supreme swaps are expensive; a better supreme comes as a replacement gem (recommendations).
      if (!ref || slot === 'supreme') continue;
      const other = slot === 'basic1' ? gem.basic2 : slot === 'basic2' ? gem.basic1 : null;
      const ranked = rankBasic(base, slot === 'basic1' ? 1 : 2, NEW_GEM_GRADE);
      const best = ranked.find((r) => r.id !== ref.modId && r.id !== other?.modId);
      if (!best) continue;
      const next: OwnedGem = { ...gem, [slot]: { modId: best.id, grade: best.grade as ModGrade } };
      const afterParts = gemParts(base, next, vs.quality);
      const gain = base.blend(afterParts) - before;
      if (gain <= 0.005) continue;
      const cur = findBasic(env.wheel, ref.modId);
      out.push({
        gemId: gem.id,
        vesselId: vs.vesselId,
        quality: gem.quality,
        slot,
        kind: kindOf(slot),
        from: { modId: ref.modId, name: cur?.name ?? `#${ref.modId}`, grade: ref.grade },
        to: { modId: best.id, name: best.name, grade: best.grade as ModGrade },
        gain: Math.round(gain * 100) / 100,
        effect: effectOf(env.v, sub(afterParts, beforeParts)),
      });
    }
  }
  return out.sort((a, b) => b.gain - a.gain || a.vesselId - b.vesselId);
}

/** Revelation points added by owned RM gems placed in active greater vessels, per domain. */
export function placedRmPoints(env: GemEnv, vessels: VesselAssignment[]): number[] {
  const pts = [0, 0, 0, 0];
  for (const vs of vessels) {
    if (vs.source !== 'owned' || !vs.gem?.supreme || !activeSlots(vs.gem.quality, vs.quality, isRes(env)).includes('supreme')) continue;
    const m = findSupreme(env.wheel, vs.gem.supreme.modId);
    if (m?.category !== 'revelationMastery') continue;
    const d = revelationIndex(env.wheel.revelations, m.revelation);
    if (d >= 0) pts[d] += m.values[vs.gem.supreme.grade - 1] ?? 0;
  }
  return pts;
}
