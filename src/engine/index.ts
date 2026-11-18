/**
 * Engine public API (STUB — to be replaced by the Algorithm & Logic Engineer).
 * The signatures below are the contract the UI relies on. Keep them stable.
 */
import type { OptimizerInput, OptimizerResult, Vocation, WheelDefinition } from '../types';

export function getWheel(vocation: Vocation): WheelDefinition {
  return { vocation, slices: [], revelations: [], totalCapacity: 0 };
}

export function optimize(input: OptimizerInput): OptimizerResult {
  return {
    allocation: {},
    path: [],
    pointsUsed: 0,
    pointsTotal: input.points,
    domainPoints: { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 },
    revelations: [],
    convictions: [],
    stats: [],
    offenseScore: 0,
    defenseScore: 0,
    rationale: ['Engine not implemented yet.'],
  };
}

/** Max promotion points obtainable at a given character level. */
export function pointsForLevel(level: number): number {
  return Math.max(0, level - 50);
}
