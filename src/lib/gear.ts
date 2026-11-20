/**
 * D74: the user's equipment — storage, editing helpers and the effects passed to the engine. No React here.
 *
 * Until the user sets anything, no effects are sent and the engine keeps its previous assumptions (typical gear,
 * Powerful Strike, Vampirism on weapon and armor). How empty slots count once something is set depends on the
 * fallback mode (D74 variants: `slot` keeps the assumption per empty slot, `all` drops every assumption).
 */
import type { Element, GearEffects, MeleeSkill, Vocation } from '../types';
import {
  GEAR_SLOTS,
  getImbuement,
  getItem,
  imbuementsFor,
  maxTier,
  MAX_TIER,
  SLOT_ITEMS,
  tierChance,
  usableBy,
  WEAPON_IMBUE_SLOTS,
  type EquipmentItem,
  type GearSlot,
  type ImbueLevel,
  type ImbueSlot,
  type ItemSkill,
} from '../data/equipment';
import { K } from '../engine/values';

export interface ImbueChoice {
  id: string;
  level: ImbueLevel;
}

export interface GearPiece {
  itemId: string;
  /** Forge tier (0 = none). */
  tier?: number;
  imbues?: ImbueChoice[];
}

/** Imbuements and tier of the weapon the engine picks; null = not set (default assumption). */
export interface WeaponGear {
  tier: number;
  imbues: ImbueChoice[];
}

export interface GearPrefs {
  pieces: Partial<Record<GearSlot, GearPiece>>;
  weapon: WeaponGear | null;
}

export type GearFallback = 'slot' | 'all';

export const EMPTY_GEAR: GearPrefs = { pieces: {}, weapon: null };

export const gearStorageKey = (vocation: Vocation): string => `wheel-optimizer:gear:v1:${vocation}`;

export const isGearSet = (g: GearPrefs): boolean => g.weapon !== null || GEAR_SLOTS.some((s) => g.pieces[s]);

const int = (x: unknown, min: number, max: number): number | null =>
  typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max ? x : null;

function sanitizeImbues(raw: unknown, slot: ImbueSlot, vocation: Vocation, max: number): ImbueChoice[] {
  const allowed = new Set(imbuementsFor(slot, vocation).map((x) => x.id));
  const out: ImbueChoice[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const id = typeof r?.id === 'string' ? r.id : '';
    const level = int(r?.level, 1, 3) as ImbueLevel | null;
    // One imbuement of each kind per item, as in the game.
    if (out.length < max && allowed.has(id) && level && !out.some((x) => x.id === id)) out.push({ id, level });
  }
  return out;
}

function sanitizePiece(raw: unknown, slot: GearSlot, vocation: Vocation): GearPiece | null {
  const r = raw as Partial<GearPiece> | null;
  const item = typeof r?.itemId === 'string' ? getItem(r.itemId) : undefined;
  if (!item || !SLOT_ITEMS[slot].includes(item.slot) || !usableBy(item, vocation)) return null;
  const tier = int(r?.tier, 0, maxTier(item.class)) ?? 0;
  const imbues = sanitizeImbues(r?.imbues, slot, vocation, item.imbuementSlots ?? 0);
  return { itemId: item.id, ...(tier ? { tier } : {}), ...(imbues.length ? { imbues } : {}) };
}

export function sanitizeGear(raw: unknown, vocation: Vocation): GearPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<GearPrefs>;
  const pieces: GearPrefs['pieces'] = {};
  for (const s of GEAR_SLOTS) {
    const p = sanitizePiece(r.pieces?.[s], s, vocation);
    if (p) pieces[s] = p;
  }
  const w = r.weapon;
  const weapon = w && typeof w === 'object'
    ? { tier: int(w.tier, 0, MAX_TIER) ?? 0, imbues: sanitizeImbues(w.imbues, 'weapon', vocation, WEAPON_IMBUE_SLOTS) }
    : null;
  return { pieces, weapon };
}

export function parseGear(json: string | null, vocation: Vocation): GearPrefs {
  if (!json) return EMPTY_GEAR;
  try {
    return sanitizeGear(JSON.parse(json), vocation);
  } catch {
    return EMPTY_GEAR;
  }
}

// ---------------------------------------------------------------------------
// Editing

export function setPiece(g: GearPrefs, slot: GearSlot, item: EquipmentItem | null): GearPrefs {
  const pieces = { ...g.pieces };
  if (item) pieces[slot] = { itemId: item.id };
  else delete pieces[slot];
  return { ...g, pieces };
}

export function updatePiece(g: GearPrefs, slot: GearSlot, patch: Partial<Omit<GearPiece, 'itemId'>>): GearPrefs {
  const p = g.pieces[slot];
  return p ? { ...g, pieces: { ...g.pieces, [slot]: { ...p, ...patch } } } : g;
}

// ---------------------------------------------------------------------------
// Effects

const imbueValue = (c: ImbueChoice) => getImbuement(c.id)?.values[c.level - 1] ?? 0;

const MAIN_SKILL: Record<Vocation, ItemSkill | null> = { knight: null, paladin: 'distance', monk: 'fist', sorcerer: null, druid: null };

interface Totals {
  skills: Partial<Record<ItemSkill, number>>;
  elementMl: Partial<Record<Element, number>>;
  resist: Partial<Record<Element, number>>;
  lifeLeech: number;
}

function addTo<K extends string>(to: Partial<Record<K, number>>, from: Partial<Record<K, number>> | undefined) {
  for (const [k, v] of Object.entries(from ?? {}) as [K, number][]) to[k] = (to[k] ?? 0) + v;
}

function addImbues(t: Totals, imbues: readonly ImbueChoice[] | undefined) {
  for (const c of imbues ?? []) {
    const d = getImbuement(c.id);
    if (!d) continue;
    const v = imbueValue(c);
    if (d.group === 'skill' && d.skill) t.skills[d.skill] = (t.skills[d.skill] ?? 0) + v;
    else if (d.group === 'protection' && d.element) t.resist[d.element] = (t.resist[d.element] ?? 0) + v;
  }
}

const leechOf = (imbues: readonly ImbueChoice[] | undefined) => (imbues ?? []).reduce((a, c) => a + (c.id === 'vampirism' ? imbueValue(c) : 0), 0);

/**
 * Engine effects of the equipment; undefined when nothing is set (previous assumptions).
 * Knights: the trained melee skill (else the item's best melee bonus).
 */
export function gearEffects(g: GearPrefs, vocation: Vocation, meleeSkill: MeleeSkill | null, fallback: GearFallback): GearEffects | undefined {
  if (!isGearSet(g)) return undefined;
  const keep = fallback === 'slot';
  const t: Totals = { skills: {}, elementMl: {}, resist: {}, lifeLeech: 0 };
  for (const s of GEAR_SLOTS) {
    const p = g.pieces[s];
    const item = p && getItem(p.itemId);
    if (!p || !item) continue;
    addTo(t.skills, item.bonus?.skills);
    addTo(t.elementMl, item.bonus?.elementMl);
    addTo(t.resist, item.bonus?.resist);
    t.lifeLeech += item.bonus?.lifeLeech ?? 0;
    addImbues(t, p.imbues);
  }
  addImbues(t, g.weapon?.imbues);

  // Life leech: weapon + armor imbuements (each half of the default when not set and kept).
  const half = K.LIFE_LEECH_IMBUE[vocation] / 2;
  const armor = g.pieces.armor;
  const lifeLeech = t.lifeLeech + (g.weapon ? leechOf(g.weapon.imbues) : keep ? half : 0) + (armor ? leechOf(armor.imbues) : keep ? half : 0);

  const w = g.weapon;
  const pick = (id: string) => w?.imbues.find((c) => c.id === id);
  const strike = pick('strike');
  const weaponImbues = w
    ? {
        critChance: strike ? imbueValue(strike) : 0,
        critExtra: strike ? (getImbuement('strike')!.extra![strike.level - 1]) : 0,
        lifeLeech: leechOf(w.imbues),
        manaLeech: pick('void') ? imbueValue(pick('void')!) : 0,
      }
    : keep
      ? undefined
      : { critChance: 0, critExtra: 0, lifeLeech: 0, manaLeech: 0 };
  const damage = w?.imbues.map((c) => ({ c, d: getImbuement(c.id)! })).find((x) => x.d?.group === 'damage');

  const main = vocation === 'knight'
    ? meleeSkill
      ? (t.skills[meleeSkill] ?? 0)
      : Math.max(t.skills.sword ?? 0, t.skills.axe ?? 0, t.skills.club ?? 0)
    : MAIN_SKILL[vocation] ? (t.skills[MAIN_SKILL[vocation]!] ?? 0) : 0;

  const offhandPiece = g.pieces.offhand;
  const offhandItem = offhandPiece && getItem(offhandPiece.itemId);
  const offhand = offhandItem
    ? { kind: offhandItem.slot as 'shield' | 'spellbook' | 'quiver', defense: offhandItem.defense ?? 0 }
    : keep
      ? undefined
      : { kind: 'none' as const, defense: 0 };

  const amp = 1 + tierChance('amplification', g.pieces.boots?.tier ?? 0) / 100;
  return {
    skills: { main, magic: t.skills.magic ?? 0, shielding: t.skills.shielding ?? 0 },
    elementMl: t.elementMl,
    resist: t.resist,
    ...(offhand ? { offhand } : {}),
    ...(weaponImbues ? { crit: { chance: weaponImbues.critChance, extra: weaponImbues.critExtra }, weaponImbues } : {}),
    lifeLeech,
    ...(damage ? { conversion: { element: damage.d.element!, pct: imbueValue(damage.c) } } : {}),
    onslaught: tierChance('onslaught', w?.tier ?? 0) * amp,
    ruse: tierChance('ruse', armor?.tier ?? 0) * amp,
  };
}
