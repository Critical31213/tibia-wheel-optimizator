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
import { contextOf, DEFAULT_INPUTS, fromQuery, MAX_POINTS, sanitize, toQuery, withKnownMonster } from './lib/inputState';
import { gemsStorageKey, modsForSlot, parseGems, serializeGems } from './lib/gems';
import { MONSTERS } from './data';
import { getWheelData, WHEEL_DATA } from './data/wheel';
import { engineText, translator, type MessageKey } from './i18n';
import { en } from './i18n/en';
import { pl } from './i18n/pl';
import {
  VOCATIONS,
  type Domain,
  type EngineMessage,
  type FightContext,
  type GemQuality,
  type Monster,
  type OptimizerResult,
  type OwnedGem,
  type Vocation,
  type WheelDefinition,
} from './types';

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
    const state = { ...DEFAULT_INPUTS, vocation: 'sorcerer' as const, points: 750, monsterId: 'demon', priority: 25 };
    const back = withKnownMonster({ ...DEFAULT_INPUTS, ...fromQuery(toQuery(state)) }, known);
    expect(back).toEqual(state);
    const r = optimize({ vocation: back.vocation, points: back.points, monster: getMonsterById(back.monsterId!)!, priority: back.priority });
    assertValidResult(getWheel('sorcerer'), r, 750);
  });
});

// ---------------------------------------------------------------------------
// Iteration 2: fight context × points × vocation, gems & vessels, i18n

const CONTEXTS: FightContext[] = [
  { mode: 'boss', huntStyle: 'solo' },
  { mode: 'hunt', huntStyle: 'solo' },
  { mode: 'hunt', huntStyle: 'teamLure' },
  { mode: 'hunt', huntStyle: 'teamBox' },
];
const BUDGETS = [100, 500, 1000, 2000, 4000];
const ctxName = (c: FightContext) => (c.mode === 'boss' ? 'boss' : c.huntStyle);
const QUALITY_RANK: Record<GemQuality, number> = { lesser: 0, regular: 1, greater: 2 };

/** Directed unlock rule from the planner graph: a slice needs a full predecessor (or starts unlocked). */
function assertDirectedPath(vocation: Vocation, r: OptimizerResult) {
  const grid = new Map(getWheelData(vocation).tiles.map((t) => [t.tileName, t]));
  const full = new Set<number>();
  for (const id of r.path) {
    const t = grid.get(id)!;
    const open =
      WHEEL_DATA.unlockGraph.initiallyUnlocked.includes(t.gridId) ||
      [...full].some((g) => WHEEL_DATA.unlockGraph.edges[g]?.includes(t.gridId));
    expect(open, `${vocation}: ${id} not unlocked`).toBe(true);
    if (r.allocation[id] >= t.capacity) full.add(t.gridId);
  }
}

/** Every engine message is a known key in both dictionaries and renders without leftover placeholders. */
function assertMessagesResolvable(r: OptimizerResult) {
  const msgs: (EngineMessage | undefined)[] = [
    ...(r.rationaleMsgs ?? []),
    ...r.stats.map((s) => s.labelMsg),
    ...r.spells.map((s) => s.reasonMsg),
    ...r.gemRecommendations.map((g) => g.reasonMsg),
  ];
  expect(r.rationaleMsgs).toHaveLength(r.rationale.length);
  for (const m of msgs) {
    expect(m, 'missing EngineMessage').toBeDefined();
    const key = `engine.${m!.key}` as MessageKey;
    expect(en[key], key).toBeDefined();
    expect(pl[key], key).toBeDefined();
    for (const lang of ['en', 'pl'] as const) {
      expect(engineText(translator(lang), m, '<fallback>'), `${lang} ${key}`).not.toMatch(/\{\w+\}|<fallback>/);
    }
  }
}

const avatarDomain = (vocation: Vocation): Domain => getWheelData(vocation).revelations.find((x) => x.isAvatar)!.domain;

/** One lesser, one regular and one greater gem built from the vocation's mods. */
function ownedGems(wheel: WheelDefinition): OwnedGem[] {
  const b1 = modsForSlot(wheel.mods, 'basic1');
  const b2 = modsForSlot(wheel.mods, 'basic2');
  const sup = modsForSlot(wheel.mods, 'supreme');
  return [
    { id: 'lesser', quality: 'lesser', basic1: { modId: b1[0].id, grade: 2 }, basic2: null, supreme: null },
    { id: 'regular', quality: 'regular', basic1: { modId: b1[1].id, grade: 1 }, basic2: { modId: b2[0].id, grade: 3 }, supreme: null },
    {
      id: 'greater',
      quality: 'greater',
      basic1: { modId: b1[2].id, grade: 1 },
      basic2: { modId: b2[1].id, grade: 1 },
      supreme: { modId: sup[0].id, grade: 1 },
    },
  ];
}

describe('integration: vocation × fight context × points', () => {
  const cases = VOCATIONS.flatMap((v) => CONTEXTS.flatMap((c) => BUDGETS.map((p) => [v, ctxName(c), p, c] as const)));

  it.each(cases)('%s / %s / %i points', (vocation, _name, points, context) => {
    const wheel = getWheel(vocation);
    const gems = ownedGems(wheel);
    const r = optimize({ vocation, points, monster: null, priority: 50, context, gems });
    assertValidResult(wheel, r, points);
    assertDirectedPath(vocation, r);
    assertMessagesResolvable(r);

    // Avatar is valued in boss mode only.
    const avatarSpells = r.spells.filter((s) => /^Avatar of/.test(s.name));
    expect(avatarSpells.length).toBeGreaterThan(0);
    for (const s of avatarSpells) expect(s.useful).toBe(context.mode === 'boss');
    if (context.mode === 'hunt') {
      for (const g of r.gemRecommendations) for (const m of g.mods) expect(m.name).not.toMatch(/Avatar/);
    }

    // Vessels: 8, 0-based ids, unlocked in order; owned gems placed once, active slots within vessel quality.
    expect(r.vessels.map((v) => v.vesselId)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const unlocked = r.vessels.filter((v) => v.unlocked).length;
    r.vessels.forEach((v, i) => expect(v.unlocked).toBe(i < unlocked));
    const placed = r.vessels.filter((v) => v.source === 'owned').map((v) => v.gem!.id);
    expect(new Set(placed).size).toBe(placed.length);
    for (const v of r.vessels) {
      if (!v.unlocked) expect(v).toMatchObject({ gem: null, source: 'empty' });
      if (v.source === 'owned') expect(gems.some((g) => g.id === v.gem!.id)).toBe(true);
      if (v.source === 'recommended') expect(QUALITY_RANK[v.gem!.quality]).toBeLessThanOrEqual(QUALITY_RANK[v.quality]);
    }
    if (r.vessels.some((v) => v.unlocked && v.quality === 'greater')) {
      expect(r.vessels.find((v) => v.gem?.id === 'greater')?.quality, 'greater gem in a greater vessel').toBe('greater');
    }
    if (unlocked > 0) {
      expect(placed.length).toBe(Math.min(unlocked, gems.length));
      expect(r.gemRecommendations.length).toBeGreaterThan(0);
    } else expect(placed).toEqual([]);
    for (const u of r.upgradeRecommendations) {
      expect(placed).toContain(u.gemId);
      expect(u.toGrade).toBe(u.fromGrade + 1);
      expect(u.gainToMax).toBeGreaterThanOrEqual(u.gain - 1e-9);
    }
  });

  it('boss mode reaches an Avatar stage at least as high as hunting', () => {
    for (const vocation of VOCATIONS) {
      const d = avatarDomain(vocation);
      const boss = optimize({ vocation, points: 2000, monster: null, priority: 0, context: CONTEXTS[0] });
      const hunt = optimize({ vocation, points: 2000, monster: null, priority: 0, context: CONTEXTS[3] });
      const stage = (r: OptimizerResult) => r.revelations.find((x) => x.perk.domain === d)!.stage;
      expect(stage(boss), vocation).toBeGreaterThanOrEqual(Math.max(1, stage(hunt)));
    }
  });

  it('area spells expect more targets in team-box than solo; bosses ~1', () => {
    const run = (c: FightContext) => optimize({ vocation: 'sorcerer', points: 1000, monster: null, priority: 50, context: c });
    const t = (r: OptimizerResult) => r.spells.find((s) => s.name === 'Great Fire Wave')!.expectedTargets;
    expect(t(run(CONTEXTS[3]))).toBeGreaterThan(t(run(CONTEXTS[1])));
    expect(t(run(CONTEXTS[0]))).toBeLessThanOrEqual(1.2);
  });
});

describe('integration: persistence', () => {
  it('round-trips the fight context through the URL', () => {
    for (const c of CONTEXTS) {
      const state = { ...DEFAULT_INPUTS, vocation: 'monk' as const, points: 1200, ...c };
      const back = { ...DEFAULT_INPUTS, ...fromQuery(toQuery(state)) };
      expect(contextOf(back)).toEqual(c);
      expect(back).toEqual(state);
    }
    expect(fromQuery('?f=raid&h=zerg')).toEqual({});
  });

  it('round-trips owned gems through per-vocation localStorage keys', () => {
    const store = new Map<string, string>();
    for (const vocation of VOCATIONS) {
      const gems = ownedGems(getWheel(vocation));
      store.set(gemsStorageKey(vocation), serializeGems(gems));
      expect(parseGems(store.get(gemsStorageKey(vocation))!)).toEqual(gems);
    }
    expect(store.size).toBe(VOCATIONS.length);
    expect(parseGems('{broken')).toEqual([]);
    expect(parseGems(null)).toEqual([]);
  });
});
