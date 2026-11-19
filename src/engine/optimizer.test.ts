import { describe, expect, it } from 'vitest';
import { type FightContext, type OptimizerInput, VOCATIONS } from '../types';
import { getWheelData } from '../data/wheel';
import { optimize } from './index';
import { DOMAIN_ORDER, getEngineWheel, RM_SLICE_POINTS, stageFor } from './wheel/build';

const CONTEXTS: FightContext[] = [
  { mode: 'hunt' },
  { mode: 'boss' },
];

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInputs(n: number): OptimizerInput[] {
  const r = rng(42);
  return Array.from({ length: n }, () => ({
    vocation: VOCATIONS[Math.floor(r() * VOCATIONS.length)],
    points: Math.floor(r() * 4300),
    priority: Math.floor(r() * 101),
    monster: null,
    context: CONTEXTS[Math.floor(r() * CONTEXTS.length)],
  }));
}

describe('unlock path validity', () => {
  it.each(randomInputs(60).map((x, i) => [i, x] as const))('random input #%i', (_, input) => {
    const res = optimize(input);
    const w = getEngineWheel(input.vocation);
    const byId = new Map(w.slices.map((s) => [s.slice.id, s]));
    const budget = Math.min(4000, input.points);

    expect(res.pointsUsed).toBe(Object.values(res.allocation).reduce((a, b) => a + b, 0));
    expect(res.pointsUsed).toBeLessThanOrEqual(budget);
    expect(res.pointsUsed).toBe(budget);
    expect(new Set(res.path).size).toBe(res.path.length);
    expect([...res.path].sort()).toEqual(Object.keys(res.allocation).sort());

    const full = new Set<number>();
    res.path.forEach((id, k) => {
      const s = byId.get(id)!;
      const pts = res.allocation[id];
      expect(pts).toBeGreaterThan(0);
      expect(pts).toBeLessThanOrEqual(s.capacity);
      expect(s.initiallyUnlocked || s.unlockedBy.some((j) => full.has(j))).toBe(true);
      if (k < res.path.length - 1) expect(pts).toBe(s.capacity);
      if (pts === s.capacity) full.add(s.idx);
    });

    for (const [d, dom] of DOMAIN_ORDER.entries()) {
      const grid = w.slices.filter((s) => s.slice.domain === dom).reduce((a, s) => a + (res.allocation[s.slice.id] ?? 0), 0);
      expect(res.domainPoints[dom]).toBe(grid);
      const rmFull = w.slices.filter(
        (s) => s.kind === 'rm' && res.allocation[s.slice.id] === s.capacity && w.revelations[d].data.name === s.tile.conviction.name.replace('Revelation Mastery ', ''),
      ).length;
      expect(res.revelations[d].domainPoints).toBe(grid + RM_SLICE_POINTS * rmFull);
      expect(res.revelations[d].stage).toBe(stageFor(res.revelations[d].domainPoints));
    }
  });
});

describe('vessels and convictions', () => {
  it('unlocks vessels in order, one per filled Gem Vessel slice', () => {
    for (const input of randomInputs(40)) {
      const res = optimize(input);
      const w = getEngineWheel(input.vocation);
      const filled = w.vesselTiles.filter((i) => res.allocation[w.slices[i].slice.id] === w.slices[i].capacity).length;
      const flags = res.vessels.map((v) => v.unlocked);
      expect(flags).toEqual(flags.map((_, k) => k < filled));
      expect(res.vessels.map((v) => v.vesselId)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      for (const v of res.vessels) if (!v.unlocked) expect(v).toMatchObject({ gem: null, source: 'empty' });
    }
  });

  it('a full wheel has every augment at I and II and all vessels', () => {
    for (const vocation of VOCATIONS) {
      const res = optimize({ vocation, points: 4000, monster: null, priority: 50 });
      expect(res.pointsUsed).toBe(4000);
      expect(res.revelations.map((r) => r.stage)).toEqual([3, 3, 3, 3]);
      expect(res.vessels.every((v) => v.unlocked)).toBe(true);
      const names = res.convictions.map((c) => c.name);
      const augs = new Set(getEngineWheel(vocation).slices.filter((s) => s.kind === 'augment').map((s) => s.tile.conviction.name));
      for (const a of augs) {
        expect(names).toContain(`${a} I`);
        expect(names).toContain(`${a} II`);
      }
    }
  });

  it('stage II of an augment requires both twins to be full', () => {
    for (const input of randomInputs(40)) {
      const res = optimize(input);
      const w = getEngineWheel(input.vocation);
      const full = (i: number) => res.allocation[w.slices[i].slice.id] === w.slices[i].capacity;
      const names = res.convictions.map((c) => c.name);
      for (const s of w.slices.filter((x) => x.kind === 'augment' && x.idx < x.twin)) {
        const n = s.tile.conviction.name;
        const count = Number(full(s.idx)) + Number(full(s.twin));
        expect(names.includes(`${n} I`)).toBe(count >= 1);
        expect(names.includes(`${n} II`)).toBe(count === 2);
      }
    }
  });
});

describe('behaviour', () => {
  it('is deterministic', () => {
    for (const input of randomInputs(10)) expect(optimize(input)).toEqual(optimize(input));
  });

  it('handles edge budgets', () => {
    const zero = optimize({ vocation: 'knight', points: 0, monster: null, priority: 50 });
    expect(zero.pointsUsed).toBe(0);
    expect(zero.path).toEqual([]);
    const over = optimize({ vocation: 'knight', points: 9999, monster: null, priority: 50 });
    expect(over.pointsUsed).toBe(4000);
    expect(over.pointsTotal).toBe(9999);
    expect(optimize({ vocation: 'druid', points: Number.NaN, monster: null, priority: 50 }).pointsUsed).toBe(0);
  });

  it('priority moves the offense/defense balance', () => {
    for (const vocation of VOCATIONS) {
      const off = optimize({ vocation, points: 1200, monster: null, priority: 0 });
      const def = optimize({ vocation, points: 1200, monster: null, priority: 100 });
      expect(off.offenseScore).toBeGreaterThanOrEqual(def.offenseScore);
      expect(def.defenseScore).toBeGreaterThanOrEqual(off.defenseScore);
    }
  });

  it('fills rationale with translatable messages', () => {
    const res = optimize({ vocation: 'paladin', points: 900, monster: null, priority: 30, context: CONTEXTS[1] });
    expect(res.rationale.length).toBeGreaterThan(0);
    expect(res.rationaleMsgs).toHaveLength(res.rationale.length);
    expect(res.rationaleMsgs!.map((m) => m.key)).toContain('rationale.boss');
    for (const s of res.stats) expect(s.labelMsg?.key).toMatch(/^stat\./);
  });

  it('runs under 100 ms (warm, incl. RM gem re-optimization and D34 pair tries)', () => {
    const inputs = VOCATIONS.flatMap((vocation) =>
      [100, 1000, 2500, 4000].map((points) => ({ vocation, points, monster: null, priority: 50, context: CONTEXTS[0] })),
    );
    for (const i of inputs) optimize(i);
    let worst = 0;
    for (const i of inputs) {
      // best of 3: measures compute, not scheduler noise from parallel test workers
      let ms = Infinity;
      for (let k = 0; k < 3; k++) {
        const t = performance.now();
        optimize(i);
        ms = Math.min(ms, performance.now() - t);
      }
      worst = Math.max(worst, ms);
    }
    // Shared CI runners are several times slower than a desktop.
    // ~65 ms worst locally (2500 points, D34 pair tries); 100 keeps headroom for parallel workers.
    expect(worst).toBeLessThan(import.meta.env.CI ? 400 : 100);
  });

  it('roughly agrees with the planner reference builds', () => {
    for (const vocation of VOCATIONS) {
      for (const b of getWheelData(vocation).referenceBuilds.builds) {
        if (b.legacyCode || b.points > 4000) continue;
        const res = optimize({ vocation, points: b.points, monster: null, priority: 30 });
        const ours = res.revelations.reduce((a, r) => a + r.stage, 0);
        const ref = b.revelationStages.reduce((a, s) => a + s, 0);
        expect(res.pointsUsed).toBe(Math.min(4000, b.points));
        expect(ours).toBeGreaterThanOrEqual(ref - 1);
      }
    }
  });
});
