/**
 * D45 weapon proficiency: a weapon with its chosen perks (a "loadout") applied to the character, the spell model
 * (attack, skills, element magic level, augments, crit, pierce, damage multipliers, flat damage, auto-attack)
 * and to defense (leech, healing). See docs/modules/proficiency.md.
 */
import type { CharacterStats, Element, OwnedWeapon, Vocation } from '../types';
import { healingAverage, pierceDamageMod } from '../data/damage';
import { getShapingOption, getWeapon, shapedPerk, type Ammo, type Perk, type ProficiencySkill, type Weapon } from '../data/proficiency';
import {
  AUTO_ATTACK_TARGETS,
  autoAttackHit,
  critEV,
  damageShare,
  elementMultiplier,
  healShare,
  NO_STAGES,
  spotElementMultiplier,
  IMBUE_CRIT,
  type ElementMagicLevel,
  type SpellEval,
  type SpellModel,
} from './spells';
import { K, leechPoint, type Parts, type ValuationContext } from './values';

export const PROF = {
  /** Share of damage dealt to creatures at full health (alpha strike) / low health (omega strike). */
  ALPHA_SHARE: { hunt: 0.1, boss: 0.005 },
  OMEGA_SHARE: { hunt: 0.15, boss: 0.15 },
  /** Share of auto-attacks from far enough for range damage / perfect shot. */
  RANGE_SHARE: 0.25,
  /** Ammunition assumed with bows and crossbows (Diamond Arrow, Spectral Bolt). */
  ARROW_ATTACK: 37,
  BOLT_ATTACK: 78,
  /** Offensive spell casts per turn (homing missile trigger). */
  CASTS_PER_TURN: 1,
  /** Mana leech of the Powerful Void imbuement (%). */
  VOID_MANA_LEECH: 8,
} as const;

/** Rending Inferniarch weapons cannot take the critical hit (Strike) imbuement. */
export const noCritImbue = (w: Weapon) => w.id.startsWith('rending-inferniarch-');
/** D49: Siphoning Inferniarch weapons cannot take the life leech imbuement, Draining ones not the mana leech one. */
export const noLifeLeechImbue = (w: Weapon) => w.id.startsWith('siphoning-inferniarch-');
export const noManaLeechImbue = (w: Weapon) => w.id.startsWith('draining-inferniarch-');

export interface Loadout {
  weapon: Weapon;
  /** One perk per unlocked level. */
  perks: Perk[];
  /** D51: ammunition of a bow / crossbow (else the PROF defaults). */
  ammo?: Ammo;
}

const isMage = (v: Vocation) => v === 'sorcerer' || v === 'druid';

/** Options of each unlocked level (shaped slots replaced). */
export function levelOptions(owned: Pick<OwnedWeapon, 'level' | 'shaped'>, weapon: Weapon): Perk[][] {
  const n = Math.max(0, Math.min(weapon.levels.length, Math.floor(owned.level)));
  const out = weapon.levels.slice(0, n).map((l) => [...l]);
  for (const s of owned.shaped ?? []) {
    const o = getShapingOption(s.option);
    const level = out[s.level - 1];
    if (o && level && s.replaces >= 0 && s.replaces < level.length) level[s.replaces] = shapedPerk(o);
  }
  return out;
}

export function loadoutOf(weapon: Weapon, options: Perk[][], choice: readonly number[], ammo?: Ammo): Loadout {
  const perks = options.map((o, i) => o[Math.min(o.length - 1, Math.max(0, choice[i] ?? 0))]);
  return ammo ? { weapon, perks, ammo } : { weapon, perks };
}

/** Owned weapon → weapon + its options (null for unknown weapons). */
export function ownedOptions(owned: OwnedWeapon): { weapon: Weapon; options: Perk[][] } | null {
  const weapon = getWeapon(owned.weaponId);
  return weapon ? { weapon, options: levelOptions(owned, weapon) } : null;
}

/** Skill key of the vocation's main skill with this weapon. */
function mainSkillOf(vocation: Vocation, w: Weapon): ProficiencySkill | null {
  if (vocation === 'knight') return w.type === 'axe' || w.type === 'club' || w.type === 'sword' ? w.type : null;
  if (vocation === 'paladin') return 'distance';
  if (vocation === 'monk') return 'fist';
  return null;
}

const sum = (perks: readonly Perk[], f: (p: Perk) => boolean) => perks.reduce((a, p) => a + (f(p) ? p.value : 0), 0);

/** Character with the weapon's skill bonuses (skills are entered without weapon bonuses). */
export function loadoutCharacter(c: Required<CharacterStats>, vocation: Vocation, lo: Loadout): Required<CharacterStats> {
  const { weapon: w, perks } = lo;
  const main = mainSkillOf(vocation, w);
  const sp = w.specials?.skills ?? {};
  const skill = (k: ProficiencySkill) => sum(perks, (p) => p.kind === 'skill' && p.skill === k);
  return {
    ...c,
    mainSkill: c.mainSkill + (main ? (sp[main as keyof typeof sp] ?? 0) + skill(main) : 0),
    magicLevel: c.magicLevel + (sp.magic ?? 0) + skill('magic'),
    shielding: c.shielding + skill('shielding'),
  };
}

/** Weapon (+ ammunition) attack for spell formulas; undefined for mages. */
export function loadoutAttack(vocation: Vocation, lo: Loadout): number | undefined {
  if (isMage(vocation)) return undefined;
  const w = lo.weapon;
  const perk = sum(lo.perks, (p) => p.kind === 'attack');
  if (w.type === 'bow') return (w.specials?.attack ?? 0) + (lo.ammo?.attack ?? PROF.ARROW_ATTACK) + perk;
  if (w.type === 'crossbow') return (w.specials?.attack ?? 0) + (lo.ammo?.attack ?? PROF.BOLT_ATTACK) + perk;
  return (w.attack ?? 0) + (w.elementAttack?.value ?? 0) + perk;
}

export function loadoutElementMl(lo: Loadout): ElementMagicLevel & { healing?: number } {
  const out: Record<string, number> = { ...(lo.weapon.specials?.elementMagicLevel ?? {}) };
  for (const p of lo.perks) if (p.kind === 'magicLevel' && p.element) out[p.element] = (out[p.element] ?? 0) + p.value;
  return out;
}

/** Skill used by a skill-scaling perk (no skill = the highest one; fishing = 0). */
function scalingSkill(c: Required<CharacterStats>, p: Perk): number {
  switch (p.skill) {
    case undefined: return Math.max(c.mainSkill, c.magicLevel, c.shielding);
    case 'magic': return c.magicLevel;
    case 'shielding': return c.shielding;
    case 'fishing': return 0;
    default: return c.mainSkill;
  }
}

function bestiaryMult(model: SpellModel, perks: readonly Perk[]): number {
  if (model.context.mode !== 'hunt' || !model.monsters.length) return 1;
  const bonus = new Map<string, number>();
  for (const p of perks) if (p.kind === 'bestiary' && p.bestiary) bonus.set(p.bestiary, (bonus.get(p.bestiary) ?? 0) + p.value);
  if (!bonus.size) return 1;
  const w = model.monsters.reduce((a, m) => a + m.weight, 0);
  return model.monsters.reduce((a, m) => a + m.weight * (1 + (bonus.get(m.monster.bestiaryClass ?? '') ?? 0)), 0) / Math.max(1e-9, w);
}

function piercedElem(model: SpellModel, element: Element | null, pct: number): number {
  if (!model.monsters.length) return pierceDamageMod(1, pct);
  return model.monsters.reduce((a, m) => a + m.weight * pierceDamageMod(elementMultiplier(m.monster, element), pct), 0);
}

/**
 * Spell model with the loadout's perks (the model must be built with `loadoutCharacter`, `loadoutAttack` and
 * `loadoutElementMl`, stances already applied).
 */
export function applyLoadout(model: SpellModel, lo: Loadout): SpellModel {
  const { perks, weapon: w } = lo;
  const mode = model.context.mode;
  const c = model.character;
  const pp = (f: (p: Perk) => boolean) => 100 * sum(perks, f);
  const noImbue = noCritImbue(w);
  const gear = model.gear;
  const strike = gear?.weaponImbues ? { chance: gear.weaponImbues.critChance, extra: gear.weaponImbues.critExtra } : IMBUE_CRIT;
  const critChance = pp((p) => p.kind === 'critChance') + 100 * (w.specials?.critChance ?? 0) - (noImbue ? strike.chance : 0);
  const critExtra = pp((p) => p.kind === 'critDamage') + 100 * (w.specials?.critDamage ?? 0) - (noImbue ? strike.extra : 0);
  const elemCrit = (e: Element | null) => [pp((p) => p.kind === 'elementCritChance' && p.element === e), pp((p) => p.kind === 'elementCritDamage' && p.element === e)];
  const pierce = (e: Element | null) => pp((p) => p.kind === 'pierce' && p.element === e);
  const mult =
    bestiaryMult(model, perks) *
    (mode === 'boss' ? 1 + sum(perks, (p) => p.kind === 'boss') : 1) *
    (1 + PROF.ALPHA_SHARE[mode] * sum(perks, (p) => p.kind === 'alphaStrike')) *
    (1 + PROF.OMEGA_SHARE[mode] * sum(perks, (p) => p.kind === 'omegaStrike'));
  // D62: auto attacks and weapon spells (knight exori…, monk) deal the weapon's damage types: its main element
  // (monk elemental bond, amber weapons) and the elemental part, split by attack shares.
  const attack = loadoutAttack(model.vocation, lo) ?? 0;
  const mainElement: Element = isMage(model.vocation) ? 'physical' : (w.element ?? 'physical');
  const elemental = w.elementAttack && attack > 0 ? w.elementAttack : null;
  // D74: an elemental damage imbuement converts part of the physical damage.
  const conv = gear?.conversion;
  const mainMix = (e: Element) => {
    const own = piercedOr(model, e, pierce(e));
    if (e !== 'physical' || !conv) return own;
    const p = Math.min(100, conv.pct) / 100;
    return (1 - p) * own + p * piercedOr(model, conv.element, pierce(conv.element));
  };
  const weaponMix =
    mainElement === 'physical' && !elemental && !conv
      ? null
      : elemental
      ? ((attack - elemental.value) / attack) * mainMix(mainElement) +
        (elemental.value / attack) * piercedOr(model, elemental.element, pierce(elemental.element))
      : mainMix(mainElement);
  const flat = perks.reduce((a, p) => a + (p.kind === 'spellSkillScaling' ? p.value * scalingSkill(c, p) : 0), 0);

  const spells = new Map<string, SpellEval>();
  for (const [n, s0] of model.spells) {
    if (s0.kind !== 'damage') {
      spells.set(n, s0);
      continue;
    }
    const s: SpellEval = { ...s0 };
    const aug = (k: string) => sum(perks, (p) => p.kind === 'augment' && p.spell === n && p.augment === k);
    const k = aug('baseDamage');
    if (k) {
      s.hits = s.hits.map((h) => ({
        main: { ...h.main, base: h.main.base + k * h.main.boost },
        extra: h.extra && { ...h.extra, base: h.extra.base + k * h.extra.boost },
      }));
    }
    const cd = -aug('cooldown');
    if (cd) s.cd = (s.cd ?? 0) + cd;
    const [ec, ed] = elemCrit(s.element);
    s.critChance = (s.critChance ?? 0) + critChance + ec + 100 * aug('critChance');
    s.critExtra = (s.critExtra ?? 0) + critExtra + ed + 100 * aug('critDamage');
    const pc = pierce(s.element);
    if (weaponMix !== null && s.dmg?.weaponElement) s.elem = weaponMix;
    else if (pc) s.elem *= piercedElem(model, s.element, (model.pierce ?? 0) + pc) / Math.max(1e-9, piercedElem(model, s.element, model.pierce ?? 0));
    s.mult = (s.mult ?? 1) * mult;
    spells.set(n, s);
  }

  let base = model.base;
  let targets: number | undefined;
  if (!isMage(model.vocation)) {
    // Elemental ammunition turns the whole shot into its element.
    const ammoElement = lo.ammo && lo.ammo.element !== 'physical' ? lo.ammo.element : null;
    const autoElement = ammoElement ?? mainElement;
    const autoMix = ammoElement
      ? piercedOr(model, ammoElement, pierce(ammoElement))
      : (weaponMix ?? piercedOr(model, 'physical', pierce('physical')));
    const range = perks.reduce((a, p) => a + (p.kind === 'rangeDamage' ? p.value : 0), 0) + (w.specials?.perfectShot?.value ?? 0);
    const hit =
      autoAttackHit(model.vocation, c, attack) +
      perks.reduce((a, p) => a + (p.kind === 'autoSkillScaling' ? p.value * scalingSkill(c, p) : 0), 0) +
      range * PROF.RANGE_SHARE;
    // Paladins: bows without known ammunition assume diamond arrows; crossbows (spectral bolts) hit one target.
    const hunt = model.vocation !== 'paladin' ? AUTO_ATTACK_TARGETS[model.vocation] : w.type === 'bow' ? (lo.ammo?.targets ?? AUTO_ATTACK_TARGETS.paladin) : (lo.ammo?.targets ?? 1);
    targets = mode === 'boss' ? 1 : hunt;
    const [pc, pd] = elemCrit(autoElement);
    const crit = critEV(
      critChance + pc + pp((p) => p.kind === 'autoCritChance') + (gear?.critChance ?? 0),
      critExtra + pd + pp((p) => p.kind === 'autoCritDamage') + (gear?.critExtra ?? 0),
    );
    base = hit * targets * autoMix * crit * (model.damageMult ?? 1) * mult * (gear?.mult ?? 1);
  }
  for (const p of perks) {
    if (p.kind !== 'homingMissile' || !p.element) continue;
    base += PROF.CASTS_PER_TURN * p.value * (p.levelMultiplier ?? 0) * c.level * spotElementMultiplier(model.monsters, p.element) * mult;
  }
  return { ...model, spells, base, flat: (model.flat ?? 0) + flat, weaponId: w.id, ...(targets !== undefined ? { autoTargets: targets } : {}) };
}

/** Spot multiplier of an element with extra pierce (on top of the stances' pierce). */
function piercedOr(model: SpellModel, e: Element, pct: number): number {
  const p = model.pierce ?? 0;
  if (!pct && !p) return spotElementMultiplier(model.monsters, e);
  return piercedElem(model, e, p + pct);
}

/**
 * Defense / sustain of the loadout not covered by the spell model: life and mana leech, healing (flat, augments,
 * healing magic level). `v.model` must be the loadout's model.
 */
export function loadoutParts(v: ValuationContext, lo: Loadout): Parts {
  const { perks, weapon: w } = lo;
  const m = v.model;
  let life = 100 * (sum(perks, (p) => p.kind === 'lifeLeech') + (w.specials?.lifeLeech ?? 0));
  let mana = 100 * (sum(perks, (p) => p.kind === 'manaLeech') + (w.specials?.manaLeech ?? 0));
  // The weapon's share of the imbuements (default: half of K.LIFE_LEECH_IMBUE, i.e. one of two items).
  const imbues = m.gear?.weaponImbues;
  if (noLifeLeechImbue(w)) life -= imbues ? imbues.lifeLeech : K.LIFE_LEECH_IMBUE[m.vocation] / 2;
  if (noManaLeechImbue(w)) mana -= imbues ? imbues.manaLeech : PROF.VOID_MANA_LEECH;
  let heal = 0;
  const c = m.character;
  const flatHeal = perks.reduce((a, p) => a + (p.kind === 'healSkillScaling' ? p.value * scalingSkill(c, p) : 0), 0);
  heal += flatHeal * m.flatHealPerPoint;
  const ml = loadoutElementMl(lo).healing ?? 0;
  for (const p of perks) {
    if (p.kind !== 'augment' || !p.spell) continue;
    if (p.augment === 'lifeLeech' || p.augment === 'manaLeech') {
      const share = damageShare(m, p.spell, NO_STAGES) / 100;
      if (p.augment === 'lifeLeech') life += 100 * p.value * share;
      else mana += 100 * p.value * share;
    } else if (p.augment === 'healing' && m.spells.get(p.spell)?.kind === 'healing') heal += 100 * p.value * healShare(m, p.spell);
  }
  if (ml) {
    for (const s of m.spells.values()) {
      if (s.kind !== 'healing') continue;
      const h0 = healingAverage(s.name, c, { vocation: m.vocation });
      if (h0 > 0) heal += 100 * (healingAverage(s.name, c, { vocation: m.vocation, magicLevelBonus: ml }) / h0 - 1) * healShare(m, s.name);
    }
  }
  return {
    off: mana * K.MANA_LEECH_OFF,
    def: (life * leechPoint(v) + mana * K.MANA_LEECH_DEF + heal * K.HEAL_EHP) * v.threat,
    util: 0,
  };
}

/**
 * Perk choice by coordinate descent: each free level takes its best option given the others (2 passes).
 * `fixed[i]` (an option index) is kept.
 */
export function choosePerks(options: Perk[][], fixed: readonly (number | null | undefined)[], score: (choice: number[]) => number): number[] {
  const choice = options.map((o, i) => {
    const f = fixed[i];
    return f != null && f >= 0 && f < o.length ? f : 0;
  });
  const free = options.map((o, i) => o.length > 1 && !(fixed[i] != null && fixed[i]! >= 0 && fixed[i]! < o.length));
  let best = score(choice);
  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    for (let i = 0; i < options.length; i++) {
      if (!free[i]) continue;
      const keep = choice[i];
      let pick = keep;
      for (let k = 0; k < options[i].length; k++) {
        if (k === keep) continue;
        choice[i] = k;
        const s = score(choice);
        if (s > best + 1e-9) {
          best = s;
          pick = k;
        }
      }
      choice[i] = pick;
      if (pick !== keep) changed = true;
    }
    if (!changed) break;
  }
  return choice;
}
