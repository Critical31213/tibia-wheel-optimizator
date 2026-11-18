import { describe, expect, it } from 'vitest';
import { VOCATIONS, type Monster, type OptimizerResult, type Vocation, type WheelDefinition } from '../types';
import { getWheel, optimize, pointsForLevel } from './index';

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const monster = (over: Partial<Monster>): Monster => ({
  id: 'test',
  name: 'Test Monster',
  elementModifiers: {},
  damageTypes: ['physical'],
  ...over,
});

/** Replays the path and checks unlock rule, capacities and partial-only-last. */
function assertValidPath(wheel: WheelDefinition, r: OptimizerResult) {
  const byId = new Map(wheel.slices.map((s) => [s.id, s]));
  const filled = new Map<string, number>();
  const isFull = (id: string) => (filled.get(id) ?? 0) >= byId.get(id)!.capacity;
  r.path.forEach((id, k) => {
    const s = byId.get(id)!;
    expect(s).toBeDefined();
    const unlocked = s.ring === 1 || s.adjacent.some(isFull);
    expect(unlocked, `${id} not unlocked at step ${k}`).toBe(true);
    const pts = r.allocation[id];
    expect(pts).toBeGreaterThan(0);
    expect(pts).toBeLessThanOrEqual(s.capacity);
    if (k < r.path.length - 1) expect(pts, `${id} must be full`).toBe(s.capacity);
    filled.set(id, pts);
  });
  expect(new Set(r.path).size).toBe(r.path.length);
  expect(Object.keys(r.allocation).sort()).toEqual([...r.path].sort());
  const sum = Object.values(r.allocation).reduce((a, b) => a + b, 0);
  expect(sum).toBe(r.pointsUsed);
}

describe('pointsForLevel', () => {
  it('gives 1 point per level above 50, plus capped scroll points', () => {
    expect(pointsForLevel(1)).toBe(0);
    expect(pointsForLevel(50)).toBe(0);
    expect(pointsForLevel(51)).toBe(1);
    expect(pointsForLevel(1000)).toBe(950);
    expect(pointsForLevel(1000, 50)).toBe(1000);
    expect(pointsForLevel(1000, 999)).toBe(1000);
    expect(pointsForLevel(40, 50)).toBe(0);
  });
});

describe('optimize', () => {
  it('produces valid paths and never exceeds points (random inputs)', () => {
    const rand = rng(42);
    for (let k = 0; k < 60; k++) {
      const vocation = VOCATIONS[Math.floor(rand() * VOCATIONS.length)];
      const points = Math.floor(rand() * 4300);
      const priority = Math.floor(rand() * 101);
      const m =
        rand() < 0.5
          ? monster({
              elementModifiers: { fire: Math.floor(rand() * 150), ice: Math.floor(rand() * 150), holy: Math.floor(rand() * 150) },
              damageTypes: rand() < 0.5 ? ['physical', 'fire'] : ['death'],
              maxDamage: Math.floor(rand() * 3000),
            })
          : null;
      const r = optimize({ vocation, points, priority, monster: m });
      const wheel = getWheel(vocation);
      assertValidPath(wheel, r);
      expect(r.pointsUsed).toBeLessThanOrEqual(points);
      expect(r.pointsUsed).toBe(Math.min(points, wheel.totalCapacity));
      expect(r.pointsTotal).toBe(points);
      expect(r.offenseScore).toBeGreaterThanOrEqual(0);
      expect(r.offenseScore).toBeLessThanOrEqual(100);
      expect(r.defenseScore).toBeGreaterThanOrEqual(0);
      expect(r.defenseScore).toBeLessThanOrEqual(100);
      expect(r.rationale.length).toBeGreaterThanOrEqual(2);
      expect(r.rationale.length).toBeLessThanOrEqual(5);
      const dp = Object.values(r.domainPoints).reduce((a, b) => a + b, 0);
      expect(dp).toBe(r.pointsUsed);
      r.revelations.forEach((rev) => {
        const expected = rev.perk.thresholds.filter((t) => rev.domainPoints >= t).length;
        expect(rev.stage).toBe(expected);
      });
    }
  });

  it('handles 0 / negative / NaN points', () => {
    for (const points of [0, -5, Number.NaN]) {
      const r = optimize({ vocation: 'knight', points, priority: 50, monster: null });
      expect(r.pointsUsed).toBe(0);
      expect(r.path).toEqual([]);
      expect(r.rationale.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('fills the whole wheel when points exceed capacity', () => {
    const r = optimize({ vocation: 'druid', points: 5000, priority: 50, monster: null });
    expect(r.pointsUsed).toBe(4000);
    expect(r.revelations.every((x) => x.stage === 3)).toBe(true);
    expect(r.convictions).toHaveLength(36);
  });

  it('is deterministic', () => {
    const input = { vocation: 'paladin' as Vocation, points: 777, priority: 33, monster: null };
    expect(optimize(input)).toEqual(optimize(input));
  });

  it.each(VOCATIONS)('priority 0 vs 100 shifts offense/defense (%s)', (vocation) => {
    for (const points of [400, 900, 1600]) {
      const dps = optimize({ vocation, points, priority: 0, monster: null });
      const tank = optimize({ vocation, points, priority: 100, monster: null });
      expect(dps.offenseScore).toBeGreaterThan(tank.offenseScore);
      expect(tank.defenseScore).toBeGreaterThan(dps.defenseScore);
    }
  });

  it('monster weakness changes the build (sorcerer fire vs energy)', () => {
    const fireWeak = monster({ name: 'Ice Beast', elementModifiers: { fire: 150, energy: 0 } });
    const energyWeak = monster({ name: 'Water Beast', elementModifiers: { fire: 0, energy: 150 } });
    const a = optimize({ vocation: 'sorcerer', points: 700, priority: 0, monster: fireWeak });
    const b = optimize({ vocation: 'sorcerer', points: 700, priority: 0, monster: energyWeak });
    expect(a.allocation).not.toEqual(b.allocation);
    const names = (r: OptimizerResult) => r.convictions.map((c) => c.name).join('|');
    expect(names(a)).toMatch(/Great Fire Wave/);
    expect(names(a)).not.toMatch(/Energy Wave/);
    expect(names(b)).toMatch(/Energy Wave/);
    expect(names(b)).not.toMatch(/Great Fire Wave/);
    expect(a.rationale.join(' ')).toMatch(/Ice Beast/);
  });

  it('monster weakness changes the build (druid ice vs earth)', () => {
    const iceWeak = monster({ name: 'Fire Thing', elementModifiers: { ice: 150, earth: 0 } });
    const earthWeak = monster({ name: 'Energy Thing', elementModifiers: { ice: 0, earth: 150 } });
    const a = optimize({ vocation: 'druid', points: 700, priority: 0, monster: iceWeak });
    const b = optimize({ vocation: 'druid', points: 700, priority: 0, monster: earthWeak });
    expect(a.allocation).not.toEqual(b.allocation);
  });

  it('stays within the 50 ms budget', () => {
    for (const vocation of VOCATIONS) {
      for (const points of [100, 1000, 2500, 3999]) {
        const t = performance.now();
        optimize({ vocation, points, priority: 50, monster: monster({ elementModifiers: { fire: 120 } }) });
        expect(performance.now() - t).toBeLessThan(50);
      }
    }
  });
});
