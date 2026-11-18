import { describe, expect, it } from 'vitest';
import {
  annularSectorPath,
  fillRadius,
  polarToCartesian,
  ringBounds,
  sectorCentroid,
  sliceAngles,
} from './geometry';

describe('polarToCartesian', () => {
  it('measures angles clockwise from 12 o’clock', () => {
    expect(polarToCartesian(100, 100, 50, 0)).toEqual({ x: 100, y: 50 });
    expect(polarToCartesian(100, 100, 50, 90)).toEqual({ x: 150, y: 100 });
    expect(polarToCartesian(100, 100, 50, 180)).toEqual({ x: 100, y: 150 });
    expect(polarToCartesian(100, 100, 50, 270)).toEqual({ x: 50, y: 100 });
  });
});

describe('sliceAngles', () => {
  it('splits a ring evenly', () => {
    expect(sliceAngles(0, 4)).toEqual([0, 90]);
    expect(sliceAngles(3, 12)).toEqual([90, 120]);
  });
});

describe('ringBounds', () => {
  it('lays rings out evenly between hub and outer radius', () => {
    expect(ringBounds(1, 4, 40, 200)).toEqual({ inner: 40, outer: 80 });
    expect(ringBounds(4, 4, 40, 200)).toEqual({ inner: 160, outer: 200 });
  });
});

describe('fillRadius', () => {
  it('returns bounds at 0 and 1 and clamps', () => {
    expect(fillRadius(40, 80, 0)).toBe(40);
    expect(fillRadius(40, 80, 1)).toBe(80);
    expect(fillRadius(40, 80, 2)).toBe(80);
    expect(fillRadius(40, 80, -1)).toBe(40);
  });
  it('is area-proportional', () => {
    const r = fillRadius(40, 80, 0.5);
    const half = (80 * 80 - 40 * 40) / 2;
    expect(r * r - 40 * 40).toBeCloseTo(half, 6);
    expect(r).toBeGreaterThan(60); // more than the radial midpoint
  });
});

describe('annularSectorPath', () => {
  it('builds a closed path with two arcs', () => {
    const d = annularSectorPath(100, 100, 50, 100, 0, 90);
    expect(d.startsWith('M 100 0')).toBe(true);
    expect(d).toContain('A 100 100 0 0 1 200 100');
    expect(d).toContain('L 150 100');
    expect(d).toContain('A 50 50 0 0 0 100 50');
    expect(d.endsWith('Z')).toBe(true);
  });
  it('uses the large-arc flag beyond 180°', () => {
    expect(annularSectorPath(0, 0, 10, 20, 0, 270)).toContain('A 20 20 0 1 1');
  });
  it('never produces a degenerate full-circle arc', () => {
    const d = annularSectorPath(0, 0, 10, 20, 0, 360);
    expect(d).not.toContain('NaN');
    // Arc end must differ from its start (0, -20), otherwise SVG draws nothing.
    expect(d).not.toContain('A 20 20 0 1 1 0 -20');
    expect(d).toContain('A 20 20 0 1 1');
  });
});

describe('sectorCentroid', () => {
  it('sits at mid radius and mid angle', () => {
    expect(sectorCentroid(0, 0, 10, 30, 0, 180)).toEqual({ x: 20, y: 0 });
  });
});
