/** Pure helpers grouping build results by gem quality / domain. */
import type { GemQuality, GemRecommendation, VesselAssignment } from '../types';

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

/** D58: conviction perks for display: duplicates counted, an augment's tier I dropped when tier II is taken. */
export function groupConvictions<T extends { name: string }>(perks: readonly T[]): { perk: T; count: number }[] {
  const names = new Set(perks.map((p) => p.name));
  const out: { perk: T; count: number }[] = [];
  for (const p of perks) {
    if (p.name.endsWith(' I') && names.has(`${p.name}I`)) continue;
    const g = out.find((x) => x.perk.name === p.name);
    if (g) g.count++;
    else out.push({ perk: p, count: 1 });
  }
  return out;
}
