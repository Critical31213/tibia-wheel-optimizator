import { describe, expect, it } from 'vitest';
import { VOCATIONS, type Vocation } from '../../types';
import { WHEEL_DATA, getWheelData } from './index';
import {
  decodePlannerCode,
  encodePlannerCode,
  gridForSliceId,
  plannerUrl,
  plannerVesselIssues,
  sliceIdForGrid,
  type PlannerBuild,
  type PlannerVessel,
} from './plannerCode';
import { LIVE_PLANNER_CODE_FIXTURES, PLANNER_CODE_FIXTURES } from './plannerCode.fixtures';

const norm = (b: PlannerBuild) => ({
  vocation: b.vocation,
  points: Object.fromEntries(Object.entries(b.points).filter(([, v]) => v > 0).map(([k, v]) => [Number(k), v])),
  vessels: [...(b.vessels ?? [])].sort((a, c) => a.vesselId - c.vesselId),
});

describe('planner code (committed fixtures)', () => {
  it.each(PLANNER_CODE_FIXTURES.map((f) => [`${f.vocation}: ${f.note}`, f] as const))('%s', (_, f) => {
    expect(encodePlannerCode(f)).toBe(f.code);
    const d = decodePlannerCode(f.code);
    expect(d.version).toBe(1);
    expect(norm(d)).toEqual(norm(f));
  });

  it('decodes legacy (version 0) codes: tiles only', () => {
    const d = decodePlannerCode('K0Y2BABkYoFAz8RwIA');
    expect(d).toMatchObject({ vocation: 'knight', version: 0, legacy: true, points: { 14: 50, 21: 50 }, vessels: [] });
  });

  it.each(LIVE_PLANNER_CODE_FIXTURES.map((f) => [`live ${f.vocation}: ${f.note}`, f] as const))('D88 %s', (_, f) => {
    expect(encodePlannerCode(f)).toBe(f.code);
    const d = decodePlannerCode(f.code);
    expect(d).toMatchObject({ version: 0, variant: 'live' });
    expect(norm(d)).toEqual(norm(f));
    expect(plannerUrl(f.code)).toBe(`https://www.tibia.com/community/?subtopic=wheelofdestinyplanner&code=${f.code}`);
  });

  it('D88: live gems fill their slots in order, in any of the 4 domain vessels', () => {
    expect(plannerVesselIssues('knight', [{ vesselId: 3, basic1: 4, basic2: 5, supreme: 1 }], 'live')).toEqual([]);
    expect(plannerVesselIssues('knight', [{ vesselId: 0, basic1: 4, supreme: 1 }], 'live')).toHaveLength(1);
    expect(plannerVesselIssues('knight', [{ vesselId: 4, basic1: 4 }], 'live')).toHaveLength(1);
  });

  it('rejects malformed codes', () => {
    expect(() => decodePlannerCode('X1Y2AgDP7jAAA')).toThrow();
    expect(() => decodePlannerCode('K2Y2AgDP7jAAA')).toThrow();
    expect(() => decodePlannerCode('K1Y2Ag')).toThrow();
  });

  it('validates gems against vessel quality and vocation mods', () => {
    expect(plannerVesselIssues('knight', [{ vesselId: 0, basic1: 4 }])).toEqual([]);
    expect(plannerVesselIssues('knight', [{ vesselId: 0, basic1: 4, basic2: 5 }])).toHaveLength(1);
    expect(plannerVesselIssues('knight', [{ vesselId: 2, basic1: 4, basic2: 5 }])).toHaveLength(1);
    expect(plannerVesselIssues('knight', [{ vesselId: 2, basic1: 0, basic2: 5, supreme: 24 }])).toHaveLength(2);
    expect(() => encodePlannerCode({ vocation: 'knight', points: {}, vessels: [{ vesselId: 1, basic1: 4 }] })).toThrow();
    expect(encodePlannerCode({ vocation: 'knight', points: {}, vessels: [{ vesselId: 1, basic1: 4 }] }, { strict: false })).toMatch(/^K1/);
  });

  it('maps grid ids to engine slice ids and builds the URL', () => {
    for (const v of VOCATIONS) for (const t of getWheelData(v).tiles) expect(gridForSliceId(sliceIdForGrid(t.gridId, v), v)).toBe(t.gridId);
    expect(sliceIdForGrid(14)).toBe(getWheelData('knight').tiles.find((t) => t.gridId === 14)!.tileName);
    expect(plannerUrl('K1Y2AgDP7jAAA')).toBe(
      'https://www.test.tibia.com/community/?subtopic=wheelofdestinyplanner&code=K1Y2AgDP7jAAA',
    );
  });
});

// ---------------------------------------------------------------------------
// Round-trip against the official planner WASM (gitignored cache; skipped when absent).

type NodeMod = Record<string, (...a: unknown[]) => unknown>;
const nodeImport = (m: string) => import(/* @vite-ignore */ m) as Promise<NodeMod>;
const proc = (globalThis as unknown as { process?: { cwd(): string } }).process;
const { existsSync } = await nodeImport('node:fs');
const cachePath = `${proc?.cwd() ?? '.'}/scripts/.cache/wod/skillgrid.cjs`;
const hasWasm = existsSync(cachePath) as boolean;

type Planner = any;
const VOC_ENUM: Record<Vocation, string> = { knight: 'Knight', paladin: 'Paladin', sorcerer: 'Sorcerer', druid: 'Druid', monk: 'Monk' };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

/** Random valid build: steps in unlock order (fill or partial add), plus gems on random vessels. */
function randomBuild(seed: number) {
  const r = rng(seed);
  const vocation = VOCATIONS[seed % VOCATIONS.length];
  const w = getWheelData(vocation);
  const cap = Object.fromEntries(w.tiles.map((t) => [t.gridId, t.capacity]));
  const points: Record<number, number> = {};
  const steps: [number, number][] = [];
  const unlocked = new Set(WHEEL_DATA.unlockGraph.initiallyUnlocked);
  const n = Math.floor(r() * 70);
  for (let k = 0; k < n; k++) {
    const open = [...unlocked].filter((id) => (points[id] ?? 0) < cap[id]);
    if (!open.length) break;
    const id = open[Math.floor(r() * open.length)];
    const left = cap[id] - (points[id] ?? 0);
    const add = r() < 0.7 ? left : 1 + Math.floor(r() * left);
    points[id] = (points[id] ?? 0) + add;
    steps.push([id, add]);
    if (points[id] === cap[id]) for (const x of WHEEL_DATA.unlockGraph.edges[id] ?? []) unlocked.add(x);
  }
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const b1 = w.mods.basic.filter((m) => m.slots.includes(1)).map((m) => m.id);
  const b2 = w.mods.basic.filter((m) => m.slots.includes(2)).map((m) => m.id);
  const sup = w.mods.supreme.map((m) => m.id);
  const vessels: PlannerVessel[] = [];
  for (const v of w.vessels) {
    if (r() < 0.35) continue;
    const g: PlannerVessel = { vesselId: v.id, basic1: pick(b1) };
    if (v.quality !== 'lesser') g.basic2 = pick(b2);
    if (v.quality === 'greater') g.supreme = pick(sup);
    vessels.push(g);
  }
  return { build: { vocation, points, vessels } satisfies PlannerBuild, steps };
}

describe.skipIf(!hasWasm)('planner code vs official planner WASM', () => {
  it('200 random builds: encoder matches getCode(), updateByCode accepts it, decoder reads planner codes', async () => {
    const { createRequire } = await nodeImport('node:module');
    const req = createRequire(import.meta.url) as (p: string) => () => Promise<any>;
    const M = await req(cachePath)();
    const arr = (v: any) => {
      const a: any[] = [];
      for (let i = 0; i < v.size(); i++) a.push(v.get(i));
      v.delete();
      return a;
    };
    const tileEnum = (id: number) => Object.values(M.EGridTile).find((e: any) => e && e.value === id);
    const state = (p: Planner) => ({
      points: Object.fromEntries(
        arr(p.getSkillParameters()).filter((t) => t.currentSkillPoints > 0).map((t) => [t.id.value, t.currentSkillPoints]),
      ),
      vessels: arr(p.getVesselParameters())
        .filter((v) => v.keyBasicMod1 >= 0)
        .map((v) => {
          const g: PlannerVessel = { vesselId: v.id, basic1: v.keyBasicMod1 };
          if (v.keyBasicMod2 >= 0) g.basic2 = v.keyBasicMod2;
          if (v.keySupremeMod >= 0) g.supreme = v.keySupremeMod;
          return g;
        }),
    });

    for (let seed = 1; seed <= 200; seed++) {
      const { build, steps } = randomBuild(seed);
      const ours = encodePlannerCode(build);

      const built: Planner = new M.SkillwheelPlanner(M.EActiveVocation[VOC_ENUM[build.vocation]]);
      for (const [id, add] of steps) built.addToSkill(tileEnum(id), add);
      for (const g of build.vessels) {
        if (g.supreme !== undefined) built.onModChange(3, g.supreme, g.vesselId);
        if (g.basic2 !== undefined) built.onModChange(2, g.basic2, g.vesselId);
        built.onModChange(1, g.basic1, g.vesselId);
      }
      const theirs: string = built.getCode();
      expect(norm({ vocation: build.vocation, ...state(built) }), `seed ${seed} planner state`).toEqual(norm(build));
      built.delete();
      expect(ours, `seed ${seed}`).toBe(theirs);
      expect(norm(decodePlannerCode(theirs)), `seed ${seed} decode`).toEqual(norm(build));

      const loaded: Planner = new M.SkillwheelPlanner(M.EActiveVocation[VOC_ENUM[build.vocation]]);
      expect(loaded.updateByCode(ours), `seed ${seed} updateByCode`).toBe(1);
      expect(norm({ vocation: build.vocation, ...state(loaded) })).toEqual(norm(build));
      loaded.delete();
    }
  }, 120_000);
});
