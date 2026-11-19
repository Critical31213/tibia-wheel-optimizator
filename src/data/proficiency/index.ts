/**
 * D45: weapon proficiency data — weapons with their stats and proficiency trees, plus dust shaping options.
 * Generated offline by `npm run import:proficiency` (scripts/import-proficiency.mjs).
 */
import type { Vocation } from '../../types';
import data from './proficiency.json';
import type { Perk, ShapingOption, Weapon } from './types';

export type * from './types';
export * from './ammo';

export const WEAPONS: readonly Weapon[] = data.weapons;
export const SHAPING_OPTIONS: readonly ShapingOption[] = data.shaping;
/** Weapons in the stats source without a known proficiency tree (not selectable yet). */
export const WEAPONS_WITHOUT_TREE: readonly string[] = data.meta.withoutTree;

const BY_ID = new Map(WEAPONS.map((w) => [w.id, w]));

export const getWeapon = (id: string): Weapon | undefined => BY_ID.get(id);

/** Weapons a vocation can wield, optionally only those usable at `level`. */
export function weaponsFor(vocation: Vocation, level = Infinity): Weapon[] {
  return WEAPONS.filter((w) => w.vocations.includes(vocation) && w.minLevel <= level);
}

/** Shaping options available to a vocation (general + vocation specific). */
export function shapingOptions(vocation: Vocation): ShapingOption[] {
  return SHAPING_OPTIONS.filter((o) => o.group === 'all' || o.group === vocation);
}

/** Stable id of a shaping option, e.g. "augment:Groundshaker:baseDamage", "bestiary:Dragon", "alphaStrike". */
export const shapingId = (o: ShapingOption): string => [o.kind, o.spell ?? o.bestiary, o.augment].filter(Boolean).join(':');

const SHAPING_BY_ID = new Map(SHAPING_OPTIONS.map((o) => [shapingId(o), o]));
export const getShapingOption = (id: string): ShapingOption | undefined => SHAPING_BY_ID.get(id);

/** D45: reshaped slots are assumed at rank 10. */
export const SHAPED_RANK = 10;

/** A shaping option as a perk at the given rank. */
export function shapedPerk(o: ShapingOption, rank = SHAPED_RANK): Perk {
  const { group: _group, rank0: _r0, rank10: _r10, ...rest } = o;
  return { ...rest, value: shapingValue(o, rank) };
}

/** Value of a shaping option at rank 0..10 (linear between the known rank 0 and rank 10 values). */
export const shapingValue = (o: ShapingOption, rank: number): number =>
  o.rank0 + ((o.rank10 - o.rank0) * Math.max(0, Math.min(10, rank))) / 10;

/** One icon image; sprite sheets are horizontal strips of `frames` equal frames. */
export interface PerkIcon {
  file: string;
  frame: number;
  frames: number;
}

/** Icon keys of a perk: [base] or, for spell augments, [spell, augment overlay] (mirrors the import script). */
export const iconKeys = (p: Omit<Perk, 'value'>): string[] =>
  p.kind === 'augment' ? [`spell:${p.spell}`, `aug:${p.augment}`] : [[p.kind, p.skill, p.element, p.bestiary].filter(Boolean).join(':')];

function icon(key: string): PerkIcon | null {
  const ref = data.icons[key];
  if (!ref) return null;
  const [file, sprite] = ref.split('#');
  const [frame, frames] = sprite ? sprite.split('/').map(Number) : [0, 1];
  return { file, frame, frames };
}

/** Official perk icon (CipSoft graphics): base and, for spell augments, the augment overlay. */
export const perkIcon = (p: Omit<Perk, 'value'>): { base: PerkIcon | null; overlay: PerkIcon | null } => {
  const [base, overlay] = iconKeys(p);
  return { base: icon(base), overlay: overlay ? icon(overlay) : null };
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Case-insensitive weapon search for a vocation: prefix matches first, then substring; ties by level. */
export function searchWeapons(query: string, vocation: Vocation, limit = 10): Weapon[] {
  const q = norm(query);
  if (!q) return [];
  return weaponsFor(vocation)
    .map((w) => ({ w, n: norm(w.name) }))
    .filter(({ n }) => n.includes(q))
    .sort((a, b) => Number(!a.n.startsWith(q)) - Number(!b.n.startsWith(q)) || b.w.minLevel - a.w.minLevel)
    .slice(0, limit)
    .map(({ w }) => w);
}
