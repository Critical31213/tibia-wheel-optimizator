import { describe, expect, it } from 'vitest';
import type { ActivatedRevelation, Domain, GemRecommendation, VesselAssignment } from '../types';
import { activeRevelationsByDomain, emptyUnlockedByQuality, recommendationsByQuality } from './vessels';

const vessel = (quality: VesselAssignment['quality'], unlocked: boolean, source: VesselAssignment['source']): VesselAssignment => ({
  vesselId: 0,
  quality,
  unlocked,
  gem: null,
  source,
});

const rev = (id: number, domain: Domain, stage: number): ActivatedRevelation => ({
  perk: { id: `r${id}`, name: `R${id}`, description: '', category: 'offense', domain, thresholds: [250, 500, 1000] },
  stage,
  domainPoints: 100 * stage,
});

describe('emptyUnlockedByQuality', () => {
  it('counts unlocked vessels without an owned gem per quality', () => {
    expect(
      emptyUnlockedByQuality([
        vessel('regular', true, 'empty'),
        vessel('regular', true, 'recommended'),
        vessel('regular', true, 'owned'),
        vessel('greater', false, 'empty'),
        vessel('lesser', true, 'empty'),
      ]),
    ).toEqual({ lesser: 1, regular: 2, greater: 0 });
  });
  it('is all zero for no vessels', () => {
    expect(emptyUnlockedByQuality([])).toEqual({ lesser: 0, regular: 0, greater: 0 });
  });
});

describe('recommendationsByQuality', () => {
  it('groups by quality keeping order', () => {
    const r = (quality: GemRecommendation['quality'], gain: number): GemRecommendation => ({ quality, mods: [], gain, reason: '' });
    const g = recommendationsByQuality([r('greater', 3), r('lesser', 2), r('greater', 1)]);
    expect(g.greater.map((x) => x.gain)).toEqual([3, 1]);
    expect(g.lesser).toHaveLength(1);
    expect(g.regular).toEqual([]);
  });
});

describe('activeRevelationsByDomain', () => {
  it('keeps only active revelations, highest stage per domain', () => {
    const out = activeRevelationsByDomain([rev(1, 'topLeft', 0), rev(2, 'topRight', 1), rev(3, 'topRight', 2), rev(4, 'bottomLeft', 3)]);
    expect(out.topLeft).toBeUndefined();
    expect(out.topRight?.perk.name).toBe('R3');
    expect(out.bottomLeft?.stage).toBe(3);
    expect(out.bottomRight).toBeUndefined();
  });
});
