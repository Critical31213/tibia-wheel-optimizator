/**
 * Damage model per context, built on the fitted TibiaTools formulas (`src/data/damage`).
 *
 * damage per turn T = auto-attack + Σ rate(S) × perCast(S)
 * perCast(S)        = hit(S, level, skills, stage) × targets(S, context) × element(S, monsters) × crit EV
 * rate(S)           = greedy fill of the single attack-spell slot per 2 s turn by perCast, capped at 1/cooldown
 *
 * D16: in hunt mode single-target spells never enter the rotation (zero value for their augments/gems).
 * Perk values are ΔT / T0 (T0 = rotation without wheel bonuses, no revelation).
 */
import type { CharacterStats, Element, FightContext, Monster, Vocation, WeightedMonster } from '../types';
import { getSpell, getWheelSpellNames, type SpellMeta } from '../data/wheel';
import {
  getDamageSpell,
  getDamageSpells,
  getHealingSpell,
  healingAverage,
  levelTerm,
  spellAverageHit,
  spellVariant,
  SPELL_FORMULAS,
  TURN_SECONDS,
  weaponBracket,
  type DamageSpell,
} from '../data/damage';
import { resolveCharacterStats } from '../data/character';
import { getEngineWheel } from './wheel/build';

export const DEFAULT_CONTEXT: FightContext = { mode: 'hunt', huntStyle: 'solo' };

/** Area/chain/beam targets in boss mode (summons, adds). */
export const BOSS_AREA_TARGETS = 1.2;
/** Monsters available to area spells per hunt style (solo uses tibiapal averages). */
export const HUNT_POOL: Record<'teamLure' | 'teamBox', number> = { teamLure: 5, teamBox: 9 };
/** Fraction of the pack a beam's central line reaches; outer tiles (Beam Mastery) add this much more. */
export const BEAM_CENTRAL_REACH = 0.5;
export const BEAM_OUTER_REACH = 0.4;
const SOLO_FALLBACK: Record<SpellMeta['area'], number> = { single: 1, area: 5, chain: 4, beam: 2.4 };
const MAX_TARGETS_FALLBACK: Record<SpellMeta['area'], number> = { single: 1, area: 20, chain: 6, beam: 7 };
/** Party size assumed for group heals in team hunts. */
const PARTY_SIZE = 4;
/** Cooldown can never drop below this fraction of the base cooldown. */
export const COOLDOWN_FLOOR = 0.5;
const BASE_CRIT_CHANCE = SPELL_FORMULAS.critDefaults.critChance;
const BASE_CRIT_EXTRA = SPELL_FORMULAS.critDefaults.critDamage;

/** Revelation spells: cooldown (s) and max targets per stage (planner values). */
export interface RevelationSpellDef {
  cooldown: [number, number, number];
  maxTargets?: [number, number, number];
  /** How the revelation 'extra' variant combines with the main hit. */
  extra: 'replace' | 'half' | 'add';
}
export const REVELATION_SPELLS: Record<string, RevelationSpellDef> = {
  "Executioner's Throw": { cooldown: [18, 14, 10], maxTargets: [3, 4, 5], extra: 'replace' },
  'Divine Grenade': { cooldown: [26, 20, 14], extra: 'add' },
  'Ice Burst': { cooldown: [22, 18, 14], extra: 'half' },
  'Terra Burst': { cooldown: [22, 18, 14], extra: 'half' },
  'Spiritual Outburst': { cooldown: [24, 20, 16], extra: 'add' },
};
/** Spells sharing one cooldown: only the better one is cast. */
export const SHARED_COOLDOWN: string[][] = [
  ['Ice Burst', 'Terra Burst'],
  ["Hell's Core", 'Rage of the Skies'],
  ['Eternal Winter', 'Wrath of Nature'],
  ['Ultimate Energy Strike', 'Ultimate Flame Strike', 'Ultimate Ice Strike', 'Ultimate Terra Strike'],
  ['Strong Energy Strike', 'Strong Flame Strike', 'Strong Ice Strike', 'Strong Terra Strike'],
];
/** Beam Mastery: central damage +per target hit (capped), by stage. */
const BEAM_BONUS = { per: [10, 12, 14], cap: [30, 36, 42] };
/** Revelation passives that scale spell damage (TibiaTools probes). */
const PASSIVE_MULT: Record<string, { mult: number[]; applies: (s: SpellEval) => boolean }> = {
  'Combat Mastery': { mult: [1.0308, 1.0368, 1.045], applies: () => true },
  Ascetic: { mult: [1.0478, 1.0957, 1.1446], applies: (s) => HARMONY_SPENDERS.has(s.name) },
  'Lord of Destruction': { mult: [1.0148, 1.0222, 1.0296], applies: (s) => s.element === 'fire' },
};
/** Monk spells that spend Harmony (Ascetic). Approximate. */
const HARMONY_SPENDERS = new Set([
  'Greater Flurry of Blows',
  'Sweeping Takedown',
  'Thousand Fist Blows',
  'Spiritual Outburst',
  'Devastating Knockout',
  'Greater Tiger Clash',
  'Forceful Uppercut',
  'Mystic Repulse',
]);

/** Base cooldowns (s) of non-damage spells with cooldown augments. */
const SUPPORT_COOLDOWN: Record<string, number | [number, number, number]> = {
  'Divine Dazzle': 16,
  'Focus Serenity': 900,
  'Focus Harmony': 120,
  'Divine Empowerment': [32, 28, 24],
};

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

/** Auto-attack: avg hit ≈ level term + 0.5 × 0.085 × skill × attack; paladin diamond arrows hit an area while hunting. */
const AUTO_ATTACK_TARGETS: Record<Vocation, Record<'solo' | 'teamLure' | 'teamBox', number>> = {
  knight: { solo: 1, teamLure: 1, teamBox: 1 },
  paladin: { solo: 3, teamLure: 4, teamBox: 5 },
  sorcerer: { solo: 1, teamLure: 1, teamBox: 1 },
  druid: { solo: 1, teamLure: 1, teamBox: 1 },
  monk: { solo: 1, teamLure: 1, teamBox: 1 },
};

interface HitPart {
  /** Raw hit without bonuses. */
  base: number;
  /** Part boosted by "+X % base damage" (everything except the level term). */
  boost: number;
  /** Flat-bonus factor. */
  bf: number;
}

export interface SpellEval {
  name: string;
  meta: SpellMeta | undefined;
  dmg: DamageSpell | undefined;
  kind: SpellMeta['kind'];
  element: Element | null;
  area: SpellMeta['area'];
  singleTarget: boolean;
  maxTargets: number;
  targets: number;
  /** Beams: extra targets on the outer tiles (Beam Mastery). */
  outerTargets: number;
  /** Weighted monster damage modifier / 100 (1 without monster / for non-damage spells). */
  elem: number;
  /** Domain index of the revelation granting it, else -1. */
  revelation: number;
  /** Domain index whose stage changes the spell (granting revelation or Beam Mastery), else -1. */
  stageDomain: number;
  avatar: boolean;
  /** Part of the attack rotation (damage spell, not a rune; D16: not single-target in hunt mode). */
  usable: boolean;
  /** Hits per stage 0..3: main, extra (null if none). */
  hits: { main: HitPart; extra: HitPart | null }[];
}

export interface SpellModel {
  vocation: Vocation;
  context: FightContext;
  /** Weighted monsters (weights sum to 1); empty = generic. */
  monsters: { monster: Monster; weight: number }[];
  character: Required<CharacterStats>;
  spells: Map<string, SpellEval>;
  /** Wheel spells shown to the user (augmentable / revelation). */
  wheelSpells: string[];
  /** Revelation passive name → domain index. */
  passives: Map<string, number>;
  /** Auto-attack damage per turn. */
  base: number;
  /** T0: damage per turn without wheel bonuses and revelations. */
  total: number;
  /** Δ% total damage per +1 flat damage bonus (at T0). */
  flatOffPerPoint: number;
  /** Δ% healing output per +1 flat healing bonus. */
  flatHealPerPoint: number;
}

export function elementMultiplier(monster: Monster | null, element: Element | null): number {
  if (!monster || !element || element === 'healing') return 1;
  return (monster.elementModifiers[element] ?? 100) / 100;
}

/** Weighted element multiplier over a hunting spot. */
export function spotElementMultiplier(monsters: { monster: Monster; weight: number }[], element: Element | null): number {
  if (!monsters.length) return 1;
  return monsters.reduce((s, m) => s + m.weight * elementMultiplier(m.monster, element), 0);
}

/** Normalises weights (non-positive/invalid dropped); `monsters` takes precedence over `monster`. */
export function normaliseMonsters(monsters: WeightedMonster[] | undefined, monster: Monster | null): { monster: Monster; weight: number }[] {
  const list = (monsters ?? []).filter((m) => m?.monster && Number.isFinite(m.weight) && m.weight > 0);
  if (!list.length) return monster ? [{ monster, weight: 1 }] : [];
  const sum = list.reduce((s, m) => s + m.weight, 0);
  return list.map((m) => ({ monster: m.monster, weight: m.weight / sum }));
}

export function expectedTargets(meta: Pick<SpellMeta, 'kind' | 'area' | 'avgHitsHunt' | 'maxTargets'>, ctx: FightContext, maxTargets = meta.maxTargets): number {
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

export function outerBeamTargets(meta: Pick<SpellMeta, 'area' | 'avgHitsHuntOuter'>, ctx: FightContext): number {
  if (meta.area !== 'beam' || ctx.mode === 'boss') return 0;
  const solo = meta.avgHitsHuntOuter ?? 0;
  if (ctx.huntStyle === 'solo') return solo;
  return Math.max(solo, HUNT_POOL[ctx.huntStyle] * BEAM_OUTER_REACH);
}

function hitPart(name: string, char: Required<CharacterStats>, vocation: Vocation, stage: number, part: 'main' | 'extra'): HitPart | null {
  const spell = getDamageSpell(name);
  const variant = spell && spellVariant(spell, stage, part);
  if (!variant) return null;
  const o = { vocation, stage, part };
  const base = spellAverageHit(name, char, o);
  return {
    base,
    boost: spellAverageHit(name, char, { ...o, baseDamagePct: 100 }) - base,
    bf: variant.bonusFactor,
  };
}

const modelCache = new Map<string, SpellModel>();

function cacheKey(vocation: Vocation, ctx: FightContext, monsters: { monster: Monster; weight: number }[], c: Required<CharacterStats>) {
  const m = monsters.map((x) => `${x.monster.id}:${x.weight.toFixed(6)}`).join(',');
  return `${vocation}|${ctx.mode}|${ctx.huntStyle}|${m}|${c.level}|${c.mainSkill}|${c.magicLevel}|${c.shielding}`;
}

export function buildSpellModel(
  vocation: Vocation,
  context: FightContext,
  monsters: { monster: Monster; weight: number }[] | Monster | null,
  character?: CharacterStats,
): SpellModel {
  const spot = Array.isArray(monsters) ? monsters : monsters ? [{ monster: monsters, weight: 1 }] : [];
  const char = resolveCharacterStats(vocation, character ?? { level: 600 });
  const key = cacheKey(vocation, context, spot, char);
  const cached = modelCache.get(key);
  if (cached && cached.monsters.every((m, i) => m.monster === spot[i].monster)) return cached;

  const wheel = getEngineWheel(vocation);
  const revOf = new Map<string, number>();
  const stageOf = new Map<string, number>();
  const passives = new Map<string, number>();
  wheel.revelations.forEach((r, d) => {
    r.data.spells.forEach((s) => (revOf.set(s, d), stageOf.set(s, d)));
    r.data.affectsSpells.forEach((s) => stageOf.set(s, d));
    if (PASSIVE_MULT[r.data.name]) passives.set(r.data.name, d);
  });

  const wheelSpells = getWheelSpellNames(vocation);
  const names = new Set([
    ...wheelSpells,
    ...getDamageSpells(vocation).filter((s) => s.spellType === 'spell').map((s) => s.name),
  ]);

  const spells = new Map<string, SpellEval>();
  for (const name of names) {
    const meta = getSpell(name);
    const dmg = getDamageSpell(name);
    const kind: SpellMeta['kind'] = meta?.kind ?? (dmg ? 'damage' : getHealingSpell(name) ? 'healing' : 'support');
    const area: SpellMeta['area'] = meta?.area ?? (dmg?.area as SpellMeta['area'] | undefined) ?? 'single';
    const singleTarget = dmg?.singleTarget ?? area === 'single';
    const element = meta?.element ?? dmg?.element ?? null;
    const revDef = REVELATION_SPELLS[name];
    const maxTargets = revDef?.maxTargets?.[2] ?? meta?.maxTargets ?? MAX_TARGETS_FALLBACK[area];
    const shape = { kind, area, maxTargets, avgHitsHunt: meta?.avgHitsHunt ?? dmg?.avgTargetsHunt ?? undefined };
    const revelation = revOf.get(name) ?? -1;
    const hits = [0, 1, 2, 3].map((st) => ({
      main: (kind === 'damage' && hitPart(name, char, vocation, st, 'main')) || { base: 0, boost: 0, bf: 0 },
      extra: kind === 'damage' && st > 0 ? hitPart(name, char, vocation, st, 'extra') : null,
    }));
    const isRune = dmg?.spellType === 'rune';
    spells.set(name, {
      name,
      meta,
      dmg,
      kind,
      element,
      area,
      singleTarget,
      maxTargets,
      targets: singleTarget ? 1 : expectedTargets(shape, context),
      outerTargets: outerBeamTargets({ area, avgHitsHuntOuter: meta?.avgHitsHuntOuter ?? dmg?.avgTargetsHuntOuter }, context),
      elem: kind === 'damage' ? spotElementMultiplier(spot, element) : 1,
      revelation,
      stageDomain: stageOf.get(name) ?? -1,
      avatar: meta?.isAvatar ?? false,
      usable: kind === 'damage' && !!dmg && !isRune && !(context.mode === 'hunt' && singleTarget),
      hits,
    });
  }

  const attack = weaponBracket(vocation, char.level).attack;
  const autoHit = vocation === 'sorcerer' || vocation === 'druid'
    ? levelTerm(char.level)
    : levelTerm(char.level) + 0.5 * 0.085 * char.mainSkill * attack;
  const autoTargets = context.mode === 'boss' ? 1 : AUTO_ATTACK_TARGETS[vocation][context.huntStyle];
  const base = autoHit * autoTargets * spotElementMultiplier(spot, 'physical') * critEV(0, 0);

  const model: SpellModel = {
    vocation,
    context,
    monsters: spot,
    character: char,
    spells,
    wheelSpells,
    passives,
    base,
    total: 1,
    flatOffPerPoint: 0,
    flatHealPerPoint: 0,
  };
  model.total = Math.max(1, rotationTotal(model, NO_BONUS));
  model.flatOffPerPoint = (100 * (rotationTotal(model, { ...NO_BONUS, flat: 1 }) - model.total)) / model.total;
  model.flatHealPerPoint = healFlatPerPoint(model);
  modelCache.set(key, model);
  if (modelCache.size > 100) modelCache.delete(modelCache.keys().next().value!);
  return model;
}

// ---------------------------------------------------------------------------
// Rotation

export interface SpellMods {
  /** +% base damage. */
  pct: number;
  /** +% critical hit chance / extra damage (percentage points). */
  critChance: number;
  critExtra: number;
  /** Cooldown reduction (s). */
  cd: number;
  /** Extra targets (jumps / larger area). */
  extraTargets: number;
}

export const NO_MODS: SpellMods = { pct: 0, critChance: 0, critExtra: 0, cd: 0, extraTargets: 0 };

export interface RotationInput {
  /** Revelation stage per domain. */
  stages: readonly number[];
  mods?: ReadonlyMap<string, SpellMods>;
  /** Flat damage & healing bonus (revelations + vessels). */
  flat?: number;
  /** Global crit extra damage (percentage points). */
  critExtra?: number;
}

export const NO_STAGES: readonly number[] = [0, 0, 0, 0];
export const NO_BONUS: RotationInput = { stages: NO_STAGES };

function critEV(chance: number, extra: number): number {
  return 1 + (Math.min(100, BASE_CRIT_CHANCE + chance) / 100) * ((BASE_CRIT_EXTRA + extra) / 100);
}

export function spellCooldown(name: string, stage = 3): number {
  const rev = REVELATION_SPELLS[name];
  if (rev) return rev.cooldown[Math.max(1, Math.min(3, stage)) - 1];
  const sup = SUPPORT_COOLDOWN[name];
  if (sup !== undefined) return typeof sup === 'number' ? sup : sup[Math.max(1, Math.min(3, stage)) - 1];
  return getDamageSpell(name)?.cooldownSeconds ?? getHealingSpell(name)?.cooldownSeconds ?? 0;
}

/** Cooldown (s) after a reduction, respecting the 50 % floor. */
export function reducedCooldown(base: number, reduction: number): number {
  return Math.max(base * COOLDOWN_FLOOR, base - Math.max(0, reduction));
}

/** Cast-rate gain (fraction) from a total cooldown reduction, respecting the 50 % floor. */
export function cooldownGain(base: number, reduction: number): number {
  if (base <= 0 || reduction <= 0) return 0;
  return base / reducedCooldown(base, reduction) - 1;
}

/** Targets of a spell at a revelation stage (revelation spells cap targets by stage) plus extra targets. */
export function targetsAt(model: SpellModel, s: SpellEval, stage: number, extra = 0): number {
  const def = REVELATION_SPELLS[s.name];
  const max = (def?.maxTargets && stage >= 1 ? def.maxTargets[stage - 1] : s.maxTargets) + extra;
  if (s.singleTarget) return 1;
  if (!extra && !(def?.maxTargets && stage >= 1)) return s.targets;
  const shape = { kind: s.kind, area: s.area, maxTargets: max, avgHitsHunt: s.meta?.avgHitsHunt ?? s.dmg?.avgTargetsHunt ?? undefined };
  const t = expectedTargets(shape, model.context, max);
  return model.context.mode === 'hunt' && model.context.huntStyle === 'solo' ? Math.min(max, t + extra * 0.5) : t;
}

/** Average damage of one cast (all targets, element, crit, passives). */
export function castDamage(model: SpellModel, s: SpellEval, r: RotationInput, m: SpellMods = NO_MODS): number {
  const stage = s.stageDomain >= 0 ? r.stages[s.stageDomain] ?? 0 : 0;
  if (s.revelation >= 0 && stage < 1) return 0;
  const h = s.hits[stage];
  const flat = r.flat ?? 0;
  const val = (p: HitPart) => p.base + (p.boost * m.pct) / 100 + flat * p.bf;
  const t = targetsAt(model, s, stage, m.extraTargets);
  const def = REVELATION_SPELLS[s.name];
  let dmg = val(h.main) * t;
  if (h.extra && stage >= 1) {
    if (s.area === 'beam') {
      const bonus = Math.min(BEAM_BONUS.cap[stage - 1], BEAM_BONUS.per[stage - 1] * (t + s.outerTargets)) / 100;
      dmg = val(h.main) * t * (1 + bonus) + val(h.extra) * s.outerTargets;
    } else if (def?.extra === 'replace') dmg = val(h.extra) * t;
    else if (def?.extra === 'half') dmg = ((val(h.main) + val(h.extra)) / 2) * t;
    else dmg += val(h.extra) * t;
  }
  let mult = s.elem * critEV(m.critChance, m.critExtra + (r.critExtra ?? 0));
  for (const [name, d] of model.passives) {
    const st = r.stages[d] ?? 0;
    const p = PASSIVE_MULT[name];
    if (st >= 1 && p.applies(s)) mult *= p.mult[st - 1];
  }
  return Math.max(0, dmg * mult);
}

export interface RotationResult {
  total: number;
  /** Casts per turn and damage per cast of each scheduled spell. */
  rates: Map<string, { rate: number; perCast: number }>;
}

/** Greedy single-slot schedule: highest damage per cast first, each capped at 1 / cooldown turns. */
export function rotation(model: SpellModel, r: RotationInput): RotationResult {
  const cands: { s: SpellEval; perCast: number; cap: number }[] = [];
  for (const s of model.spells.values()) {
    if (!s.usable) continue;
    const m = r.mods?.get(s.name) ?? NO_MODS;
    const stage = s.stageDomain >= 0 ? r.stages[s.stageDomain] ?? 0 : 0;
    const perCast = castDamage(model, s, r, m);
    if (perCast <= 0) continue;
    const cd = reducedCooldown(spellCooldown(s.name, stage), m.cd);
    cands.push({ s, perCast, cap: 1 / Math.max(1, cd / TURN_SECONDS) });
  }
  for (const group of SHARED_COOLDOWN) {
    const inGroup = cands.filter((c) => group.includes(c.s.name)).sort((a, b) => b.perCast - a.perCast || a.s.name.localeCompare(b.s.name));
    for (const c of inGroup.slice(1)) cands.splice(cands.indexOf(c), 1);
  }
  cands.sort((a, b) => b.perCast - a.perCast || a.s.name.localeCompare(b.s.name));
  let left = 1;
  let total = model.base;
  const rates = new Map<string, { rate: number; perCast: number }>();
  for (const c of cands) {
    const rate = Math.min(c.cap, left);
    if (rate <= 0) break;
    left -= rate;
    total += rate * c.perCast;
    rates.set(c.s.name, { rate, perCast: c.perCast });
  }
  return { total, rates };
}

export function rotationTotal(model: SpellModel, r: RotationInput): number {
  return rotation(model, r).total;
}

/** Δ% of total damage (relative to T0) between two rotation inputs. */
export function deltaOff(model: SpellModel, after: RotationInput, before: RotationInput): number {
  return (100 * (rotationTotal(model, after) - rotationTotal(model, before))) / model.total;
}

/** Percentage of total damage dealt by `name` at the given stages. */
export function damageShare(model: SpellModel, name: string, stages: readonly number[] = NO_STAGES): number {
  const r = rotation(model, { stages });
  const x = r.rates.get(name);
  return x ? (100 * x.rate * x.perCast) / r.total : 0;
}

/** Share for display (same as damageShare; kept for the UI wording). */
export const displayShare = damageShare;

// ---------------------------------------------------------------------------
// Healing

export function healShare(model: SpellModel, name: string): number {
  const share = HEAL_SHARE[name] ?? 0.2;
  if (!TEAM_HEALS.has(name)) return share;
  const ctx = model.context;
  if (ctx.mode === 'boss') return share;
  return share * (ctx.huntStyle === 'solo' ? 0.5 : 2);
}

/** Average healing of one cast of `name` (Canary formulas). */
export function healPerCast(model: SpellModel, name: string): number {
  return healingAverage(name, model.character, { vocation: model.vocation });
}

function healFlatPerPoint(model: SpellModel): number {
  let pct = 0;
  let weight = 0;
  for (const s of model.spells.values()) {
    if (s.kind !== 'healing') continue;
    const h = healPerCast(model, s.name);
    if (h <= 0) continue;
    const w = HEAL_SHARE[s.name] ?? 0.2;
    pct += (w * 100) / h;
    weight += w;
  }
  return weight > 0 ? pct / weight : 0;
}
