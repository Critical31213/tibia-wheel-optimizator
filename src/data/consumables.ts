/**
 * D136: skill-boosting food and potions (TibiaWiki, checked 2026-11-27). One food and one potion at a time; a potion
 * replaces a food buff of the same skill (and the other way round), so when both boost one skill only the stronger
 * item counts. Delicatessen Salad boosts "all melee skills", taken as fist too (Veggie Casserole lists fist).
 */
import type { MeleeSkill, Vocation } from '../types';
import type { ItemSkill } from './equipment/types';

export interface ConsumableDef {
  id: string;
  name: string;
  kind: 'food' | 'potion';
  skills: Partial<Record<ItemSkill, number>>;
  /** Vocations that can use it (undefined = all). */
  vocations?: readonly Vocation[];
}

const MELEE = (v: number) => ({ sword: v, axe: v, club: v, fist: v });

export const CONSUMABLES: readonly ConsumableDef[] = [
  { id: 'tropical-fried-terrorbird', name: 'Tropical Fried Terrorbird', kind: 'food', skills: { magic: 5 } },
  { id: 'tropical-marinated-tiger', name: 'Tropical Marinated Tiger', kind: 'food', skills: { magic: 3 } },
  { id: 'veggie-casserole', name: 'Veggie Casserole', kind: 'food', skills: MELEE(10) },
  { id: 'delicatessen-salad', name: 'Delicatessen Salad', kind: 'food', skills: MELEE(3) },
  { id: 'carrot-cake', name: 'Carrot Cake', kind: 'food', skills: { distance: 10 } },
  { id: 'lemon-cupcake', name: 'Lemon Cupcake', kind: 'food', skills: { distance: 10 } },
  { id: 'carrot-pie', name: 'Carrot Pie', kind: 'food', skills: { distance: 7 } },
  { id: 'roasted-dragon-wings', name: 'Roasted Dragon Wings', kind: 'food', skills: { shielding: 10 } },
  { id: 'roasted-wyvern-wings', name: 'Roasted Wyvern Wings', kind: 'food', skills: { shielding: 7 } },
  { id: 'bullseye-potion', name: 'Bullseye Potion', kind: 'potion', skills: { distance: 5, shielding: -10 } },
  { id: 'berserk-potion', name: 'Berserk Potion', kind: 'potion', skills: { sword: 5, axe: 5, club: 5, shielding: -10 }, vocations: ['knight'] },
  { id: 'mastermind-potion', name: 'Mastermind Potion', kind: 'potion', skills: { magic: 3 }, vocations: ['sorcerer', 'druid'] },
  { id: 'transcendence-potion', name: 'Transcendence Potion', kind: 'potion', skills: { fist: 4 }, vocations: ['monk'] },
];

export const getConsumable = (id: string) => CONSUMABLES.find((c) => c.id === id);

const MAIN: Record<Vocation, readonly ItemSkill[]> = {
  knight: ['sword', 'axe', 'club'],
  paladin: ['distance'],
  monk: ['fist'],
  sorcerer: [],
  druid: [],
};

/** Boosts a vocation uses: its main skill, magic level, shielding. */
export const consumablesFor = (vocation: Vocation): ConsumableDef[] =>
  CONSUMABLES.filter(
    (c) => (!c.vocations || c.vocations.includes(vocation)) && Object.entries(c.skills).some(([s, v]) => v > 0 && (s === 'magic' || s === 'shielding' || MAIN[vocation].includes(s as ItemSkill))),
  );

export interface ConsumableBonus {
  main: number;
  magic: number;
  shielding: number;
}

/** Skill changes of the chosen food and potion (knights: the trained melee skill, else the best one). */
export function consumableBonus(ids: readonly string[] | undefined, vocation: Vocation, meleeSkill?: MeleeSkill | null): ConsumableBonus {
  const items = (ids ?? []).map(getConsumable).filter((c): c is ConsumableDef => !!c && (!c.vocations || c.vocations.includes(vocation)));
  const food = items.find((c) => c.kind === 'food');
  const potion = items.find((c) => c.kind === 'potion');
  let used = [food, potion].filter((c): c is ConsumableDef => !!c);
  if (food && potion) {
    const clash = (Object.keys(potion.skills) as ItemSkill[]).find((s) => (potion.skills[s] ?? 0) > 0 && (food.skills[s] ?? 0) > 0);
    if (clash) used = [(potion.skills[clash] ?? 0) > (food.skills[clash] ?? 0) ? potion : food];
  }
  const sum = (s: ItemSkill) => used.reduce((a, c) => a + (c.skills[s] ?? 0), 0);
  const mains = vocation === 'knight' && meleeSkill ? [meleeSkill] : MAIN[vocation];
  return { main: mains.length ? Math.max(...mains.map(sum)) : 0, magic: sum('magic'), shielding: sum('shielding') };
}
