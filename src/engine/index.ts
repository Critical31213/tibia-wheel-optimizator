/**
 * Engine public API. Signatures `getWheel`, `optimize`, `pointsForLevel` are
 * the contract the UI relies on. See docs/modules/engine.md.
 */
import type { OptimizerInput, OptimizerResult, Vocation, WheelDefinition } from '../types';
import { runOptimizer } from './optimizer';
export { revelationOptions } from './optimizer';
import { getEngineWheel } from './wheel/build';

/** Wheel definition for a vocation (cached; treat as read-only). */
export function getWheel(vocation: Vocation): WheelDefinition {
  return getEngineWheel(vocation).definition;
}

export function optimize(input: OptimizerInput): OptimizerResult {
  return runOptimizer(input);
}

/** Level from which promotion points are earned (1 per level above 50). */
export const MIN_LEVEL_FOR_POINTS = 50;
/** Max extra points from the 5 promotion scrolls (3 + 5 + 9 + 13 + 20). */
/** D54: extra points (promotion scrolls, weekly tasks, bounties, gem upgrades…); the total is still capped by the wheel. */
export const MAX_EXTRA_POINTS = 1000;

/**
 * Promotion points at a given level: max(0, level − 50), plus optional points
 * from promotion scrolls (0–50). Premium/promotion are assumed.
 */
export function pointsForLevel(level: number, scrollPoints = 0): number {
  const base = Math.max(0, Math.floor(Number.isFinite(level) ? level : 0) - MIN_LEVEL_FOR_POINTS);
  const scrolls = Math.max(0, Math.min(MAX_EXTRA_POINTS, Math.floor(scrollPoints)));
  return base > 0 ? base + scrolls : 0;
}

export { ENGINE_MESSAGES, renderMessage, type EngineMessageKey } from './messages';
export { DEFAULT_CONTEXT } from './spells';
export { getEngineWheel, isAvailable } from './wheel/build';
