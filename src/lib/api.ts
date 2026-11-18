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
import type { Monster, OptimizerResult } from '../types';

/** One build (main or alternative) as shown by the wheel / summary / vessels. */
export type BuildResult = Omit<OptimizerResult, 'alternatives'>;

export { getWheel, MAX_SCROLL_POINTS, optimize, pointsForLevel } from '../engine';

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
