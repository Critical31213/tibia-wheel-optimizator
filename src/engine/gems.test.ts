import { describe, expect, it } from 'vitest';
import { type GemQuality, type OwnedGem, VOCATIONS } from '../types';
import { optimize } from './index';
import { activeSlots, assign, bestGems, type GemEnv, gemParts, placedResist, placeGems, toOwnedGem, upgrades, withGemResist } from './gems';
import { blendWith, valuationFor, weightsFor } from './optimizer';
import { getEngineWheel, vesselSpots } from './wheel/build';
import { cappedResist, mitigationGain, mitigationParts } from './values';

function env(vocation: (typeof VOCATIONS)[number] = 'knight', points = 2000): GemEnv {
  return {
    v: valuationFor({ vocation, points, monster: null }),
    wheel: getEngineWheel(vocation),
    facts: { stages: [3, 3, 3, 3], revPoints: [1000, 1000, 1000, 1000], wheelEffects: new Map() },
    blend: blendWith(weightsFor(50)),
  };
}

function permutations(n: number, k: number): number[][] {
  if (k === 0) return [[]];
  const out: number[][] = [];
  for (const rest of permutations(n, k - 1)) for (let j = -1; j < n; j++) if (j < 0 || !rest.includes(j)) out.push([...rest, j]);
  return out;
}

describe('assignment', () => {
  it('matches brute force on random matrices', () => {
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let t = 0; t < 40; t++) {
      const rows = 1 + Math.floor(r() * 4);
      const cols = 1 + Math.floor(r() * 4);
      const w = Array.from({ length: rows }, () => Array.from({ length: cols }, () => (r() < 0.2 ? 0 : r() * 10)));
      const total = (p: number[]) => p.reduce((s, c, i) => s + (c >= 0 ? w[i][c] : 0), 0);
      const best = Math.max(...permutations(cols, rows).map(total));
      const got = assign(w);
      expect(new Set(got.filter((c) => c >= 0)).size).toBe(got.filter((c) => c >= 0).length);
      expect(total(got)).toBeCloseTo(best, 9);
    }
  });
});

describe('gem placement', () => {
  it('D28: a gem fits only a vessel of its own quality', () => {
    expect(activeSlots('greater', 'lesser')).toEqual([]);
    expect(activeSlots('greater', 'regular')).toEqual([]);
    expect(activeSlots('lesser', 'greater')).toEqual([]);
    expect(activeSlots('regular', 'greater')).toEqual([]);
    expect(activeSlots('lesser', 'lesser')).toEqual(['basic1']);
    expect(activeSlots('regular', 'regular')).toEqual(['basic1', 'basic2']);
    expect(activeSlots('greater', 'greater')).toEqual(['basic1', 'basic2', 'supreme']);
  });

  it('puts the strong greater gem in a greater vessel', () => {
    const e = env();
    const vq = e.wheel.definition.vessels.map((v) => v.quality);
    const [g] = bestGems(e, 'greater', 4);
    const greater = toOwnedGem('g', g, 4);
    const lesser = toOwnedGem('l', bestGems(e, 'lesser', 1)[0], 1);
    const unlocked = vq.indexOf('greater') + 1;
    const placed = placeGems(e, [lesser, greater], vesselSpots(e.wheel, unlocked));
    expect(vq[placed.indexOf(greater)]).toBe('greater');
    expect(placed.filter(Boolean)).toHaveLength(2);
  });

  it('placement is never worse than any other assignment (brute force)', () => {
    for (const vocation of VOCATIONS) {
      const e = env(vocation);
      const qs: GemQuality[] = ['greater', 'regular', 'lesser', 'greater'];
      const gems: OwnedGem[] = qs.map((q, i) => {
        const opts = bestGems(e, q, 1 + i, 3);
        return toOwnedGem(`g${i}`, opts[i % opts.length], (1 + i) as 1);
      });
      const n = 5;
      const vs = e.wheel.definition.vessels.slice(0, n);
      const value = (p: (OwnedGem | null)[]) => p.reduce((s, g, i) => s + (g ? e.blend(gemParts(e, g, vs[i].quality)) : 0), 0);
      const placed = placeGems(e, gems, vesselSpots(e.wheel, n));
      const best = Math.max(...permutations(gems.length, n).map((p) => value(p.map((c) => (c >= 0 ? gems[c] : null)))));
      expect(value(placed)).toBeCloseTo(best, 9);
    }
  });

  it('owned gems are placed; other unlocked and locked vessels stay empty (D23)', () => {
    const e = env('sorcerer');
    const owned = toOwnedGem('mine', bestGems(e, 'regular', 2)[0], 2);
    const res = optimize({ vocation: 'sorcerer', points: 1500, monster: null, priority: 50, gems: [owned] });
    const open = res.vessels.filter((v) => v.unlocked);
    expect(open.length).toBeGreaterThan(1);
    expect(open.filter((v) => v.source === 'owned').map((v) => v.gem!.id)).toEqual(['mine']);
    for (const v of open.filter((x) => x.source !== 'owned')) {
      expect(v.source).toBe('empty');
      expect(v.gem).toBeNull();
    }
  });

  it('recommends gems per quality at grade I (new gems) with reasons', () => {
    for (const vocation of VOCATIONS) {
      const res = optimize({ vocation, points: 2000, monster: null, priority: 50 });
      const qs = new Set(res.gemRecommendations.map((g) => g.quality));
      expect(qs).toEqual(new Set(['lesser', 'regular', 'greater']));
      for (const g of res.gemRecommendations) {
        expect(g.mods.every((m) => m.grade === 1)).toBe(true);
        expect(g.reason.length).toBeGreaterThan(0);
        expect(g.reasonMsg?.key).toMatch(/^gem\./);
      }
      const gains = res.gemRecommendations.map((g) => g.gain);
      expect(gains).toEqual([...gains].sort((a, b) => b - a));
    }
  });
});

describe('upgrade recommendations', () => {
  it('are ranked, +1 grade, and only for active mods', () => {
    for (const vocation of VOCATIONS) {
      const e = env(vocation);
      const g = toOwnedGem('big', bestGems(e, 'greater', 1)[0], 1);
      const lesserVessel = e.wheel.definition.vessels.findIndex((v) => v.quality === 'lesser');
      const gv = e.wheel.definition.vessels.findIndex((v) => v.quality === 'greater');
      const vessel = (i: number, gem: OwnedGem) => ({ vesselId: i, quality: e.wheel.definition.vessels[i].quality, unlocked: true, gem, source: 'owned' as const });

      expect(upgrades(e, [vessel(lesserVessel, g)])).toEqual([]);

      const second = { ...toOwnedGem('two', bestGems(e, 'greater', 2, 2)[1], 2) };
      const gv2 = e.wheel.definition.vessels.findIndex((v, i) => i !== gv && v.quality === 'greater');
      const ups = upgrades(e, [vessel(gv, g), vessel(gv2, second)]);
      expect(ups.length).toBeGreaterThan(1);
      for (const u of ups) {
        expect(u.toGrade).toBe(u.fromGrade + 1);
        expect(u.gain).toBeGreaterThan(0);
        expect(u.gainToMax).toBeGreaterThanOrEqual(u.gain - 1e-9);
      }
      const gains = ups.map((u) => u.gain);
      expect(gains).toEqual([...gains].sort((a, b) => b - a));
    }
  });

  it('a supreme upgrade at max grade yields nothing; recommended gems are never upgraded', () => {
    const e = env('druid');
    const g4 = toOwnedGem('max', bestGems(e, 'greater', 4)[0], 4);
    expect(upgrades(e, [{ vesselId: 2, quality: 'greater', unlocked: true, gem: g4, source: 'owned' }])).toEqual([]);
    const g1 = toOwnedGem('rec', bestGems(e, 'greater', 1)[0], 1);
    expect(upgrades(e, [{ vesselId: 2, quality: 'greater', unlocked: true, gem: g1, source: 'recommended' }])).toEqual([]);
  });
});

describe('mitigation multiplier', () => {
  it('multiplies the vocation base mitigation instead of adding flat %', () => {
    const g = (vocation: (typeof VOCATIONS)[number]) => mitigationGain(env(vocation).v, 30);
    expect(mitigationGain({ mitigation: 20 }, 30)).toBeCloseTo(6);
    for (const vocation of VOCATIONS) expect(g(vocation)).toBeCloseTo((env(vocation).v.mitigation * 30) / 100);
    expect(g('paladin')).toBeLessThan(g('knight'));
    for (const vocation of VOCATIONS) expect(env(vocation).v.mitigation).toBeLessThan(30);
  });

  it('values grade IV below a flat 30 % damage reduction and scales with base mitigation', () => {
    const k = mitigationParts(env('knight').v, 30).def;
    const p = mitigationParts(env('paladin').v, 30).def;
    expect(k).toBeLessThan(10);
    expect(p).toBeLessThan(k);
  });

  it('does not dominate offensive mage builds', () => {
    const r = optimize({ vocation: 'sorcerer', points: 2000, monster: null, priority: 0 });
    const lesser = r.gemRecommendations.find((g) => g.quality === 'lesser');
    expect(lesser?.mods[0].name).not.toBe('Mitigation Multiplier');
  });
});

describe('D114: gem resistance cap', () => {
  it('counts gem resistance only up to 30 % per element (not drains)', () => {
    expect(cappedResist({ gemResist: { fire: 28 } }, 'fire', 4.5)).toBeCloseTo(2, 9);
    expect(cappedResist({ gemResist: { fire: 32 } }, 'fire', -2)).toBe(0);
    expect(cappedResist({}, 'fire', 3)).toBe(3);
    expect(cappedResist({ gemResist: { manaDrain: 40 } }, 'manaDrain', 3)).toBe(3);
  });

  it('a fire gem past the cap is worth nothing; placement prefers other gems', () => {
    const base = env('knight', 2000);
    const e: GemEnv = { ...base, v: { ...base.v, incoming: { fire: 1 } } };
    const gem = (id: string, quality: GemQuality, mod: number, second: number | null): OwnedGem => ({
      id,
      quality,
      basic1: { modId: mod, grade: 4 },
      basic2: quality === 'lesser' || second === null ? null : { modId: second, grade: 4 },
      supreme: null,
    });
    const fire = (id: string, q: GemQuality = 'regular') => gem(id, q, 3, 15); // 3 + 4.5 % fire
    expect(e.blend(gemParts(withGemResist(e, { fire: 30 }), fire('x'), 'regular'))).toBeLessThanOrEqual(0);
    expect(e.blend(gemParts(withGemResist(e, { fire: 27 }), fire('x'), 'regular'))).toBeLessThan(e.blend(gemParts(e, fire('x'), 'regular')));
    const spots = vesselSpots(e.wheel, e.wheel.definition.vessels.length);
    const gems = spots.flatMap((s, i) => [fire(`f${i}`, s.quality), gem(`h${i}`, s.quality, 31, null)]);
    // All fire gems would give well over 30 % fire.
    expect(placedResist(e, spots, gems.filter((g) => g.id.startsWith('f'))).fire ?? 0).toBeGreaterThan(30);
    const placed = placeGems(e, gems, spots);
    expect(placedResist(e, spots, placed).fire ?? 0).toBeLessThanOrEqual(30 + 7.5);
    expect(placed.some((g) => g?.id.startsWith('h'))).toBe(true);
  });
});
