import { beforeAll, describe, expect, it } from 'vitest';
import {
  getForceableSpells,
  getMonsterById,
  getRotationPresets,
  getWheel,
  isMonsterDataLoaded,
  loadMonsterData,
  optimize,
  pointsForLevel,
  searchMonsters,
} from './lib/api';
import { characterOf, contextOf, DEFAULT_INPUTS, fromQuery, MAX_POINTS, sanitize, toQuery, withKnownMonsters } from './lib/inputState';
import { resolveMonsters } from './lib/monsters';
import { PLANNER_URL, plannerUrl } from './lib/planner';
import { getDamageSpell, isSingleTarget, revelationSpell, spellElement } from './data/damage';
import { getEngineWheel } from './engine/wheel/build';
import { decodePlannerCode, gridForSliceId, plannerVesselIssues, type PlannerVessel } from './data/wheel/plannerCode';
import { gemsStorageKey, modsForSlot, parseGems, serializeGems } from './lib/gems';
import { MONSTERS } from './data';
import { getWheelData, WHEEL_DATA } from './data/wheel';
import { engineText, translator, type MessageKey } from './i18n';
import { en } from './i18n/en';
import { pl } from './i18n/pl';
import {
  GREEDY_ROTATION_ID,
  VOCATIONS,
  type CharacterStats,
  type Domain,
  type EngineMessage,
  type FightContext,
  type GemQuality,
  type Monster,
  type OptimizerInput,
  type OptimizerResult,
  type OwnedGem,
  type Vocation,
  type WeightedMonster,
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

  it('level 1000 + 50 extra points = 1000 points, enough for a stage-2+ revelation', () => {
    expect(pointsForLevel(1000, 50)).toBe(1000);
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
    const state = withKnownMonsters({ ...DEFAULT_INPUTS, ...parsed }, known);
    expect(state).toEqual({ ...DEFAULT_INPUTS, points: 100, priority: 20, monsters: [] });
    expect(withKnownMonsters({ ...DEFAULT_INPUTS, monsters: [{ id: 'demon', weight: 1 }] }, known).monsters).toEqual([{ id: 'demon', weight: 1 }]);
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
    const state = { ...DEFAULT_INPUTS, vocation: 'sorcerer' as const, points: 750, monsters: [{ id: 'demon', weight: 1 }], priority: 25 };
    const back = withKnownMonsters({ ...DEFAULT_INPUTS, ...fromQuery(toQuery(state)) }, known);
    expect(back).toEqual(state);
    const r = optimize({ vocation: back.vocation, points: back.points, monster: getMonsterById(back.monsters[0].id)!, priority: back.priority });
    assertValidResult(getWheel('sorcerer'), r, 750);
  });
});

// ---------------------------------------------------------------------------
// Iteration 2: fight context × points × vocation, gems & vessels, i18n

const CONTEXTS: FightContext[] = [
  { mode: 'boss' },
  { mode: 'hunt' },
];
const BUDGETS = [100, 500, 1000, 2000, 4000];
const ctxName = (c: FightContext) => c.mode;

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
      expect(v.source).not.toBe('recommended');
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
      const hunt = optimize({ vocation, points: 2000, monster: null, priority: 0, context: CONTEXTS[1] });
      const stage = (r: OptimizerResult) => r.revelations.find((x) => x.perk.domain === d)!.stage;
      expect(stage(boss), vocation).toBeGreaterThanOrEqual(Math.max(1, stage(hunt)));
    }
  });

  it('area spells expect more targets when hunting than on bosses (~1)', () => {
    const run = (c: FightContext) => optimize({ vocation: 'sorcerer', points: 1000, monster: null, priority: 50, context: c });
    const t = (r: OptimizerResult) => r.spells.find((s) => s.name === 'Great Fire Wave')!.expectedTargets;
    expect(t(run(CONTEXTS[1]))).toBeGreaterThan(t(run(CONTEXTS[0])));
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

// ---------------------------------------------------------------------------
// Iteration 3: D16, planner code, alternatives, hunting spots, character stats, URL state

const HUNTS = CONTEXTS.filter((c) => c.mode === 'hunt');
const SLOTS_FOR: Record<GemQuality, readonly ('basic1' | 'basic2' | 'supreme')[]> = {
  lesser: ['basic1'],
  regular: ['basic1', 'basic2'],
  greater: ['basic1', 'basic2', 'supreme'],
};
type Build = Omit<OptimizerResult, 'alternatives'>;
const allBuilds = (r: OptimizerResult): Build[] => [r, ...(r.alternatives ?? []).map((a) => a.result)];

/** Gems the planner can store: unlocked vessel, every slot of the vessel quality filled. */
function expectedPlannerVessels(vocation: Vocation, r: Build): PlannerVessel[] {
  const out: PlannerVessel[] = [];
  for (const v of r.vessels) {
    const g = v.gem;
    if (!v.unlocked || !g || SLOTS_FOR[v.quality].some((s) => !g[s])) continue;
    const pv: PlannerVessel = { vesselId: v.vesselId };
    for (const s of SLOTS_FOR[v.quality]) pv[s] = g[s]!.modId;
    if (plannerVesselIssues(vocation, [pv]).length === 0) out.push(pv);
  }
  return out;
}

const gridPoints = (vocation: Vocation, allocation: Record<string, number>) =>
  Object.fromEntries(Object.entries(allocation).map(([id, p]) => [gridForSliceId(id, vocation), p]));

function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

/** 30 deterministic random inputs across vocations, budgets, contexts, character levels and gems. */
const RANDOM_INPUTS: OptimizerInput[] = Array.from({ length: 30 }, (_, i) => {
  const r = rng(i + 7);
  const vocation = VOCATIONS[i % VOCATIONS.length];
  const points = Math.floor(r() * 4001);
  return {
    vocation,
    points,
    monster: null,
    priority: Math.floor(r() * 101),
    context: CONTEXTS[Math.floor(r() * CONTEXTS.length)],
    gems: r() < 0.6 ? ownedGems(getWheel(vocation)) : [],
    character: r() < 0.7 ? { level: Math.max(points + 50, 200 + Math.floor(r() * 1300)) } : undefined,
  };
});

describe('integration: D16 — hunting never values single-target spells', () => {
  const cases = VOCATIONS.flatMap((v) => HUNTS.map((c) => [v, ctxName(c), c] as const));

  it.each(cases)('%s / %s', (vocation, _name, context) => {
    const wheel = getWheel(vocation);
    const r = optimize({ vocation, points: 1500, monster: null, priority: 30, context, gems: ownedGems(wheel), character: { level: 800 } });
    const single = r.spells.filter((s) => getDamageSpell(s.name) && isSingleTarget(s.name));
    for (const s of single) {
      expect(s.useful, s.name).toBe(false);
      expect(s.share ?? 0, s.name).toBe(0);
      expect(s.reasonMsg?.key, s.name).toBe('spell.singleTargetHunt');
    }
    const singleNames = new Set(single.map((s) => s.name));
    for (const b of allBuilds(r)) {
      for (const g of b.gemRecommendations) {
        const spell = g.reasonMsg?.params?.spell;
        if (typeof spell === 'string') expect(singleNames.has(spell), `${spell} recommended while hunting`).toBe(false);
      }
    }
    if (single.length) expect((r.rationaleMsgs ?? []).map((m) => m.key)).toContain('rationale.singleTarget');
  });

  it('boss mode does value single-target spells', () => {
    let withSingle = 0;
    for (const vocation of VOCATIONS) {
      const r = optimize({ vocation, points: 1500, monster: null, priority: 30, context: CONTEXTS[0] });
      const single = r.spells.filter((s) => getDamageSpell(s.name) && isSingleTarget(s.name));
      for (const s of single) expect(['spell.damage', 'spell.lowShare', 'spell.revelationLocked', 'spell.notInRotation']).toContain(s.reasonMsg?.key);
      withSingle += single.length ? 1 : 0;
    }
    expect(withSingle).toBeGreaterThanOrEqual(3);
  });
});

describe('integration: planner export code', () => {
  it.each(RANDOM_INPUTS.map((x, i) => [i, x.vocation, x.points, x] as const))(
    '#%i %s %i pts: code decodes to the allocation and gems (main + alternatives)',
    (_i, vocation, _p, input) => {
      const r = optimize(input);
      for (const b of allBuilds(r)) {
        expect(b.plannerCode).toMatch(/^[KPSDM]1[A-Za-z0-9_-]+$/);
        const d = decodePlannerCode(b.plannerCode!);
        expect(d.vocation).toBe(vocation);
        expect(Object.fromEntries(Object.entries(d.points).filter(([, p]) => p > 0))).toEqual(gridPoints(vocation, b.allocation));
        expect([...d.vessels].sort((a, c) => a.vesselId - c.vesselId)).toEqual(expectedPlannerVessels(vocation, b));
      }
    },
  );

  it('the export URL points at the official planner with the code', () => {
    const r = optimize(RANDOM_INPUTS[3]);
    expect(plannerUrl(r.plannerCode!)).toBe(`${PLANNER_URL}&code=${r.plannerCode}`);
  });
});

type NodeMod = Record<string, (...a: unknown[]) => unknown>;
const nodeImport = (m: string) => import(/* @vite-ignore */ m) as Promise<NodeMod>;
const proc = (globalThis as unknown as { process?: { cwd(): string } }).process;
const { existsSync } = await nodeImport('node:fs');
const WASM_PATH = `${proc?.cwd() ?? '.'}/scripts/.cache/wod/skillgrid.cjs`;
const VOC_ENUM: Record<Vocation, string> = { knight: 'Knight', paladin: 'Paladin', sorcerer: 'Sorcerer', druid: 'Druid', monk: 'Monk' };

describe.skipIf(!(existsSync(WASM_PATH) as boolean))('integration: official planner WASM accepts optimizer codes', () => {
  it('30 random inputs: updateByCode loads identical tile points and gems', async () => {
    const { createRequire } = await nodeImport('node:module');
    const req = createRequire(import.meta.url) as (p: string) => () => Promise<any>;
    const M = await req(WASM_PATH)();
    const list = (v: any) => {
      const a: any[] = [];
      for (let i = 0; i < v.size(); i++) a.push(v.get(i));
      v.delete();
      return a;
    };
    for (const input of RANDOM_INPUTS) {
      for (const b of allBuilds(optimize(input))) {
        const planner = new M.SkillwheelPlanner(M.EActiveVocation[VOC_ENUM[input.vocation]]);
        expect(planner.updateByCode(b.plannerCode), b.plannerCode).toBe(1);
        const pts = Object.fromEntries(
          list(planner.getSkillParameters()).filter((t) => t.currentSkillPoints > 0).map((t) => [t.id.value, t.currentSkillPoints]),
        );
        const vessels = list(planner.getVesselParameters())
          .filter((v) => v.keyBasicMod1 >= 0)
          .map((v) => {
            const g: PlannerVessel = { vesselId: v.id, basic1: v.keyBasicMod1 };
            if (v.keyBasicMod2 >= 0) g.basic2 = v.keyBasicMod2;
            if (v.keySupremeMod >= 0) g.supreme = v.keySupremeMod;
            return g;
          })
          .sort((a, c) => a.vesselId - c.vesselId);
        planner.delete();
        expect(pts).toEqual(gridPoints(input.vocation, b.allocation));
        expect(vessels).toEqual(expectedPlannerVessels(input.vocation, b));
      }
    }
  }, 120_000);
});

describe('integration: alternatives', () => {
  const dist = (a: Record<string, number>, b: Record<string, number>) => {
    let d = 0;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) d += Math.abs((a[k] ?? 0) - (b[k] ?? 0));
    return d / 2;
  };

  it.each(VOCATIONS.flatMap((v) => [CONTEXTS[0], CONTEXTS[1]].map((c) => [v, ctxName(c), c] as const)))(
    '%s / %s: two distinct, labelled alternatives with resolvable messages',
    (vocation, _name, context) => {
      const points = 1200;
      const r = optimize({ vocation, points, monster: null, priority: 40, context, alternatives: 2 });
      expect(r.alternatives).toHaveLength(2);
      const builds = allBuilds(r);
      for (let i = 0; i < builds.length; i++)
        for (let j = i + 1; j < builds.length; j++) expect(dist(builds[i].allocation, builds[j].allocation)).toBeGreaterThanOrEqual(120);
      expect(new Set(builds.map((b) => b.plannerCode)).size).toBe(3);
      for (const a of r.alternatives!) {
        assertValidResult(getWheel(vocation), a.result, points);
        assertDirectedPath(vocation, a.result);
        assertMessagesResolvable(a.result);
        expect(a.relativeScore).toBeGreaterThan(0);
        expect(a.relativeScore).toBeLessThanOrEqual(100);
        for (const m of [a.labelMsg, a.tradeoffMsg]) {
          const key = `engine.${m!.key}` as MessageKey;
          expect(en[key] && pl[key], key).toBeTruthy();
          for (const lang of ['en', 'pl'] as const) expect(engineText(translator(lang), m, '')).not.toMatch(/\{\w+\}/);
        }
      }
      expect(new Set(r.alternatives!.map((a) => a.label)).size).toBe(2);
    },
  );
});

describe('integration: hunting spot (weighted monsters)', () => {
  const spot = (fire: number, energy: number): WeightedMonster[] => [
    { monster: monster('askarak-demon'), weight: fire },
    { monster: monster('chakoya-windcaller'), weight: energy },
  ];
  const run = (fire: number, energy: number) =>
    optimize({ vocation: 'sorcerer', points: 1500, monster: null, monsters: spot(fire, energy), priority: 30, context: CONTEXTS[1] });
  const topElement = (r: OptimizerResult) => spellElement(r.spells.find((s) => s.useful && (s.share ?? 0) > 0)!.name);

  it('weights change the preferred element and the build', () => {
    expect(monster('askarak-demon').elementModifiers.fire).toBeGreaterThan(100);
    expect(monster('chakoya-windcaller').elementModifiers.energy).toBeGreaterThan(100);
    const fire = run(9, 1);
    const energy = run(1, 9);
    expect(topElement(fire)).not.toBe('energy');
    // D24/D25: Master of Decay converts the death-beam rotation (death 105–108 % on both monsters), so both spots
    // share the rotation (D29: and the build); the weights still change the valuation.
    expect([fire.offenseScore, fire.defenseScore]).not.toEqual([energy.offenseScore, energy.defenseScore]);
    expect(run(18, 2).allocation).toEqual(fire.allocation);
    const spotMsg = fire.rationaleMsgs!.find((m) => m.key === 'rationale.spot');
    expect(spotMsg?.params?.list).toBe('Askarak Demon 90%, Chakoya Windcaller 10%');
    assertMessagesResolvable(fire);
  });

  it('URL monster list resolves to the same engine input', () => {
    const monsters = [{ id: 'askarak-demon', weight: 9 }, { id: 'chakoya-windcaller', weight: 1 }];
    const back = { ...DEFAULT_INPUTS, ...fromQuery(toQuery({ ...DEFAULT_INPUTS, vocation: 'sorcerer', points: 1500, monsters })) };
    expect(resolveMonsters(back.monsters, getMonsterById)).toEqual(spot(9, 1));
  });
});

describe('integration: character stats', () => {
  it('a level 400 paladin prefers Hit Points over mitigation', () => {
    const r = optimize({ vocation: 'paladin', points: 350, monster: null, priority: 80, character: { level: 400 } });
    const keys = r.rationaleMsgs!.map((m) => m.key);
    expect(keys).toContain('rationale.hpOverMitigation');
    expect(keys).not.toContain('rationale.mitigationOverHp');
    expect(r.gemRecommendations.find((g) => g.quality === 'lesser')?.mods[0].name).not.toBe('Mitigation Multiplier');
  });

  it('character level and skills change the output', () => {
    const base = { vocation: 'knight' as const, points: 1450, monster: null, priority: 100 };
    const low = optimize({ ...base, character: { level: 400 } });
    const high = optimize({ ...base, character: { level: 1500 } });
    const ratio = (r: OptimizerResult) => Number(r.rationaleMsgs!.find((m) => m.key === 'rationale.hpOverMitigation')?.params?.ratio ?? 0);
    expect(ratio(low)).toBeGreaterThan(ratio(high));
    expect(high.gemRecommendations.find((g) => g.quality === 'lesser')?.mods[0].name).toBe('Hit Points');
    const charMsg = (r: OptimizerResult) => r.rationaleMsgs!.find((m) => m.key === 'rationale.character')!.params!;
    expect(charMsg(low).level).toBe(400);
    expect(Number(charMsg(high).hp)).toBeGreaterThan(Number(charMsg(low).hp));
    const gains = (character: CharacterStats) =>
      optimize({ vocation: 'paladin', points: 600, monster: null, priority: 30, character }).gemRecommendations.map((g) => [g.gain, ...g.mods.map((m) => m.name)]);
    expect(gains({ level: 650, mainSkill: 60 })).not.toEqual(gains({ level: 650, mainSkill: 130 }));
  });

  it('UI state → characterOf → engine: only the vocation skills are sent', () => {
    const state = { ...DEFAULT_INPUTS, vocation: 'sorcerer' as const, points: 550, level: 600, mainSkill: 99, shielding: 80, magicLevel: 110 };
    expect(characterOf(state)).toEqual({ level: 600, magicLevel: 110 });
    expect(characterOf({ ...DEFAULT_INPUTS, points: 300 })).toBeUndefined();
    const r = optimize({ vocation: 'sorcerer', points: 550, monster: null, priority: 50, character: characterOf(state) });
    expect(r.rationaleMsgs!.find((m) => m.key === 'rationale.character')?.params?.level).toBe(600);
  });
});

describe('integration: URL state (iteration 3 keys)', () => {
  const known = (id: string) => getMonsterById(id) !== undefined;

  it('round-trips level, scrolls, skills, weighted monsters and context', () => {
    const state = {
      ...DEFAULT_INPUTS,
      vocation: 'paladin' as const,
      points: 600,
      level: 600,
      scrolls: 30,
      mainSkill: 120,
      shielding: 40,
      magicLevel: 30,
      monsters: [{ id: 'demon', weight: 2.5 }, { id: 'dragon-lord', weight: 1 }],
      priority: 35,
      mode: 'boss' as const,
    };
    const q = toQuery(state);
    for (const k of ['lv=600', 'sc=30', 'sk=120', 'sh=40', 'ml=30', 'm=demon*2.5_dragon-lord']) expect(decodeURIComponent(q)).toContain(k);
    expect(withKnownMonsters({ ...DEFAULT_INPUTS, ...fromQuery(q) }, known)).toEqual(state);
  });

  it('a full link with absent optional keys clears them; legacy single monster migrates', () => {
    const q = toQuery({ ...DEFAULT_INPUTS, vocation: 'druid', points: 300 });
    expect(fromQuery(q)).toMatchObject({ level: null, mainSkill: null, shielding: null, magicLevel: null, scrolls: 0, monsters: [] });
    expect(sanitize({ monsterId: 'demon' }).monsters).toEqual([{ id: 'demon', weight: 1 }]);
    expect(withKnownMonsters({ ...DEFAULT_INPUTS, ...fromQuery('?v=knight&m=demon_nope*3') }, known).monsters).toEqual([{ id: 'demon', weight: 1 }]);
    expect(fromQuery('?m=demon*-1_demon*5').monsters).toEqual([{ id: 'demon', weight: 1 }]);
  });
});

describe('integration: iteration 4 — EHP gems, rotations, forced spells', () => {
  const HUNT: FightContext = { mode: 'hunt' };
  const BOSS: FightContext = { mode: 'boss' };
  const at = (level: number) => ({ points: pointsForLevel(level), character: { level } });
  const stageOf = (r: Build, name: string | null) => r.revelations.find((x) => x.perk.name === name)?.stage ?? 0;

  it.each(VOCATIONS)('%s: no capacity or max-mana gem mods (levels 200–1500, both modes, priority 0/50/100)', (vocation) => {
    for (const level of [200, 600, 1500])
      for (const context of [HUNT, BOSS])
        for (const priority of [0, 50, 100]) {
          const r = optimize({ vocation, ...at(level), monster: null, priority, context });
          for (const b of allBuilds(r))
            for (const g of b.gemRecommendations)
              for (const m of g.mods) expect(m.name, `${level}/${context.mode}/${priority}`).not.toMatch(/\b(Capacity|Mana)\b(?! Drain)/);
        }
  });

  it.each(VOCATIONS)('%s: every forceable spell has a wheel augment slice (not gem-only)', (vocation) => {
    const wheelSpells = new Set(getEngineWheel(vocation).slices.flatMap((sl) => sl.tile.conviction.augment?.spells ?? []));
    expect(getForceableSpells(vocation).filter((s) => !wheelSpells.has(s))).toEqual([]);
  });

  it.each([
    ['paladin', 'Divine Dazzle'],
    ['monk', 'Mystic Repulse'],
    ['druid', 'Heal Friend'],
  ] as const)('%s: forced %s augment is in the allocation (UI list → engine)', (vocation, spell) => {
    expect(getForceableSpells(vocation)).toContain(spell);
    const r = optimize({ vocation, ...at(600), monster: null, priority: 50, context: HUNT, forcedSpells: [spell] });
    const slices = getEngineWheel(vocation).slices.filter((sl) => sl.tile.conviction.augment?.spells.includes(spell));
    expect(slices.length).toBeGreaterThan(0);
    expect(slices.some((sl) => (r.allocation[sl.slice.id] ?? 0) >= sl.capacity)).toBe(true);
    expect(r.rationaleMsgs!.map((m) => m.key)).toContain('rationale.forced');
    assertValidResult(getWheel(vocation), r, pointsForLevel(600));
  });

  it.each(VOCATIONS)('%s: every manual preset is honoured (auto=false) for main and alternatives', (vocation) => {
    for (const p of getRotationPresets(vocation)) {
      const r = optimize({ vocation, ...at(1000), monster: null, priority: 50, context: HUNT, rotationId: p.id, alternatives: 1 });
      for (const b of allBuilds(r)) expect(b.rotation, p.id).toMatchObject({ presetId: p.id, auto: false });
      const msg = r.rationaleMsgs!.find((m) => m.key === 'rationale.rotationManual');
      expect(msg?.params?.rotation).toBe(p.name);
    }
    const auto = optimize({ vocation, ...at(1000), monster: null, priority: 50, context: HUNT });
    expect(auto.rotation?.auto).toBe(true);
    expect(getRotationPresets(vocation).map((p) => p.id)).toContain(auto.rotation!.presetId);
  });

  it.each(VOCATIONS)('%s: revelation spells flagged only while their revelation is active', (vocation) => {
    for (const level of [300, 800, 1500])
      for (const priority of [0, 50])
        for (const context of [HUNT, BOSS]) {
          const r = optimize({ vocation, ...at(level), monster: null, priority, context, alternatives: 1 });
          for (const b of allBuilds(r))
            for (const s of b.rotation!.spells) {
              const rev = revelationSpell(s.name);
              expect(Boolean(s.fromRevelation), s.name).toBe(rev !== null);
              if (rev) expect(stageOf(b, rev), `${s.name} @${level}/${priority}`).toBeGreaterThan(0);
            }
        }
  });

  it.each(VOCATIONS)('%s: avatar in the rotation only in boss mode with the avatar revelation reached', (vocation) => {
    const avatarName = getEngineWheel(vocation).revelations.find((r) => r.data.isAvatar)!.data.name;
    let seen = 0;
    for (const level of [300, 1000, 2000])
      for (const context of [HUNT, BOSS]) {
        const r = optimize({ vocation, ...at(level), monster: null, priority: 30, context });
        const has = r.rotation!.spells.some((s) => s.name === avatarName);
        expect(has, `${level}/${context.mode}`).toBe(context.mode === 'boss' && stageOf(r, avatarName) > 0);
        seen += has ? 1 : 0;
      }
    expect(seen).toBeGreaterThan(0);
  });

  it('the greedy boss plan gets a translated label (never the raw id)', () => {
    const msg: EngineMessage = { key: 'rationale.rotationAuto', params: { rotation: GREEDY_ROTATION_ID } };
    expect(engineText(translator('en'), msg, '')).toContain(en['rotation.boss']);
    expect(engineText(translator('pl'), msg, '')).toContain(pl['rotation.boss']);
    expect(getRotationPresets('paladin').map((p) => p.id)).not.toContain(GREEDY_ROTATION_ID);
  });

  it('builds with forced spells / manual rotations still produce decodable planner codes', () => {
    const r = optimize({ vocation: 'paladin', ...at(800), monster: null, priority: 50, context: BOSS, rotationId: 'rp-barrages', forcedSpells: ['Divine Dazzle', 'Salvation'], alternatives: 2 });
    for (const b of allBuilds(r)) {
      const d = decodePlannerCode(b.plannerCode!);
      expect(d.vocation).toBe('paladin');
      expect(Object.fromEntries(Object.entries(d.points).filter(([, p]) => p > 0))).toEqual(gridPoints('paladin', b.allocation));
    }
  });
});

describe('D42: worker messages', () => {
  it('inputs and results survive structured clone unchanged (postMessage to/from the worker)', () => {
    const monsters = resolveMonsters(MONSTERS.slice(0, 3).map((m) => ({ id: m.id, weight: 1 })), getMonsterById);
    const gems = parseGems(serializeGems([{ id: 'a', quality: 'greater', basic1: null, basic2: null, supreme: null }]));
    const input = { vocation: 'paladin' as const, points: 900, monster: null, monsters, priority: 50, context: { mode: 'boss' as const }, gems, alternatives: 0, forcedSpells: ['Divine Caldera'], forcedRevelations: [{ name: 'Divine Grenade', stage: 2 as const }] };
    expect(structuredClone(input)).toEqual(input);
    const r = optimize(structuredClone(input));
    expect(structuredClone(r)).toEqual(r);
    expect(r).toEqual(optimize(input));
  });
});

describe('D59: equal-capacity swaps', () => {
  it('takes +1 distance instead of a Revelation Mastery slice whose points cross no threshold', () => {
    const monster = MONSTERS.find((m) => m.name === 'Rootthing Nutshell')!;
    const r = optimize({ vocation: 'paladin', points: 800, monster, priority: 20, context: { mode: 'hunt' } });
    const names = r.path.map((id) => getWheel('paladin').slices.find((s) => s.id === id)!.conviction.name);
    expect(names).not.toContain('Revelation Mastery Divine Grenade');
    expect(names).toContain('Distance Skill Boost');
    expect(r.revelations.find((x) => x.perk.name === 'Divine Grenade')!.stage).toBe(2);
  });
});

describe('D61: unique conviction rationale', () => {
  it('explains each chosen unique perk with its effect', () => {
    const r = optimize({ vocation: 'sorcerer', points: 2000, monster: null, priority: 0, context: { mode: 'boss' } });
    const msgs = (r.rationaleMsgs ?? []).filter((m) => m.key.startsWith('rationale.unique'));
    expect(msgs.map((m) => m.key)).toContain('rationale.uniqueFocus');
    for (const m of msgs) expect(m.params?.gain).toBeTruthy();
    const focus = msgs.find((m) => m.key === 'rationale.uniqueFocus')!;
    expect(focus.params).toEqual({ perk: 'Focus Mastery', gain: '+3% damage' });
    const t = translator('pl');
    expect(engineText(t, focus, '')).toContain('+3% obrażeń');
  });
});
