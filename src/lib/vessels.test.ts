import { describe, expect, it } from 'vitest';
import type { GemRecommendation, VesselAssignment } from '../types';
import { emptyUnlockedByQuality, groupConvictions, recommendationsByQuality } from './vessels';

const vessel = (quality: VesselAssignment['quality'], unlocked: boolean, source: VesselAssignment['source']): VesselAssignment => ({
  vesselId: 0,
  quality,
  unlocked,
  gem: null,
  source,
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

describe('groupConvictions', () => {
  it('counts duplicates and drops tier I of an augment taken at tier II', () => {
    const n = (name: string) => ({ name });
    const out = groupConvictions(['Aug X I', 'Gem Vessel', 'Aug Y I', 'Gem Vessel', 'Aug X II', 'Gem Vessel'].map(n));
    expect(out.map((g) => [g.perk.name, g.count])).toEqual([['Gem Vessel', 3], ['Aug Y I', 1], ['Aug X II', 1]]);
  });
});
