import { describe, expect, it } from 'vitest';
import { type OptimizerResult, type OwnedGem, VOCATIONS } from '../types';
import { decodePlannerCode } from '../data/wheel/plannerCode';
import { optimize } from './index';
import { bestGems, type GemEnv, gemParts, placeGems, toOwnedGem } from './gems';
import { blendWith, valuationFor, vesselTable, weightsFor } from './optimizer';
import { flatParts } from './values';
import { getEngineWheel, vesselSpots } from './wheel/build';

const HUNT = { mode: 'hunt' } as const;
const BOSS = { mode: 'boss' } as const;

function env(vocation: (typeof VOCATIONS)[number], points = 1500): GemEnv {
  return {
    v: valuationFor({ vocation, points, monster: null }),
    wheel: getEngineWheel(vocation),
    facts: { stages: [2, 2, 2, 2], revPoints: [1e9, 1e9, 1e9, 1e9], wheelEffects: new Map() },
    blend: blendWith(weightsFor(50)),
  };
}

const allResults = (r: OptimizerResult) => [r, ...(r.alternatives ?? []).map((a) => a.result)];

describe('D23: vessels hold only owned gems', () => {
  it('no vessel is ever filled with a recommended gem (main build and alternatives)', () => {
    for (const vocation of VOCATIONS) {
      const owned = toOwnedGem('mine', bestGems(env(vocation), 'lesser', 3)[0], 3);
      for (const points of [300, 1500, 3200])
        for (const gems of [[], [owned]] as OwnedGem[][])
          for (const context of [HUNT, BOSS]) {
            const r = optimize({ vocation, points, monster: null, priority: 50, context, gems });
            for (const res of allResults(r)) {
              for (const v of res.vessels) {
                expect(['owned', 'empty']).toContain(v.source);
                if (v.source === 'empty') expect(v.gem).toBeNull();
                if (v.gem) expect(gems.map((g) => g.id)).toContain(v.gem.id);
              }
              // Planner code carries only owned gems.
              const pv = decodePlannerCode(res.plannerCode!).vessels;
              expect(pv.length).toBe(res.vessels.filter((v) => v.source === 'owned' && v.gem!.quality === v.quality).length);
            }
          }
    }
  });

  it('recommendations are still produced without owned gems', () => {
    for (const points of [0, 300, 2000]) {
      const r = optimize({ vocation: 'sorcerer', points, monster: null, priority: 50, context: HUNT });
      expect(new Set(r.gemRecommendations.map((g) => g.quality))).toEqual(new Set(['lesser', 'regular', 'greater']));
      expect(r.upgradeRecommendations).toEqual([]);
    }
  });

  it('without owned gems a vessel slice is worth only its own flat bonus', () => {
    for (const vocation of VOCATIONS) {
      const e = env(vocation);
      const flat = flatParts(e.v, 1);
      // D88: totals per state; each unlocked vessel adds only its slice's flat bonus.
      vesselTable(e, []).forEach((p, k) => {
        expect(p.off).toBeCloseTo(flat.off * k, 9);
        expect(p.def).toBeCloseTo(flat.def * k, 9);
      });
    }
  });

  it('owned gems are valued by the vessel that lets the optimal placement use them', () => {
    const e = env('knight');
    const gems = (['greater', 'regular', 'lesser'] as const).map((q, i) => toOwnedGem(`g${i}`, bestGems(e, q, 4)[0], 4));
    const table = vesselTable(e, gems);
    const flat = flatParts(e.v, 1);
    const vessels = e.wheel.definition.vessels;
    let prev = 0;
    vessels.forEach((_, k) => {
      const placed = placeGems(e, gems, vesselSpots(e.wheel, k + 1));
      const total = placed.reduce((s, g, i) => s + (g ? e.blend(gemParts(e, g, vessels[i].quality)) : 0), 0);
      // D88: the table holds totals per vessel state (here: unlocked vessel count).
      expect(e.blend(table[k + 1]) - e.blend(table[k]) - e.blend(flat)).toBeCloseTo(total - prev, 9);
      prev = total;
    });
    expect(prev).toBeGreaterThan(0);
    // Once every owned gem is placed, further vessels add only the flat bonus.
    const last = vessels.length;
    expect(e.blend(table[last]) - e.blend(table[last - 1])).toBeCloseTo(e.blend(flat), 9);
  });

  it('owned gems are placed in the optimized build and change its value', () => {
    const e = env('sorcerer', 1000);
    const gems = Array.from({ length: 4 }, (_, i) => toOwnedGem(`hp${i}`, bestGems(e, 'regular', 4)[0], 4));
    const input = { vocation: 'sorcerer' as const, points: 1000, monster: null, priority: 50, context: HUNT, alternatives: 0 };
    const plain = optimize(input);
    const withGems = optimize({ ...input, gems });
    const owned = withGems.vessels.filter((v) => v.source === 'owned');
    expect(owned.length).toBeGreaterThan(0);
    expect(owned.length).toBe(Math.min(gems.length, withGems.vessels.filter((v) => v.unlocked && v.quality === 'regular').length));
    expect(owned.every((v) => v.gem!.quality === v.quality)).toBe(true);
    expect(withGems.vessels.filter((v) => v.unlocked).length).toBeGreaterThanOrEqual(plain.vessels.filter((v) => v.unlocked).length);
    expect(withGems.stats.some((s) => s.labelMsg?.key === 'stat.gemMod')).toBe(true);
    expect(plain.stats.some((s) => s.labelMsg?.key === 'stat.gemMod')).toBe(false);
  });

  it('focus alternatives with the same top revelation get distinct labels (paladin 1200 hunt)', () => {
    const r = optimize({ vocation: 'paladin', points: 1200, monster: null, priority: 40, context: HUNT, alternatives: 2 });
    expect(new Set(r.alternatives!.map((a) => a.label)).size).toBe(r.alternatives!.length);
  });
});
