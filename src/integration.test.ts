import { beforeAll, describe, expect, it } from 'vitest';
import {
  getMonsterById,
  getWheel,
  isMonsterDataLoaded,
  loadMonsterData,
  MAX_SCROLL_POINTS,
  optimize,
  pointsForLevel,
  searchMonsters,
} from './lib/api';
import { DEFAULT_INPUTS, fromQuery, MAX_POINTS, sanitize, toQuery, withKnownMonster } from './lib/inputState';
import { MONSTERS } from './data';
import { VOCATIONS, type Monster, type OptimizerResult, type WheelDefinition } from './types';

function assertValidResult(wheel: WheelDefinition, r: OptimizerResult, points: number) {
  const byId = new Map(wheel.slices.map((s) => [s.id, s]));
  const filled = new Map<string, number>();
  const isFull = (id: string) => (filled.get(id) ?? 0) >= byId.get(id)!.capacity;
  r.path.forEach((id, k) => {
    const s = byId.get(id);
    expect(s, `unknown slice ${id}`).toBeDefined();
    expect(s!.ring === 1 || s!.adjacent.some(isFull), `${id} locked at step ${k}`).toBe(true);
    const pts = r.allocation[id];
    expect(pts).toBeGreaterThan(0);
    expect(pts).toBeLessThanOrEqual(s!.capacity);
    if (k < r.path.length - 1) expect(pts).toBe(s!.capacity);
    filled.set(id, pts);
  });
  expect(new Set(r.path).size).toBe(r.path.length);
  const sum = Object.values(r.allocation).reduce((a, b) => a + b, 0);
  expect(sum).toBe(r.pointsUsed);
  expect(r.pointsUsed).toBe(Math.min(points, wheel.totalCapacity));
  const domainSum = Object.values(r.domainPoints).reduce((a, b) => a + b, 0);
  expect(domainSum).toBe(r.pointsUsed);
  for (const rev of r.revelations) {
    const reached = rev.perk.thresholds.filter((t) => rev.domainPoints >= t).length;
    expect(rev.stage).toBe(reached);
  }
  expect(r.offenseScore).toBeGreaterThanOrEqual(0);
  expect(r.offenseScore).toBeLessThanOrEqual(100);
  expect(r.defenseScore).toBeGreaterThanOrEqual(0);
  expect(r.defenseScore).toBeLessThanOrEqual(100);
  expect(r.rationale.length).toBeGreaterThan(0);
}

const monster = (id: string): Monster => {
  const m = getMonsterById(id);
  if (!m) throw new Error(`missing monster ${id}`);
  return m;
};

beforeAll(async () => {
  expect(isMonsterDataLoaded()).toBe(false);
  expect(searchMonsters('dragon')).toEqual([]);
  expect(getMonsterById('demon')).toBeUndefined();
  await loadMonsterData();
});

describe('integration: data + engine', () => {
  it('ships the real dataset and real wheels (no fixtures)', () => {
    expect(MONSTERS.length).toBeGreaterThan(1500);
    for (const v of VOCATIONS) {
      const w = getWheel(v);
      expect(w.slices).toHaveLength(36);
      expect(new Set(w.slices.map((s) => s.ring)).size).toBe(5);
      expect(w.totalCapacity).toBe(4000);
      expect(w.totalCapacity).toBe(MAX_POINTS);
      expect(w.revelations).toHaveLength(4);
    }
  });

  it.each(VOCATIONS.flatMap((v) => [100, 300, 600, 1000].map((lv) => [v, lv] as const)))(
    '%s at level %i produces a valid build within its points',
    (vocation, level) => {
      const points = pointsForLevel(level);
      const r = optimize({ vocation, points, monster: null, priority: 50 });
      assertValidResult(getWheel(vocation), r, points);
    },
  );

  it('level 1000 + all scrolls = 1000 points, enough for a stage-2+ revelation', () => {
    expect(pointsForLevel(1000, MAX_SCROLL_POINTS)).toBe(1000);
    const r = optimize({ vocation: 'druid', points: 1000, monster: null, priority: 50 });
    expect(r.revelations.some((x) => x.stage >= 2)).toBe(true);
  });

  it('sorcerer vs a monster weak to energy & death: priority shifts offense vs defense', () => {
    const fury = monster('fury');
    expect(fury.elementModifiers.energy).toBeGreaterThan(100);
    expect(fury.elementModifiers.death).toBeGreaterThan(100);
    const wheel = getWheel('sorcerer');
    const dps = optimize({ vocation: 'sorcerer', points: 600, monster: fury, priority: 0 });
    const tank = optimize({ vocation: 'sorcerer', points: 600, monster: fury, priority: 100 });
    assertValidResult(wheel, dps, 600);
    assertValidResult(wheel, tank, 600);
    expect(dps.offenseScore).toBeGreaterThan(tank.offenseScore);
    expect(tank.defenseScore).toBeGreaterThan(dps.defenseScore);
    expect(dps.rationale.join(' ')).toMatch(/Fury takes .*energy|Fury takes .*death/);
  });

  it('knight vs Demon builds a valid, defense-aware wheel', () => {
    const demon = monster('demon');
    const wheel = getWheel('knight');
    const r = optimize({ vocation: 'knight', points: 800, monster: demon, priority: 70 });
    assertValidResult(wheel, r, 800);
    expect(r.rationale.join(' ')).toContain('Demon');
    const generic = optimize({ vocation: 'knight', points: 800, monster: null, priority: 70 });
    expect(r.defenseScore).toBeGreaterThan(0);
    expect(generic.pointsUsed).toBe(800);
  });

  it('handles edge budgets: 0, partial, overflow, non-finite', () => {
    const w = getWheel('monk');
    for (const points of [0, 1, 49, 51, 3999, 4000]) {
      assertValidResult(w, optimize({ vocation: 'monk', points, monster: null, priority: 30 }), points);
    }
    const over = optimize({ vocation: 'monk', points: 9999, monster: null, priority: 30 });
    expect(over.pointsUsed).toBe(4000);
    expect(optimize({ vocation: 'monk', points: Number.NaN, monster: null, priority: 30 }).pointsUsed).toBe(0);
    const wild = optimize({ vocation: 'paladin', points: 500, monster: null, priority: 250 });
    assertValidResult(getWheel('paladin'), wild, 500);
  });

  it('is deterministic', () => {
    const input = { vocation: 'druid' as const, points: 777, monster: monster('dragon-lord'), priority: 40 };
    expect(optimize(input)).toEqual(optimize(input));
  });

  it('search returns real monsters that resolve by id', () => {
    const hits = searchMonsters('dragon', 5);
    expect(hits[0].name).toBe('Dragon');
    for (const h of hits) expect(getMonsterById(h.id)).toBe(h);
    expect(searchMonsters('', 5)).toEqual([]);
  });
});

describe('integration: input parsing', () => {
  const known = (id: string) => getMonsterById(id) !== undefined;

  it('drops invalid vocation and unknown monster ids', () => {
    const parsed = fromQuery('?v=necromancer&m=not-a-monster&p=100&prio=20');
    expect(parsed.vocation).toBeUndefined();
    const state = withKnownMonster({ ...DEFAULT_INPUTS, ...parsed }, known);
    expect(state).toEqual({ ...DEFAULT_INPUTS, points: 100, priority: 20, monsterId: null });
    expect(withKnownMonster({ ...DEFAULT_INPUTS, monsterId: 'demon' }, known).monsterId).toBe('demon');
  });

  it('clamps out-of-range points and priority', () => {
    expect(fromQuery('?p=-50&prio=-3')).toEqual({ points: 0, priority: 0 });
    expect(fromQuery('?p=999999&prio=101')).toEqual({ points: MAX_POINTS, priority: 100 });
    expect(fromQuery('?p=12.6')).toEqual({ points: 13 });
    expect(fromQuery('?p=Infinity&prio=NaN')).toEqual({});
  });

  it('sanitizes corrupted localStorage payloads', () => {
    expect(sanitize({ vocation: 42, points: '300', priority: null, monsterId: 7 })).toEqual({ points: 300 });
    expect(sanitize({ vocation: 'MONK' })).toEqual({});
  });

  it('round-trips a full state through the URL and back into a valid build', () => {
    const state = { vocation: 'sorcerer' as const, points: 750, monsterId: 'demon', priority: 25 };
    const back = withKnownMonster({ ...DEFAULT_INPUTS, ...fromQuery(toQuery(state)) }, known);
    expect(back).toEqual(state);
    const r = optimize({ vocation: back.vocation, points: back.points, monster: getMonsterById(back.monsterId!)!, priority: back.priority });
    assertValidResult(getWheel('sorcerer'), r, 750);
  });
});
