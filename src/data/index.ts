/**
 * Data module public API (STUB — to be replaced by the Data & Scraper Specialist).
 * The signatures below are the contract the UI relies on. Keep them stable.
 */
import type { Monster } from '../types';

export const MONSTERS: Monster[] = [];

/** Case- and diacritic-insensitive search, best matches first. */
export function searchMonsters(query: string, limit = 10): Monster[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return MONSTERS.filter((m) => m.name.toLowerCase().includes(q)).slice(0, limit);
}

export function getMonsterById(id: string): Monster | undefined {
  return MONSTERS.find((m) => m.id === id);
}
