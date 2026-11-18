import { describe, expect, it } from 'vitest';
import { VOCATIONS, type Domain } from '../types';
import { getWheel } from './index';

/** Prerequisite lists from canary PlayerWheel::canPlayerSelectPointOnSlot (green quadrant + cross links). */
const CANARY_PREREQS: Record<string, string[]> = {
  'green-200': ['green-top-150', 'green-bottom-150'],
  'green-top-150': ['green-top-100', 'green-middle-100', 'green-bottom-150'],
  'green-bottom-150': ['green-middle-100', 'green-bottom-100', 'green-top-150'],
  'green-top-100': ['red-top-100', 'green-top-75', 'green-middle-100'],
  'green-middle-100': ['green-top-100', 'green-top-75', 'green-bottom-75', 'green-bottom-100'],
  'green-bottom-100': ['green-middle-100', 'green-bottom-75', 'blue-top-100', 'green-bottom-150'],
  'green-top-75': ['green-50', 'red-top-75', 'green-bottom-75', 'green-middle-100', 'green-top-100'],
  'green-bottom-75': ['green-50', 'blue-top-75', 'green-middle-100', 'green-bottom-100', 'green-top-75'],
  'red-bottom-75': ['red-50', 'purple-top-75', 'red-bottom-100', 'red-middle-100', 'red-top-75'],
  'purple-bottom-100': ['purple-bottom-75', 'blue-bottom-100', 'purple-middle-100', 'purple-bottom-150'],
};

function quadrant(angleDeg: number): Domain {
  if (angleDeg < 90) return 'topRight';
  if (angleDeg < 180) return 'bottomRight';
  if (angleDeg < 270) return 'bottomLeft';
  return 'topLeft';
}

describe.each(VOCATIONS)('wheel geometry: %s', (vocation) => {
  const wheel = getWheel(vocation);
  const byId = new Map(wheel.slices.map((s) => [s.id, s]));

  it('has 36 slices, 9 per domain, 1000 points per domain, 4000 total', () => {
    expect(wheel.slices).toHaveLength(36);
    expect(new Set(wheel.slices.map((s) => s.id)).size).toBe(36);
    for (const d of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as Domain[]) {
      const ds = wheel.slices.filter((s) => s.domain === d);
      expect(ds).toHaveLength(9);
      expect(ds.reduce((a, s) => a + s.capacity, 0)).toBe(1000);
    }
    expect(wheel.totalCapacity).toBe(4000);
  });

  it('has rings 4/8/12/8/4 with capacities 50/75/100/150/200 and unique indices', () => {
    const sizes = [4, 8, 12, 8, 4];
    const caps = [50, 75, 100, 150, 200];
    sizes.forEach((size, r) => {
      const ring = wheel.slices.filter((s) => s.ring === r + 1);
      expect(ring).toHaveLength(size);
      ring.forEach((s) => {
        expect(s.slicesInRing).toBe(size);
        expect(s.capacity).toBe(caps[r]);
      });
      expect(ring.map((s) => s.indexInRing).sort((a, b) => a - b)).toEqual([...Array(size).keys()]);
    });
  });

  it('domain matches slice angle (clockwise from 12 o\'clock)', () => {
    for (const s of wheel.slices) {
      const mid = ((s.indexInRing + 0.5) * 360) / s.slicesInRing;
      expect(quadrant(mid)).toBe(s.domain);
    }
  });

  it('adjacency is symmetric, irreflexive and connects only neighbouring rings', () => {
    for (const s of wheel.slices) {
      expect(s.adjacent).not.toContain(s.id);
      for (const a of s.adjacent) {
        const o = byId.get(a)!;
        expect(o).toBeDefined();
        expect(o.adjacent).toContain(s.id);
        expect(Math.abs(o.ring - s.ring)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('every slice is reachable from the inner ring', () => {
    const seen = new Set(wheel.slices.filter((s) => s.ring === 1).map((s) => s.id));
    const queue = [...seen];
    while (queue.length) {
      for (const a of byId.get(queue.pop()!)!.adjacent) {
        if (!seen.has(a)) {
          seen.add(a);
          queue.push(a);
        }
      }
    }
    expect(seen.size).toBe(36);
  });

  it('matches canary unlock prerequisites (adjacency = symmetric closure)', () => {
    for (const [id, prereqs] of Object.entries(CANARY_PREREQS)) {
      const adj = byId.get(id)!.adjacent;
      for (const p of prereqs) expect(adj).toContain(p);
      for (const a of adj) {
        if (!prereqs.includes(a)) expect(byId.get(a)!.ring, `${id}→${a}`).toBe(byId.get(id)!.ring + 1);
      }
    }
  });

  it('has 4 revelations (one per domain) with thresholds 250/500/1000 and a conviction on every slice', () => {
    expect(wheel.revelations).toHaveLength(4);
    expect(new Set(wheel.revelations.map((r) => r.domain)).size).toBe(4);
    wheel.revelations.forEach((r) => expect(r.thresholds).toEqual([250, 500, 1000]));
    wheel.slices.forEach((s) => {
      expect(s.conviction.name.length).toBeGreaterThan(0);
      expect(['offense', 'defense', 'utility']).toContain(s.conviction.category);
      expect(s.dedicationLabel).toMatch(/per point/);
    });
  });
});
