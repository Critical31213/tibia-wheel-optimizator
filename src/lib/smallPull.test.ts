import { describe, expect, it } from 'vitest';
import { optimize } from '../engine';
import type { OptimizerInput } from '../types';
import { getTargetSpells } from './api';
import { SMALL_PULL_SHARE, smallPullTargets, smallPullWins } from './smallPull';

describe('D135 smaller pull', () => {
  it('scales the own targets (else the community average), at least 1', () => {
    const t = smallPullTargets('monk', { 'Spiritual Outburst': 8 });
    expect(t['Spiritual Outburst']).toBeCloseTo(8 * SMALL_PULL_SHARE, 1);
    for (const s of getTargetSpells('monk')) expect(t[s.name]).toBeGreaterThanOrEqual(1);
  });

  it('reports a build that is better in a smaller pull, valued against the main build', () => {
    const input = { vocation: 'druid', points: 900, monster: null, monsters: [], priority: 0, context: { mode: 'hunt' }, alternatives: 0 } as unknown as OptimizerInput;
    const main = optimize(input);
    const small = optimize({ ...input, spellTargets: smallPullTargets('druid', undefined), compareWith: main.allocation });
    expect(smallPullWins(small)).toBe(true);
    expect(small.comparison!.effect.dmg).toBeGreaterThan(1);
    const same = optimize({ ...input, compareWith: main.allocation });
    expect(smallPullWins(same)).toBe(false);
  });
});
