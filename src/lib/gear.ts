/**
 * D74: the user's owned equipment — storage and editing helpers. No React here.
 *
 * Several items per slot; the engine wears the best set for the spot (`OptimizerResult.gear`). Until the user sets
 * anything, no equipment is sent and the engine keeps its previous assumptions (typical gear, Powerful Strike,
 * Vampirism on weapon and armor).
 */
import type { GearImbue, GearInput, GearPiece, GearSlot, OwnedCharm, Vocation, WeaponGear } from '../types';
import { CHARM_IDS } from '../data/charms';
import {
  GEAR_SLOTS,
  getItem,
  imbuementsFor,
  imbueLevelFor,
  maxTier,
  MAX_TIER,
  SLOT_ITEMS,
  usableBy,
  WEAPON_IMBUE_SLOTS,
  type EquipmentItem,
  type ImbueSlot,
} from '../data/equipment';

export type { GearPiece, WeaponGear };
export type ImbueChoice = GearImbue;

export interface GearPrefs {
  pieces: Partial<Record<GearSlot, GearPiece[]>>;
  weapon: WeaponGear | null;
  /** D93: unlocked offensive charms. */
  charms: OwnedCharm[];
}

/** Owned items kept per slot. */
export const MAX_PIECES = 20;

export const EMPTY_GEAR: GearPrefs = { pieces: {}, weapon: null, charms: [] };

/** D93: known charms, unique, stage 1..3. */
export function sanitizeCharms(raw: unknown): OwnedCharm[] {
  const out: OwnedCharm[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const id = r?.id;
    const stage = int(r?.stage, 1, 3) as OwnedCharm['stage'] | null;
    if (CHARM_IDS.includes(id) && stage && !out.some((x) => x.id === id)) out.push({ id, stage });
  }
  return out;
}

export const gearStorageKey = (vocation: Vocation): string => `wheel-optimizer:gear:v1:${vocation}`;

export const isGearSet = (g: GearPrefs): boolean => g.weapon !== null || GEAR_SLOTS.some((s) => g.pieces[s]?.length);

/** Engine input (undefined when nothing is set). */
export const gearInput = (g: GearPrefs): GearInput | undefined => (isGearSet(g) ? { pieces: g.pieces, weapon: g.weapon } : undefined);

const int = (x: unknown, min: number, max: number): number | null =>
  typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max ? x : null;

export function sanitizeImbues(raw: unknown, slot: ImbueSlot, vocation: Vocation, max: number, item?: EquipmentItem, options?: readonly { id: string }[]): GearImbue[] {
  const allowed = new Map((options ?? imbuementsFor(slot, vocation, item)).map((x) => [x.id, x as { levels?: readonly GearImbue['level'][] }]));
  const out: GearImbue[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const id = typeof r?.id === 'string' ? r.id : '';
    const level = int(r?.level, 1, 3) as GearImbue['level'] | null;
    const def = allowed.get(id);
    // One imbuement of each kind per item, as in the game.
    if (out.length < max && def && level && !out.some((x) => x.id === id)) out.push({ id, level: imbueLevelFor(def, level) });
  }
  return out;
}

function sanitizePiece(raw: unknown, slot: GearSlot, vocation: Vocation): GearPiece | null {
  const r = raw as Partial<GearPiece> | null;
  const item = typeof r?.itemId === 'string' ? getItem(r.itemId) : undefined;
  if (!item || !SLOT_ITEMS[slot].includes(item.slot) || !usableBy(item, vocation)) return null;
  const tier = int(r?.tier, 0, maxTier(item.class)) ?? 0;
  const imbues = sanitizeImbues(r?.imbues, slot, vocation, item.imbuementSlots ?? 0, item);
  return { itemId: item.id, ...(tier ? { tier } : {}), ...(imbues.length ? { imbues } : {}) };
}

export function sanitizeGear(raw: unknown, vocation: Vocation): GearPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { pieces?: Record<string, unknown>; weapon?: Partial<WeaponGear> | null; charms?: unknown };
  const pieces: GearPrefs['pieces'] = {};
  for (const s of GEAR_SLOTS) {
    const v = r.pieces?.[s];
    // One item per slot before the owned lists.
    const list = (Array.isArray(v) ? v : v ? [v] : []).map((x) => sanitizePiece(x, s, vocation)).filter((x): x is GearPiece => !!x);
    if (list.length) pieces[s] = list.slice(0, MAX_PIECES);
  }
  const w = r.weapon;
  const weapon = w && typeof w === 'object'
    ? { tier: int(w.tier, 0, MAX_TIER) ?? 0, imbues: sanitizeImbues(w.imbues, 'weapon', vocation, WEAPON_IMBUE_SLOTS) }
    : null;
  return { pieces, weapon, charms: sanitizeCharms(r.charms) };
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

function withList(g: GearPrefs, slot: GearSlot, list: GearPiece[]): GearPrefs {
  const pieces = { ...g.pieces };
  if (list.length) pieces[slot] = list;
  else delete pieces[slot];
  return { ...g, pieces };
}

export const addPiece = (g: GearPrefs, slot: GearSlot, item: EquipmentItem): GearPrefs =>
  withList(g, slot, [...(g.pieces[slot] ?? []), { itemId: item.id }].slice(0, MAX_PIECES));

export const removePiece = (g: GearPrefs, slot: GearSlot, index: number): GearPrefs =>
  withList(g, slot, (g.pieces[slot] ?? []).filter((_, i) => i !== index));

export const updatePiece = (g: GearPrefs, slot: GearSlot, index: number, patch: Partial<Omit<GearPiece, 'itemId'>>): GearPrefs =>
  withList(g, slot, (g.pieces[slot] ?? []).map((p, i) => (i === index ? { ...p, ...patch } : p)));
