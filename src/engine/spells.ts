/**
 * Damage model per context, built on the fitted damage API formulas (`src/data/damage`).
 *
 * damage per turn T = auto-attack + Σ rate(S) × perCast(S)
 * perCast(S)        = hit(S, level, skills, stage) × targets(S, context) × element(S, monsters) × crit EV
 * rate(S)           = greedy fill of the single attack-spell slot per 2 s turn by perCast, capped at 1 / cooldown turns (rounded up: 2 s grid)
 *
 * D16: in hunt mode single-target spells never enter the rotation (zero value for their augments/gems).
 * Perk values are ΔT / T0 (T0 = rotation without wheel bonuses, no revelation).
 */
import { GREEDY_ROTATION_ID, type CharacterStats, type Element, type FightContext, type Monster, type RotationPreset, type Vocation, type WeightedMonster } from '../types';
import { getSpell, getWheelSpellNames, type SpellMeta } from '../data/wheel';
import {
  getDamageSpell,
  getDamageSpells,
  getHealingSpell,
  healingAverage,
  revelationSpell,
  levelTerm,
  spellAverageHit,
  spellVariant,
  SPELL_FORMULAS,
  TURN_SECONDS,
  paladinWeaponFor,
  weaponBracket,
  type DamageSpell,
} from '../data/damage';
import { resolveCharacterStats } from '../data/character';
import { getEngineWheel } from './wheel/build';

export const DEFAULT_CONTEXT: FightContext = { mode: 'hunt' };

/** Area/chain/beam targets in boss mode (summons, adds). */
export const BOSS_AREA_TARGETS = 1.2;
/** Wheel area augments ('Expanded Shape' etc.): community hunt averages assume them (D22). */
export const AREA_AUGMENT = /Expanded Shape|area enlarged|Range increased/i;
export const AREA_AUGMENT_GAP = 0.5;
const SOLO_FALLBACK: Record<SpellMeta['area'], number> = { single: 1, area: 5, chain: 4, beam: 2.4 };
const MAX_TARGETS_FALLBACK: Record<SpellMeta['area'], number> = { single: 1, area: 20, chain: 6, beam: 7 };
/** Cooldown can never drop below this fraction of the base cooldown. */
export const COOLDOWN_FLOOR = 0.5;
/** Default crit = the Powerful Strike imbuement (chance / extra damage, pp). */
export const IMBUE_CRIT = { chance: SPELL_FORMULAS.critDefaults.critChance, extra: SPELL_FORMULAS.critDefaults.critDamage };
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
/** Revelation passives that scale spell damage (damage API probes). */
const PASSIVE_MULT: Record<string, { mult: number[]; applies: (s: SpellEval) => boolean }> = {
  'Combat Mastery': { mult: [1.0308, 1.0368, 1.045], applies: () => true },
  Ascetic: { mult: [1.0478, 1.0957, 1.1446], applies: (s) => HARMONY_SPENDERS.has(s.name) },
};
/**
 * Lord of Destruction boosts the damage type of the elemental stance (wheel data): Flames +2/3/4 % fire damage
 * (damage API probe ×1.0148/1.0222/1.0296), Thunder +2/3/4 pp crit chance, Decay +15/25.5/30 pp crit extra damage.
 * Applies to spells dealing that type (natural + converted share); nothing without an elemental stance.
 */
export const LORD_OF_DESTRUCTION = { name: 'Lord of Destruction', fireMult: [1.0148, 1.0222, 1.0296], critChance: [2, 3, 4], critExtra: [15, 25.5, 30] };
/** Monk spells that spend Harmony (Ascetic). Approximate. */
export const HARMONY_SPENDERS = new Set([
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
  'Intense Wound Cleansing': 0.08,
  Salvation: 0.5,
  'Ultimate Healing': 0.4,
  "Nature's Embrace": 0.3,
  'Heal Friend': 0.15,
  'Mass Healing': 0.2,
  'Spirit Mend': 0.6,
  'Mass Spirit Mend': 0.25,
};
export const TEAM_HEALS = new Set(['Heal Friend', 'Mass Healing', 'Mass Spirit Mend']);

/** Auto-attack targets while hunting: avg hit ≈ level term + 0.5 × 0.085 × skill × attack; paladin diamond arrows hit an area (6, D59). */
export const AUTO_ATTACK_TARGETS: Record<Vocation, number> = { knight: 1, paladin: 6, sorcerer: 1, druid: 1, monk: 1 };

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
  /** Hunt: community averages already include the wheel's area augment (D22); without it the spell hits this many fewer. */
  areaGap: number;
  /** Part of the attack rotation (damage spell, not a rune; D16: not single-target in hunt mode). */
  usable: boolean;
  /** D24 stances: extra crit chance / extra damage (pp) and damage multiplier of this spell. */
  critChance?: number;
  critExtra?: number;
  mult?: number;
  /** D45: cooldown reduction (s) from weapon proficiency augments. */
  cd?: number;
  /** Share of casts dealing the elemental stance's damage type (1 natural, conversion share otherwise). */
  stanceShare?: number;
  /** Hits per stage 0..3: main, extra (null if none). */
  hits: { main: HitPart; extra: HitPart | null }[];
}

/**
 * Rotation the damage model is based on (D20). `preset` null = greedy schedule over every usable spell
 * (boss mode / tests). Revelation-granted spells are never preset entries: they are cast on cooldown while active.
 */
export interface RotationPlan {
  id: string;
  preset: RotationPreset | null;
  /** Preset spells with `or` alternatives resolved vs the spot. */
  entries: { name: string; ratio: number; slot?: string[] }[];
  /** Requires a shield (knight mitigation uses the shield offhand). */
  shield: boolean;
  /** Revelation the preset requires (valid only when reached). */
  requires: string | null;
}

export const GREEDY_PLAN_ID = GREEDY_ROTATION_ID;
const GREEDY_PLAN: RotationPlan = { id: GREEDY_PLAN_ID, preset: null, entries: [], shield: false, requires: null };

export interface SpellModel {
  vocation: Vocation;
  plan: RotationPlan;
  /** 100 × (T0 of this plan − reference) / reference: offset vs the common reference rotation. */
  baseOff: number;
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
  /** D24: multiplier of all damage dealt (Protector). */
  damageMult?: number;
  /** D24: active stances. */
  stances?: string[];
  /** D24: damage type of the elemental stance (Lord of Destruction). */
  stanceElement?: Element;
  /** D24: pierce % of the stances (all damage spells). */
  pierce?: number;
  /** D45: flat damage per spell hit from weapon proficiency (skill scaling), × the hit's bonus factor. */
  flat?: number;
  /** D45: weapon id the model includes. */
  weaponId?: string;
  /** D59: auto-attack targets of the weapon loadout (ammunition); default `AUTO_ATTACK_TARGETS`. */
  autoTargets?: number;
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
  if (meta.kind === 'healing' || meta.area === 'single' || maxTargets <= 1) return 1;
  if (ctx.mode === 'boss') return Math.min(maxTargets, BOSS_AREA_TARGETS);
  return Math.min(maxTargets, meta.avgHitsHunt ?? SOLO_FALLBACK[meta.area]);
}

export function outerBeamTargets(meta: Pick<SpellMeta, 'area' | 'avgHitsHuntOuter'>, ctx: FightContext): number {
  if (meta.area !== 'beam' || ctx.mode === 'boss') return 0;
  return meta.avgHitsHuntOuter ?? 0;
}

function hitPart(name: string, char: Required<CharacterStats>, vocation: Vocation, mode: FightContext['mode'], stage: number, part: 'main' | 'extra', magicLevelBonus = 0, attack?: number): HitPart | null {
  const spell = getDamageSpell(name);
  const variant = spell && spellVariant(spell, stage, part);
  if (!variant) return null;
  const o = { vocation, stage, part, paladinWeapon: paladinWeaponFor(mode), magicLevelBonus, attack };
  const base = spellAverageHit(name, char, o);
  return {
    base,
    boost: spellAverageHit(name, char, { ...o, baseDamagePct: 100 }) - base,
    bf: variant.bonusFactor,
  };
}

const modelCache = new Map<string, SpellModel>();

/** D24: extra magic level for spells of some elements (stances). */
export type ElementMagicLevel = Partial<Record<Element, number>>;

function cacheKey(vocation: Vocation, ctx: FightContext, monsters: { monster: Monster; weight: number }[], c: Required<CharacterStats>, eml: ElementMagicLevel, attack?: number) {
  const m = monsters.map((x) => `${x.monster.id}:${x.weight.toFixed(6)}`).join(',');
  return `${vocation}|${ctx.mode}|${m}|${c.level}|${c.mainSkill}|${c.magicLevel}|${c.shielding}|${JSON.stringify(eml)}|${attack ?? ''}`;
}

export function buildSpellModel(
  vocation: Vocation,
  context: FightContext,
  monsters: { monster: Monster; weight: number }[] | Monster | null,
  character?: CharacterStats,
  elementMl: ElementMagicLevel = {},
  /** D45: weapon (+ammo) attack; default = the level bracket weapon. */
  weaponAttack?: number,
): SpellModel {
  const spot = Array.isArray(monsters) ? monsters : monsters ? [{ monster: monsters, weight: 1 }] : [];
  const char = resolveCharacterStats(vocation, character ?? { level: 600 });
  const key = cacheKey(vocation, context, spot, char, elementMl, weaponAttack);
  const cached = modelCache.get(key);
  if (cached && cached.monsters.every((m, i) => m.monster === spot[i].monster)) return cached;

  const wheel = getEngineWheel(vocation);
  const revOf = new Map<string, number>();
  const stageOf = new Map<string, number>();
  const passives = new Map<string, number>();
  wheel.revelations.forEach((r, d) => {
    r.data.spells.forEach((s) => (revOf.set(s, d), stageOf.set(s, d)));
    r.data.affectsSpells.forEach((s) => stageOf.set(s, d));
    if (PASSIVE_MULT[r.data.name] || r.data.name === LORD_OF_DESTRUCTION.name) passives.set(r.data.name, d);
  });

  const wheelSpells = getWheelSpellNames(vocation);
  const names = new Set([
    ...wheelSpells,
    ...getDamageSpells(vocation).filter((s) => s.spellType === 'spell').map((s) => s.name),
  ]);

  const areaAug = new Set<string>();
  for (const sl of wheel.slices) {
    const a = sl.tile.conviction.augment;
    if (a && AREA_AUGMENT.test(a.stage1 + ' ' + a.stage2)) a.spells.forEach((n) => areaAug.add(n));
  }
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
    const ml = (element && elementMl[element]) || 0;
    const hits = [0, 1, 2, 3].map((st) => ({
      main: (kind === 'damage' && hitPart(name, char, vocation, context.mode, st, 'main', ml, weaponAttack)) || { base: 0, boost: 0, bf: 0 },
      extra: kind === 'damage' && st > 0 ? hitPart(name, char, vocation, context.mode, st, 'extra', ml, weaponAttack) : null,
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
      areaGap: context.mode === 'hunt' && !singleTarget && areaAug.has(name) ? AREA_AUGMENT_GAP : 0,
      targets: singleTarget ? 1 : Math.max(1, expectedTargets(shape, context) - (context.mode === 'hunt' && areaAug.has(name) ? AREA_AUGMENT_GAP : 0)),
      outerTargets: outerBeamTargets({ area, avgHitsHuntOuter: meta?.avgHitsHuntOuter ?? dmg?.avgTargetsHuntOuter }, context),
      elem: kind === 'damage' ? spotElementMultiplier(spot, element) : 1,
      revelation,
      stageDomain: stageOf.get(name) ?? -1,
      avatar: meta?.isAvatar ?? false,
      usable: kind === 'damage' && !!dmg && !isRune && !(context.mode === 'hunt' && singleTarget),
      hits,
    });
  }

  const attack = weaponAttack ?? weaponBracket(vocation, char.level, paladinWeaponFor(context.mode)).attack;
  const autoHit = autoAttackHit(vocation, char, attack);
  const autoTargets = context.mode === 'boss' ? 1 : AUTO_ATTACK_TARGETS[vocation];
  const base = autoHit * autoTargets * spotElementMultiplier(spot, 'physical') * critEV(0, 0);

  const model: SpellModel = {
    vocation,
    plan: GREEDY_PLAN,
    baseOff: 0,
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

/** Average auto-attack hit (one target, before element and crit); mages: level term only. */
export function autoAttackHit(vocation: Vocation, char: Required<CharacterStats>, attack: number): number {
  return vocation === 'sorcerer' || vocation === 'druid' ? levelTerm(char.level) : levelTerm(char.level) + 0.5 * 0.085 * char.mainSkill * attack;
}

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

/** Expected crit multiplier on top of the defaults (chance / extra in percentage points). */
export function critEV(chance: number, extra: number): number {
  return 1 + (Math.max(0, Math.min(100, BASE_CRIT_CHANCE + chance)) / 100) * (Math.max(0, BASE_CRIT_EXTRA + extra) / 100);
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

/** D65: turns between casts of a spell with cooldown `cd` (s); attack spells are cast on the 2 s turn grid. */
export const cooldownTurns = (cd: number) => Math.max(1, Math.ceil(cd / TURN_SECONDS - 1e-9));

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
  return model.context.mode === 'hunt' ? Math.max(1, Math.min(max, t - s.areaGap + extra * 0.5)) : t;
}

/** Average damage of one cast (all targets, element, crit, passives). */
export function castDamage(model: SpellModel, s: SpellEval, r: RotationInput, m: SpellMods = NO_MODS): number {
  const stage = s.stageDomain >= 0 ? r.stages[s.stageDomain] ?? 0 : 0;
  if (s.revelation >= 0 && stage < 1) return 0;
  const h = s.hits[stage];
  const flat = (r.flat ?? 0) + (model.flat ?? 0);
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
  let critChance = m.critChance + (s.critChance ?? 0);
  let critExtra = m.critExtra + (s.critExtra ?? 0) + (r.critExtra ?? 0);
  let mult = s.elem * (s.mult ?? 1) * (model.damageMult ?? 1);
  for (const [name, d] of model.passives) {
    const st = r.stages[d] ?? 0;
    if (st < 1) continue;
    if (name === LORD_OF_DESTRUCTION.name) {
      const share = s.stanceShare ?? 0;
      const lod = LORD_OF_DESTRUCTION;
      if (!share) continue;
      if (model.stanceElement === 'fire') mult *= 1 + share * (lod.fireMult[st - 1] - 1);
      else if (model.stanceElement === 'energy') critChance += share * lod.critChance[st - 1];
      else if (model.stanceElement === 'death') critExtra += share * lod.critExtra[st - 1];
      continue;
    }
    const p = PASSIVE_MULT[name];
    if (p.applies(s)) mult *= p.mult[st - 1];
  }
  mult *= critEV(critChance, critExtra);
  return Math.max(0, dmg * mult);
}

export interface RotationResult {
  total: number;
  /** Casts per turn and damage per cast of each scheduled spell. */
  rates: Map<string, { rate: number; perCast: number }>;
}

type Cand = { s: SpellEval; perCast: number; cap: number };

function candidate(model: SpellModel, s: SpellEval, r: RotationInput): Cand | null {
  const m = r.mods?.get(s.name) ?? NO_MODS;
  const stage = s.stageDomain >= 0 ? r.stages[s.stageDomain] ?? 0 : 0;
  const perCast = castDamage(model, s, r, m);
  if (perCast <= 0 && s.revelation >= 0) return null;
  const cd = reducedCooldown(spellCooldown(s.name, stage), m.cd + (s.cd ?? 0));
  return { s, perCast, cap: 1 / cooldownTurns(cd) };
}

function dropSharedCooldowns(cands: Cand[]) {
  for (const group of SHARED_COOLDOWN) {
    const inGroup = cands.filter((c) => group.includes(c.s.name)).sort((a, b) => b.perCast - a.perCast || a.s.name.localeCompare(b.s.name));
    for (const c of inGroup.slice(1)) cands.splice(cands.indexOf(c), 1);
  }
}

/**
 * Preset schedule: revelation spells first, on cooldown; preset spells share the remaining turns in their
 * ratio (water-filling), each capped at 1 / cooldown turns.
 */
function presetRotation(model: SpellModel, r: RotationInput): RotationResult {
  const rates = new Map<string, { rate: number; perCast: number }>();
  let total = model.base;
  let left = 1;
  const rev: Cand[] = [];
  const inSlot = new Set(model.plan.entries.flatMap((e) => e.slot ?? []));
  for (const s of model.spells.values()) {
    if (!s.usable || s.revelation < 0 || inSlot.has(s.name)) continue;
    // D66: a Harmony spender is only cast in the spender slot of a preset.
    if (HARMONY_SPENDERS.has(s.name)) continue;
    const c = candidate(model, s, r);
    if (c) rev.push(c);
  }
  dropSharedCooldowns(rev);
  rev.sort((a, b) => b.perCast - a.perCast || a.s.name.localeCompare(b.s.name));
  for (const c of rev) {
    const rate = Math.min(c.cap, left);
    if (rate <= 0) break;
    left -= rate;
    total += rate * c.perCast;
    rates.set(c.s.name, { rate, perCast: c.perCast });
  }
  const items: (Cand & { ratio: number; alts: Cand[] })[] = [];
  for (const e of model.plan.entries) {
    const s = model.spells.get(e.name);
    const c = s?.usable && s.revelation < 0 ? candidate(model, s, r) : null;
    if (!c || e.ratio <= 0) continue;
    // D66: slot spells share the entry's turns, best per cast first; the slot's cap is the sum of their caps.
    const alts = [c];
    for (const n of e.slot ?? []) {
      const a = model.spells.get(n);
      const ac = a?.usable ? candidate(model, a, r) : null;
      if (ac && ac.perCast > 0) alts.push(ac);
    }
    alts.sort((a, b) => b.perCast - a.perCast || a.s.name.localeCompare(b.s.name));
    items.push({ ...c, cap: alts.reduce((x, a) => x + a.cap, 0), ratio: e.ratio, alts });
  }
  items.sort((a, b) => a.cap / a.ratio - b.cap / b.ratio || a.s.name.localeCompare(b.s.name));
  let ratioSum = items.reduce((a, x) => a + x.ratio, 0);
  for (const c of items) {
    const rate = Math.max(0, Math.min(c.cap, (left * c.ratio) / ratioSum));
    left -= rate;
    ratioSum -= c.ratio;
    let rest = rate;
    for (const a of c.alts) {
      const x = Math.min(a.cap, rest);
      rest -= x;
      if (x <= 0 && a !== c) continue;
      total += x * a.perCast;
      rates.set(a.s.name, { rate: x, perCast: a.perCast });
    }
  }
  return { total, rates };
}

/** Rotation of the model's plan: preset schedule, or greedy (highest damage per cast first, capped at 1 / cooldown). */
export function rotation(model: SpellModel, r: RotationInput): RotationResult {
  if (model.plan.preset) return presetRotation(model, r);
  const cands: { s: SpellEval; perCast: number; cap: number }[] = [];
  for (const s of model.spells.values()) {
    if (!s.usable) continue;
    const m = r.mods?.get(s.name) ?? NO_MODS;
    const stage = s.stageDomain >= 0 ? r.stages[s.stageDomain] ?? 0 : 0;
    const perCast = castDamage(model, s, r, m);
    if (perCast <= 0) continue;
    const cd = reducedCooldown(spellCooldown(s.name, stage), m.cd + (s.cd ?? 0));
    cands.push({ s, perCast, cap: 1 / cooldownTurns(cd) });
  }
  dropSharedCooldowns(cands);
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

/** Resolves a preset vs the model's spot: `or` alternatives → best damage per cast; revelation spells dropped (added while active). */
export function planFor(model: SpellModel, preset: RotationPreset | null): RotationPlan {
  if (!preset) return GREEDY_PLAN;
  const at3: RotationInput = { stages: [3, 3, 3, 3] };
  const dmg = (n: string) => {
    const s = model.spells.get(n);
    return s ? castDamage(model, s, at3) : -1;
  };
  const entries: RotationPlan['entries'] = [];
  for (const e of preset.spells) {
    const opts = [e.name, ...(e.or ?? [])];
    const best = opts.reduce((a, b) => (dmg(b) > dmg(a) ? b : a));
    if (revelationSpell(best) || !model.spells.has(best)) continue;
    const prev = entries.find((x) => x.name === best);
    if (prev) prev.ratio += e.ratio;
    else entries.push({ name: best, ratio: e.ratio, ...(e.slot ? { slot: e.slot } : {}) });
  }
  return { id: preset.id, preset, entries, shield: !!preset.requires?.shield, requires: preset.requires?.revelation ?? null };
}

/**
 * The model with a rotation plan. `reference` (T0 of a common reference rotation) makes perk values of
 * different plans comparable: off = ΔT / reference; `baseOff` = (T0 − reference) / reference.
 */
export function withPlan(model: SpellModel, preset: RotationPreset | null, reference?: number): SpellModel {
  const m: SpellModel = { ...model, plan: planFor(model, preset), baseOff: 0 };
  const t0 = Math.max(1, rotationTotal(m, NO_BONUS));
  m.total = reference ?? t0;
  m.baseOff = (100 * (t0 - m.total)) / m.total;
  m.flatOffPerPoint = (100 * (rotationTotal(m, { ...NO_BONUS, flat: 1 }) - t0)) / m.total;
  return m;
}

/** T0 (no wheel bonuses) of a preset on a model. */
export function planTotal(model: SpellModel, preset: RotationPreset | null): number {
  return Math.max(1, rotationTotal({ ...model, plan: planFor(model, preset) }, NO_BONUS));
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
  return ctx.mode === 'boss' ? share : share * 0.5;
}

/** Average healing of one cast of `name` (approximate formulas). */
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
