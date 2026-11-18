/** Pure helpers grouping build results by gem quality / domain. */
import type { ActivatedRevelation, Domain, GemQuality, GemRecommendation, VesselAssignment } from '../types';

/** Unlocked vessels without an owned gem, per vessel quality ('recommended' counts as empty). */
export function emptyUnlockedByQuality(vessels: readonly VesselAssignment[]): Record<GemQuality, number> {
  const out: Record<GemQuality, number> = { lesser: 0, regular: 0, greater: 0 };
  for (const v of vessels) if (v.unlocked && v.source !== 'owned') out[v.quality] += 1;
  return out;
}

/** Gem recommendations grouped by quality, order preserved. */
export function recommendationsByQuality(recs: readonly GemRecommendation[]): Record<GemQuality, GemRecommendation[]> {
  const out: Record<GemQuality, GemRecommendation[]> = { lesser: [], regular: [], greater: [] };
  for (const r of recs) out[r.quality].push(r);
  return out;
}

/** Highest-stage active (stage ≥ 1) revelation per domain. */
export function activeRevelationsByDomain(revelations: readonly ActivatedRevelation[]): Partial<Record<Domain, ActivatedRevelation>> {
  const out: Partial<Record<Domain, ActivatedRevelation>> = {};
  for (const r of revelations) {
    if (r.stage < 1) continue;
    const cur = out[r.perk.domain];
    if (!cur || r.stage > cur.stage) out[r.perk.domain] = r;
  }
  return out;
}
