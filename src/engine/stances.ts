/**
 * D24 stances: applied to the character (skill / shielding), the spell model (element magic level, element
 * stance bonuses and conversion, pierce, harmony, damage dealt) and defense (damage taken, dodge, healing).
 */
import type { CharacterStats, FightContext, GearEffects, Monster, RotationPreset, Vocation } from '../types';
import { healingAverage, pierceDamageMod } from '../data/damage';
import { NON_ADJACENT_SHARE, sereneFactor, type StanceDef } from '../data/damage/stances';
import {
  buildSpellModel,
  elementMultiplier,
  HARMONY_SPENDERS,
  healShare,
  NO_BONUS,
  planFor,
  rotation,
  TEAM_HEALS,
  type ElementMagicLevel,
  type SpellEval,
  type SpellModel,
  type ModelExtras,
} from './spells';
import { applyLoadout, loadoutAttack, loadoutElementMl, type Loadout } from './proficiency';

/** Spender damage per +1 pp Harmony base bonus (Ascetic stage I probe: +1 pp → ×1.0478). */
export const HARMONY_PER_BASE_PCT = 0.0478;

export function stancedCharacter(c: Required<CharacterStats>, stances: readonly StanceDef[]): Required<CharacterStats> {
  let { mainSkill, shielding } = c;
  for (const s of stances) {
    if (s.skillPct) mainSkill = Math.floor(mainSkill * (1 + (s.skillPct * sereneFactor(s)) / 100));
    if (s.shieldingPct) shielding = Math.floor(shielding * (1 + s.shieldingPct / 100));
  }
  return { ...c, mainSkill, shielding };
}

export function stanceElementMl(c: Required<CharacterStats>, stances: readonly StanceDef[]): ElementMagicLevel {
  const out: ElementMagicLevel = {};
  for (const s of stances) {
    const e = s.elementMagicLevel;
    if (!e) continue;
    const bonus = Math.floor(((e.of === 'skill' ? c.mainSkill : c.magicLevel) * e.pct) / 100);
    for (const el of e.elements) out[el] = (out[el] ?? 0) + bonus;
  }
  return out;
}

function pierced(monsters: SpellModel['monsters'], s: SpellEval, pct: number): number {
  if (!monsters.length) return pierceDamageMod(1, pct);
  return monsters.reduce((a, m) => a + m.weight * pierceDamageMod(elementMultiplier(m.monster, s.element), pct), 0);
}

/** Spell-model part of the stances (character / element magic level already in `model`). */
export function applyStanceSpells(model: SpellModel, stances: readonly StanceDef[], preset: RotationPreset | null): SpellModel {
  if (!stances.length) return model;
  const pierce = stances.reduce((a, s) => a + (s.piercePct ?? 0), 0);
  const damageMult = stances.reduce((a, s) => a * (1 + (s.damageDonePct ?? 0) / 100), 1);
  const harmony = stances.reduce((a, s) => a + (s.harmonyBasePct ?? 0) * sereneFactor(s), 0);
  const el = stances.find((s) => s.element)?.element;
  const spells = new Map<string, SpellEval>();
  for (const [n, s0] of model.spells) {
    if (s0.kind !== 'damage') {
      spells.set(n, s0);
      continue;
    }
    const s: SpellEval = { ...s0 };
    if (pierce) s.elem = pierced(model.monsters, s, pierce);
    if (harmony && HARMONY_SPENDERS.has(n)) s.mult = (s.mult ?? 1) * (1 + HARMONY_PER_BASE_PCT * harmony);
    if (el && s.element === el.element) {
      s.stanceShare = 1;
      if (el.baseDamagePct) {
        const k = el.baseDamagePct / 100;
        s.hits = s.hits.map((h) => ({
          main: { ...h.main, base: h.main.base + k * h.main.boost },
          extra: h.extra && { ...h.extra, base: h.extra.base + k * h.extra.boost },
        }));
      }
      s.critChance = (s.critChance ?? 0) + (el.critChancePct ?? 0);
      s.critExtra = (s.critExtra ?? 0) + (el.critExtraPct ?? 0);
    }
    spells.set(n, s);
  }
  let out: SpellModel = { ...model, spells, damageMult, base: model.base * damageMult, stances: stances.map((s) => s.name), stanceElement: el?.element ?? undefined, pierce };
  if (el) out = convert(out, el.element, preset, pierce);
  return out;
}

/**
 * Elemental stance conversion: each cast of the element turns the next other-element spell into it.
 * Converted share of the other spells = min(1, casts of the element / other casts) at T0.
 */
function convert(model: SpellModel, element: SpellEval['element'], preset: RotationPreset | null, pierce: number): SpellModel {
  const rates = rotation({ ...model, plan: planFor(model, preset) }, NO_BONUS).rates;
  let own = 0;
  let other = 0;
  for (const [n, x] of rates) {
    const s = model.spells.get(n);
    if (!s || s.kind !== 'damage') continue;
    if (s.element === element) own += x.rate;
    else other += x.rate;
  }
  if (own <= 0 || other <= 0) return model;
  const f = Math.min(1, own / other);
  const spells = new Map(model.spells);
  for (const [n, s] of spells) {
    if (s.kind !== 'damage' || s.element === element) continue;
    const target = pierce ? pierced(model.monsters, { ...s, element }, pierce) : spotElem(model.monsters, element);
    spells.set(n, { ...s, elem: f * target + (1 - f) * s.elem, stanceShare: f });
  }
  return { ...model, spells };
}

function spotElem(monsters: SpellModel['monsters'], element: SpellEval['element']): number {
  return monsters.length ? monsters.reduce((a, m) => a + m.weight * elementMultiplier(m.monster, element), 0) : 1;
}

/**
 * Stanced model builder for a character (skill deltas use the same stances). D45: with a weapon loadout, the
 * character passed in must already include its skills (`loadoutCharacter`).
 */
export function stanceBuilder(
  vocation: Vocation,
  context: FightContext,
  monsters: { monster: Monster; weight: number }[],
  stances: readonly StanceDef[],
  preset: RotationPreset | null,
  loadout?: Loadout,
  /** D69: cooldown cuts (s) applied to the base spells (a plan's rotation augments). */
  preCd?: ReadonlyMap<string, number>,
  equipment?: GearEffects,
  /** D92 / D93: excluded spells, charms. */
  extras?: ModelExtras,
) {
  const cut = (m: SpellModel) => (preCd?.size ? withCooldownCuts(m, preCd) : m);
  if (!loadout) return (c: Required<CharacterStats>) => cut(applyStanceSpells(buildSpellModel(vocation, context, monsters, c, stanceElementMl(c, stances), undefined, equipment, extras), stances, preset));
  const { healing: _healing, ...weaponMl } = loadoutElementMl(loadout);
  const attack = loadoutAttack(vocation, loadout);
  return (c: Required<CharacterStats>) => {
    const ml: ElementMagicLevel = { ...stanceElementMl(c, stances) };
    for (const [e, x] of Object.entries(weaponMl) as [keyof ElementMagicLevel, number][]) ml[e] = (ml[e] ?? 0) + x;
    return cut(applyLoadout(applyStanceSpells(buildSpellModel(vocation, context, monsters, c, ml, attack, equipment, extras), stances, preset), loadout));
  };
}

/** Model with extra cooldown cuts (s) on some spells. */
function withCooldownCuts(m: SpellModel, preCd: ReadonlyMap<string, number>): SpellModel {
  const spells = new Map(m.spells);
  for (const [n, x] of preCd) {
    const s = spells.get(n);
    if (s) spells.set(n, { ...s, cd: (s.cd ?? 0) + x });
  }
  return { ...m, spells };
}

/** Defense of the stances in % EHP (before threat): damage taken, dodge, healing. Shielding goes through mitigation. */
export function stanceDefense(model: SpellModel, character: Required<CharacterStats>, stances: readonly StanceDef[], healEhp: number): number {
  let taken = 1;
  let heal = 0;
  const ml = stanceElementMl(character, stances).healing ?? 0;
  for (const s of stances) {
    taken *= 1 + (s.damageTakenPct ?? 0) / 100;
    taken *= 1 - ((s.dodgeNonAdjacentPct ?? 0) / 100) * NON_ADJACENT_SHARE;
  }
  for (const sp of model.spells.values()) {
    if (sp.kind !== 'healing') continue;
    const share = healShare(model, sp.name);
    let gain = 0;
    for (const s of stances) if (s.healingPct && (s.healingAll || !TEAM_HEALS.has(sp.name))) gain += s.healingPct * sereneFactor(s);
    if (ml) {
      const h0 = healingAverage(sp.name, character, { vocation: model.vocation });
      if (h0 > 0) gain += 100 * (healingAverage(sp.name, character, { vocation: model.vocation, magicLevelBonus: ml }) / h0 - 1);
    }
    heal += gain * share * healEhp;
  }
  return 100 * (1 / taken - 1) + heal;
}
