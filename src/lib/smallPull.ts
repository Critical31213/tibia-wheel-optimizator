import type { BuildResult } from './api';
import type { Vocation } from '../types';
import { getTargetSpells } from './api';

/** D135: share of the usual targets per area spell assumed for a smaller pull. */
export const SMALL_PULL_SHARE = 0.6;

/** Targets per area spell for a smaller pull: the player's own value (else the community average) × SMALL_PULL_SHARE. */
export function smallPullTargets(vocation: Vocation, own: Readonly<Record<string, number>> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of getTargetSpells(vocation)) out[s.name] = Math.max(1, Math.round((own?.[s.name] ?? s.avg) * SMALL_PULL_SHARE * 10) / 10);
  return out;
}

/** Least damage gain (%) of the small-pull build in that pull for it to be shown. */
export const SMALL_PULL_MIN_DMG = 1;

/** The small-pull build is shown when the main build is noticeably worse in a smaller pull (verdict close / worse, damage gain ≥ SMALL_PULL_MIN_DMG). */
export function smallPullWins(small: BuildResult | null): boolean {
  const c = small?.comparison;
  return !!c && (c.verdict === 'close' || c.verdict === 'worse') && c.effect.dmg >= SMALL_PULL_MIN_DMG;
}
