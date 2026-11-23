/**
 * Thin UI-facing facade over the engine and data modules.
 * Components import from here, never from `../engine` / `../data` directly.
 *
 * The monster dataset (~950 kB JSON) is code-split: `loadMonsterData()` pulls
 * `src/data` in a separate chunk. Until it resolves, `searchMonsters` returns
 * [] and `getMonsterById` returns undefined; `useMonsterData()` re-renders
 * subscribers once the data is ready.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { Monster, OptimizerResult, Vocation } from '../types';
import type { HuntingSpot } from '../data/spots';
import { getWheelData, getWheelSpellNames } from '../data/wheel';
import { getCustomRotationSpells } from '../data/damage/rotations';
export { wheelVariants } from '../data/wheel';
import { stanceCombos } from '../data/damage/stances';
import { STANCE_SEP } from './spellPrefs';

/** One build (main or alternative) as shown by the wheel / summary / vessels. */
export type BuildResult = Omit<OptimizerResult, 'alternatives'>;

export { getWheel, MAX_EXTRA_POINTS, optimize, pointsForLevel, revelationOptions } from '../engine';

/** D35: revelation perk names of the vocation (domain order). */
export function getRevelationNames(vocation: Vocation): string[] {
  return getWheelData(vocation).revelations.map((r) => r.name);
}
export { getCustomRotationSpells, getRotationPresets } from '../data/damage/rotations';

/** D32: selectable stance sets of the vocation, as keys ('' = none, names joined by STANCE_SEP). */
export function getStanceOptions(vocation: Vocation): string[] {
  return stanceCombos(vocation).map((c) => c.map((s) => s.name).join(STANCE_SEP));
}

/** D92: spells the player can exclude: wheel spells (augments, revelations) and rotation spells, sorted. */
export function getExcludableSpells(vocation: Vocation): string[] {
  return [...new Set([...getWheelSpellNames(vocation), ...getCustomRotationSpells(vocation)])].sort((a, b) => a.localeCompare(b));
}

/** Spells whose augment can be forced (D21): augment slices + supreme-mod spells of the vocation, sorted. */
export function getForceableSpells(vocation: Vocation): string[] {
  const w = getWheelData(vocation);
  const names = new Set<string>();
  // Wheel (conviction) augments only; gem-only spell mods cannot be forced on the wheel.
  for (const t of w.tiles) for (const s of t.conviction.augment?.spells ?? []) names.add(s);
  return [...names].sort((a, b) => a.localeCompare(b));
}

type DataModule = typeof import('../data');

let data: DataModule | null = null;
let pending: Promise<DataModule> | null = null;
const listeners = new Set<() => void>();

export function loadMonsterData(): Promise<DataModule> {
  pending ??= import('../data').then(
    (mod) => {
      data = mod;
      listeners.forEach((l) => l());
      return mod;
    },
    (err: unknown) => {
      pending = null;
      throw err;
    },
  );
  return pending;
}

export const isMonsterDataLoaded = (): boolean => data !== null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True once the monster dataset is loaded; triggers the load on first use. */
export function useMonsterData(): boolean {
  useEffect(() => {
    if (!data) loadMonsterData().catch(() => undefined);
  }, []);
  return useSyncExternalStore(subscribe, isMonsterDataLoaded, () => false);
}

export function searchMonsters(query: string, limit = 10): Monster[] {
  return data ? data.searchMonsters(query, limit) : [];
}

export function getMonsterById(id: string): Monster | undefined {
  return data?.getMonsterById(id);
}

export type { HuntingSpot };

/** D99: hunting spots with the monster (empty until the data chunk is loaded). */
export function getSpotsWithMonster(id: string): readonly HuntingSpot[] {
  return data ? data.spotsWithMonster(id) : [];
}

/** True when the spot's weights come from kill statistics (not all 1). */
export const spotHasKillWeights = (s: HuntingSpot): boolean => s.monsters.some((m) => m.weight !== 1);

// D47: weapon proficiency (weapon data is small and bundled).
export { getAmmo, getShapingOption, getWeapon, iconKeys, perkIcon, searchWeapons, shapingId, shapingOptions } from '../data/proficiency';
export type { Perk as WeaponPerk, PerkIcon, ShapingOption, Weapon } from '../data/proficiency';
export { levelOptions } from '../engine/proficiency';
