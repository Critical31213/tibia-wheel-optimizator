/**
 * D74: effects of a worn equipment set (items, imbuements, forge tiers) as the engine uses them.
 * The choice of the set among the owned items is in `optimizer.ts` (`wearBest`).
 */
import type { Element, GearEffects, GearImbue, GearPiece, GearSlot, MeleeSkill, Vocation, WeaponGear } from '../types';
import { GEAR_SLOTS, getImbuement, getItem, INTRINSIC_CRIT, itemAugments, itemMantra, tierChance, type ItemSkill } from '../data/equipment';
import { K } from './values';

/** One item (or none) per slot. */
export interface WornGear {
  pieces: Partial<Record<GearSlot, GearPiece>>;
  weapon: WeaponGear | null;
}

export const imbueValue = (c: GearImbue) => getImbuement(c.id)?.values[c.level - 1] ?? 0;

const MAIN_SKILL: Record<Vocation, ItemSkill | null> = { knight: null, paladin: 'distance', monk: 'fist', sorcerer: null, druid: null };

interface Totals {
  skills: Partial<Record<ItemSkill, number>>;
  elementMl: Partial<Record<Element, number>>;
  resist: Partial<Record<Element, number>>;
  lifeLeech: number;
}

function addTo<T extends string>(to: Partial<Record<T, number>>, from: Partial<Record<T, number>> | undefined) {
  for (const [k, v] of Object.entries(from ?? {}) as [T, number][]) to[k] = (to[k] ?? 0) + v;
}

/** D80: protections stack multiplicatively (damage taken = Π (1 − r)); the total is the combined %. */
function stackResist(to: Partial<Record<Element, number>>, from: Partial<Record<Element, number>> | undefined) {
  for (const [k, v] of Object.entries(from ?? {}) as [Element, number][]) to[k] = Math.round(1e6 * (1 - (1 - (to[k] ?? 0) / 100) * (1 - v / 100))) / 1e4;
}

function addImbues(t: Totals, imbues: readonly GearImbue[] | undefined) {
  for (const c of imbues ?? []) {
    const d = getImbuement(c.id);
    if (!d) continue;
    const v = imbueValue(c);
    if (d.group === 'skill' && d.skill) t.skills[d.skill] = (t.skills[d.skill] ?? 0) + v;
    else if (d.group === 'protection' && d.element) stackResist(t.resist, { [d.element]: v });
  }
}

const leechOf = (imbues: readonly GearImbue[] | undefined) => (imbues ?? []).reduce((a, c) => a + (c.id === 'vampirism' ? imbueValue(c) : 0), 0);

/**
 * Engine effects of a worn set. Empty slots keep their default assumption (typical off-hand, default imbuements).
 * Knights: the trained melee skill (else the best melee bonus).
 */
export function gearEffects(g: WornGear, vocation: Vocation, meleeSkill: MeleeSkill | null | undefined): GearEffects {
  const t: Totals = { skills: {}, elementMl: {}, resist: {}, lifeLeech: 0 };
  for (const s of GEAR_SLOTS) {
    const p = g.pieces[s];
    const item = p && getItem(p.itemId);
    if (!p || !item) continue;
    addTo(t.skills, item.bonus?.skills);
    addTo(t.elementMl, item.bonus?.elementMl);
    stackResist(t.resist, item.bonus?.resist);
    t.lifeLeech += item.bonus?.lifeLeech ?? 0;
    addImbues(t, p.imbues);
  }
  addImbues(t, g.weapon?.imbues);

  // Life leech: weapon + armor imbuements (each half of the default when not set).
  const half = K.LIFE_LEECH_IMBUE[vocation] / 2;
  const armor = g.pieces.armor;
  const lifeLeech = t.lifeLeech + (g.weapon ? leechOf(g.weapon.imbues) : half) + (armor ? leechOf(armor.imbues) : half);

  const w = g.weapon;
  const pick = (id: string) => w?.imbues.find((c) => c.id === id);
  const strike = pick('strike');
  const voidImbue = pick('void');
  const weaponImbues = w
    ? {
        critChance: strike ? imbueValue(strike) : 0,
        critExtra: strike ? (getImbuement('strike')?.extra?.[strike.level - 1] ?? 0) : 0,
        lifeLeech: leechOf(w.imbues),
        manaLeech: voidImbue ? imbueValue(voidImbue) : 0,
      }
    : undefined;
  const damage = w?.imbues.map((c) => ({ c, d: getImbuement(c.id) })).find((x) => x.d?.group === 'damage');

  const mainSkill = MAIN_SKILL[vocation];
  const main = vocation === 'knight'
    ? meleeSkill
      ? (t.skills[meleeSkill] ?? 0)
      : Math.max(t.skills.sword ?? 0, t.skills.axe ?? 0, t.skills.club ?? 0)
    : mainSkill ? (t.skills[mainSkill] ?? 0) : 0;

  const offhandItem = g.pieces.offhand && getItem(g.pieces.offhand.itemId);
  const offhand = offhandItem
    ? { kind: offhandItem.slot as 'shield' | 'spellbook' | 'quiver', defense: offhandItem.defense ?? 0 }
    : undefined;

  const amp = 1 + tierChance('amplification', g.pieces.boots?.tier ?? 0) / 100;
  const augments = GEAR_SLOTS.flatMap((s) => (g.pieces[s] ? itemAugments(g.pieces[s]!.itemId) : []));
  const mantra = GEAR_SLOTS.reduce((a, s) => a + (g.pieces[s] ? itemMantra(g.pieces[s]!.itemId) : 0), 0);
  return {
    ...(mantra ? { mantra } : {}),
    ...(augments.length ? { augments } : {}),
    skills: { main, magic: t.skills.magic ?? 0, shielding: t.skills.shielding ?? 0 },
    elementMl: t.elementMl,
    resist: t.resist,
    ...(offhand ? { offhand } : {}),
    // D94: the character's own crit plus the Strike imbuement.
    ...(weaponImbues ? { crit: { chance: INTRINSIC_CRIT.chance + weaponImbues.critChance, extra: INTRINSIC_CRIT.extra + weaponImbues.critExtra }, weaponImbues } : {}),
    lifeLeech,
    ...(damage?.d?.element ? { conversion: { element: damage.d.element, pct: imbueValue(damage.c) } } : {}),
    onslaught: tierChance('onslaught', w?.tier ?? 0) * amp,
    ruse: tierChance('ruse', armor?.tier ?? 0) * amp,
  };
}
