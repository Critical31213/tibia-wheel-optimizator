/** Hunting-spot helpers (several monsters with weights). Pure. */
import { ATTACK_ELEMENTS } from '../types';
import type { Element, Monster, WeightedMonster } from '../types';
import type { MonsterEntry } from './inputState';

/** Resolves stored entries into engine input, skipping ids not (yet) in the dataset. */
export function resolveMonsters(
  entries: readonly MonsterEntry[],
  lookup: (id: string) => Monster | undefined,
): WeightedMonster[] {
  const out: WeightedMonster[] = [];
  for (const e of entries) {
    const monster = lookup(e.id);
    if (monster) out.push({ monster, weight: e.weight });
  }
  return out;
}

/** Weighted average of the % damage taken per attack element (missing = 100), rounded. */
export function combinedModifiers(list: readonly WeightedMonster[]): Record<Element, number> {
  const valid = list.filter((m) => m.weight > 0);
  const total = valid.reduce((s, m) => s + m.weight, 0);
  const out = {} as Record<Element, number>;
  for (const el of ATTACK_ELEMENTS) {
    out[el] = total
      ? Math.round(valid.reduce((s, m) => s + m.weight * (m.monster.elementModifiers[el] ?? 100), 0) / total)
      : 100;
  }
  return out;
}

/** Union of damage types dealt, ordered by combined weight (desc). */
export function combinedDamageTypes(list: readonly WeightedMonster[]): Element[] {
  const score = new Map<Element, number>();
  for (const { monster, weight } of list)
    for (const el of new Set(monster.damageTypes)) score.set(el, (score.get(el) ?? 0) + weight);
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([el]) => el);
}
