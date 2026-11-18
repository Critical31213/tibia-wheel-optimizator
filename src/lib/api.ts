/**
 * Thin UI-facing facade over the engine and data modules.
 *
 * Components import from here, never from `../engine` / `../data` directly,
 * so the temporary fixture fallback lives in exactly one place.
 *
 * TO REMOVE THE FALLBACK: delete `./fixtures.ts`, delete every branch marked
 * `FIXTURE FALLBACK` below and re-export the real functions directly.
 */
import { getMonsterById as realGetMonsterById, MONSTERS, searchMonsters as realSearchMonsters } from '../data';
import { getWheel as realGetWheel, optimize as realOptimize, pointsForLevel } from '../engine';
import type { Monster, OptimizerInput, OptimizerResult, Vocation, WheelDefinition } from '../types';
import { FIXTURE_MONSTERS, fixtureOptimize, fixtureWheel } from './fixtures';

export { pointsForLevel };

// FIXTURE FALLBACK — true while the corresponding real module is still a stub.
export const usingFixtureMonsters = MONSTERS.length === 0;

function realWheelAvailable(vocation: Vocation): boolean {
  return realGetWheel(vocation).slices.length > 0;
}

export function isDemoWheel(vocation: Vocation): boolean {
  return !realWheelAvailable(vocation); // FIXTURE FALLBACK
}

export function getWheel(vocation: Vocation): WheelDefinition {
  const wheel = realGetWheel(vocation);
  return wheel.slices.length > 0 ? wheel : fixtureWheel(vocation); // FIXTURE FALLBACK
}

export function optimize(input: OptimizerInput): OptimizerResult {
  if (!realWheelAvailable(input.vocation)) return fixtureOptimize(input); // FIXTURE FALLBACK
  return realOptimize(input);
}

export function searchMonsters(query: string, limit = 10): Monster[] {
  if (usingFixtureMonsters) {
    // FIXTURE FALLBACK
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return FIXTURE_MONSTERS.filter((m) => m.name.toLowerCase().includes(q)).slice(0, limit);
  }
  return realSearchMonsters(query, limit);
}

export function getMonsterById(id: string): Monster | undefined {
  if (usingFixtureMonsters) return FIXTURE_MONSTERS.find((m) => m.id === id); // FIXTURE FALLBACK
  return realGetMonsterById(id);
}
