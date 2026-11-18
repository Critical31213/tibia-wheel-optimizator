import { describe, expect, it } from 'vitest';
import type { FightContext, Monster, OptimizerInput, OwnedGem, Vocation } from '../types';
import { decodePlannerCode, gridForSliceId, plannerVesselIssues } from '../data/wheel/plannerCode';
import { WHEEL_DATA, getWheelData } from '../data/wheel';
import { optimize } from './index';
import { valuationFor } from './optimizer';
import { buildSpellModel, damageShare, NO_STAGES, normaliseMonsters, spotElementMultiplier } from './spells';
import { hpParts, mitigationParts, supremeModParts } from './values';
import { getEngineWheel, stageFor } from './wheel/build';

const HUNT: FightContext = { mode: 'hunt', huntStyle: 'solo' };
const BOX: FightContext = { mode: 'hunt', huntStyle: 'teamBox' };
const BOSS: FightContext = { mode: 'boss', huntStyle: 'solo' };

const monster = (id: string, mods: Monster['elementModifiers'], maxDamage = 800): Monster => ({
  id,
  name: id,
  elementModifiers: mods,
  damageTypes: ['physical'],
  maxDamage,
});

const keys = (r: { rationaleMsgs?: { key: string }[] }) => (r.rationaleMsgs ?? []).map((m) => m.key);

describe('character and defense valuation', () => {
  it('uses the character level (default = points + 50)', () => {
    const def = valuationFor({ vocation: 'paladin', points: 600, monster: null });
    const lvl = valuationFor({ vocation: 'paladin', points: 600, monster: null, character: { level: 1200 } });
    expect(def.level).toBe(650);
    expect(lvl.level).toBe(1200);
    expect(lvl.hp).toBeGreaterThan(def.hp);
    const lowSkill = buildSpellModel('paladin', HUNT, null, { level: 1200, mainSkill: 60 });
    const highSkill = buildSpellModel('paladin', HUNT, null, { level: 1200, mainSkill: 130 });
    expect(highSkill.total).toBeGreaterThan(lowSkill.total);
  });

  it('HP beats mitigation for a level 400 paladin', () => {
    const v = valuationFor({ vocation: 'paladin', points: 350, monster: null, character: { level: 400 } });
    // per dedication point: +3 HP (paladin) vs +0.03 % mitigation multiplier
    expect(hpParts(v, 3).def).toBeGreaterThan(5 * mitigationParts(v, 0.03).def);
    const r = optimize({ vocation: 'paladin', points: 350, monster: null, priority: 80, character: { level: 400 } });
    expect(keys(r)).toContain('rationale.hpOverMitigation');
    expect(r.gemRecommendations.find((g) => g.quality === 'lesser')?.mods[0].name).not.toBe('Mitigation Multiplier');
  });

  it('mitigation becomes competitive for a level 1500 knight at high defense priority', () => {
    const r = optimize({ vocation: 'knight', points: 1450, monster: null, priority: 100, character: { level: 1500 } });
    expect(r.gemRecommendations.find((g) => g.quality === 'lesser')?.mods[0].name).toBe('Mitigation Multiplier');
    const v = valuationFor({ vocation: 'knight', points: 1450, monster: null, character: { level: 1500 } });
    const low = valuationFor({ vocation: 'knight', points: 350, monster: null, character: { level: 400 } });
    const ratio = (x: typeof v) => mitigationParts(x, 0.03).def / hpParts(x, 3).def;
    expect(ratio(v)).toBeGreaterThan(3 * ratio(low));
  });

  it('leech is strongly devalued', () => {
    const v = valuationFor({ vocation: 'knight', points: 1450, monster: null });
    const w = getEngineWheel('knight');
    const leech = w.supremeMods.find((m) => /life leech/i.test(m.name));
    if (!leech) return;
    const facts = { stages: [1, 1, 1, 1], revPoints: [300, 300, 300, 300], wheelEffects: new Map() };
    expect(supremeModParts(v, w.revelations, facts, leech, 4).def).toBeLessThan(hpParts(v, 0.02 * v.hp).def);
  });
});

describe('Revelation Mastery look-ahead', () => {
  it('a Revelation Mastery gem is valued only when it reaches the next stage', () => {
    const v = valuationFor({ vocation: 'knight', points: 1500, monster: null });
    const w = getEngineWheel('knight');
    const rm = w.supremeMods.find((m) => m.category === 'revelationMastery' && m.revelation === w.revelations[0].data.name)!;
    const x = rm.values[3]!;
    const at = (pts: number) => {
      const revPoints = [pts, 0, 0, 0];
      return supremeModParts(v, w.revelations, { stages: revPoints.map((p) => stageFor(p)), revPoints, wheelEffects: new Map() }, rm, 4);
    };
    const close = at(500 - Math.floor(x / 2));
    expect(close.off + close.def).toBeGreaterThan(0);
    const far = at(260);
    expect(stageFor(260 + x)).toBe(stageFor(260));
    expect(far.off + far.def).toBe(0);
  });

  it('an owned RM gem lets the search reach a stage with fewer slice points', () => {
    const w = getEngineWheel('knight');
    const base: OptimizerInput = { vocation: 'knight', points: 1000, monster: null, priority: 20, alternatives: 0 };
    const plain = optimize(base);
    const top = plain.revelations.reduce((a, b) => (b.stage > a.stage ? b : a));
    const rm = w.supremeMods.find((m) => m.category === 'revelationMastery' && m.revelation === top.perk.name)!;
    const gem: OwnedGem = { id: 'g', quality: 'greater', basic1: null, basic2: null, supreme: { modId: rm.id, grade: 4 } };
    const withGem = optimize({ ...base, gems: [gem] });
    const stage = (r: typeof plain) => r.revelations.find((x) => x.perk.name === top.perk.name)!;
    expect(withGem.vessels.some((a) => a.gem?.supreme?.modId === rm.id)).toBe(true);
    const score = (r: typeof plain) => 0.8 * r.offenseScore + 0.2 * r.defenseScore;
    expect(score(withGem)).toBeGreaterThanOrEqual(score(plain));
    expect(stage(withGem).stage).toBeGreaterThan(stage(plain).stage);
  });
});

describe('hunting spots (multi-monster)', () => {
  const fireWeak = monster('fire-weak', { fire: 150, energy: 80 });
  const energyWeak = monster('energy-weak', { energy: 150, fire: 80 });

  it('normalises weights and averages element modifiers', () => {
    const a = normaliseMonsters([{ monster: fireWeak, weight: 3 }, { monster: energyWeak, weight: 1 }], null);
    expect(a.map((m) => m.weight)).toEqual([0.75, 0.25]);
    expect(spotElementMultiplier(a, 'fire')).toBeCloseTo(0.75 * 1.5 + 0.25 * 0.8);
    expect(normaliseMonsters([], fireWeak)).toEqual([{ monster: fireWeak, weight: 1 }]);
  });

  it('scale-free weights give the same build; heavier weight shifts the damage mix', () => {
    const run = (wf: number, we: number) =>
      optimize({
        vocation: 'sorcerer',
        points: 1500,
        monster: null,
        priority: 30,
        context: BOX,
        monsters: [{ monster: fireWeak, weight: wf }, { monster: energyWeak, weight: we }],
      });
    expect(run(3, 1).allocation).toEqual(run(6, 2).allocation);
    const fire = (wf: number, we: number) => {
      const m = buildSpellModel('sorcerer', BOX, [{ monster: fireWeak, weight: wf }, { monster: energyWeak, weight: we }]);
      return damageShare(m, 'Great Fire Wave', NO_STAGES);
    };
    expect(fire(9, 1)).toBeGreaterThan(fire(1, 9));
    expect(keys(run(3, 1))).toContain('rationale.spot');
  });
});

describe('alternatives', () => {
  const dist = (a: Record<string, number>, b: Record<string, number>) => {
    let d = 0;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) d += Math.abs((a[k] ?? 0) - (b[k] ?? 0));
    return d / 2;
  };

  it.each([
    ['paladin', 600, HUNT, 30],
    ['paladin', 600, BOSS, 30],
    ['knight', 1500, BOX, 90],
    ['druid', 2500, BOSS, 50],
  ] as [Vocation, number, FightContext, number][])('%s %i: distinct, labelled alternatives', (vocation, points, context, priority) => {
    const r = optimize({ vocation, points, monster: null, priority, context });
    expect(r.alternatives).toHaveLength(2);
    const builds = [r.allocation, ...r.alternatives!.map((a) => a.result.allocation)];
    for (let i = 0; i < builds.length; i++)
      for (let j = i + 1; j < builds.length; j++) expect(dist(builds[i], builds[j])).toBeGreaterThanOrEqual(Math.max(50, 0.1 * points));
    for (const a of r.alternatives!) {
      expect(a.label).toBeTruthy();
      expect(a.labelMsg?.key).toMatch(/^alt\./);
      expect(a.tradeoffMsg?.key).toBe('alt.tradeoff');
      expect(a.relativeScore).toBeGreaterThan(50);
      expect(a.result.plannerCode).toBeTruthy();
      expect(a.result.pointsUsed).toBeLessThanOrEqual(points);
    }
  });

  it('boss mode builds around the Avatar (main or alternative); count is configurable', () => {
    for (const vocation of ['paladin', 'knight', 'sorcerer'] as const) {
      const r = optimize({ vocation, points: 600, monster: null, priority: 30, context: BOSS, alternatives: 3 });
      const avatar = r.revelations.find((x) => x.perk.name.startsWith("Avatar"))!;
      expect(avatar.stage >= 1 || r.alternatives!.some((a) => a.labelMsg?.key === 'alt.avatarFocus')).toBe(true);
      expect(r.alternatives).toHaveLength(3);
    }
    expect(optimize({ vocation: 'paladin', points: 600, monster: null, priority: 30, alternatives: 0 }).alternatives).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Planner code

const CASES: OptimizerInput[] = [
  { vocation: 'knight', points: 1500, monster: null, priority: 90, context: BOX },
  { vocation: 'paladin', points: 600, monster: null, priority: 30, context: BOSS },
  { vocation: 'sorcerer', points: 2200, monster: null, priority: 20 },
  { vocation: 'druid', points: 800, monster: null, priority: 40 },
  { vocation: 'monk', points: 3300, monster: null, priority: 50, context: BOSS },
];

/** Replays the path from scratch and checks every slice is unlocked when it receives points. */
function pathRespectsUnlocks(vocation: Vocation, path: string[], allocation: Record<string, number>): boolean {
  const cap = Object.fromEntries(getWheelData(vocation).tiles.map((t) => [t.gridId, t.capacity]));
  const unlocked = new Set(WHEEL_DATA.unlockGraph.initiallyUnlocked);
  const pts: Record<number, number> = {};
  for (const id of path) {
    const g = gridForSliceId(id, vocation);
    if (!unlocked.has(g)) return false;
    pts[g] = allocation[id];
    if (pts[g] >= cap[g]) for (const x of WHEEL_DATA.unlockGraph.edges[g] ?? []) unlocked.add(x);
  }
  return true;
}

describe('planner code', () => {
  it.each(CASES.map((c) => [`${c.vocation} ${c.points}`, c] as const))('%s: decodes to the same allocation and gems', (_, input) => {
    const r = optimize(input);
    for (const b of [r, ...r.alternatives!.map((a) => a.result)]) {
      expect(pathRespectsUnlocks(input.vocation, b.path, b.allocation)).toBe(true);
      const d = decodePlannerCode(b.plannerCode!);
      expect(d.vocation).toBe(input.vocation);
      const expected = Object.fromEntries(Object.entries(b.allocation).map(([id, p]) => [gridForSliceId(id, input.vocation), p]));
      expect(d.points).toEqual(expected);
      expect(plannerVesselIssues(input.vocation, d.vessels)).toEqual([]);
    }
  });
});

type NodeMod = Record<string, (...a: unknown[]) => unknown>;
const nodeImport = (m: string) => import(/* @vite-ignore */ m) as Promise<NodeMod>;
const proc = (globalThis as unknown as { process?: { cwd(): string } }).process;
const { existsSync } = await nodeImport('node:fs');
const cachePath = `${proc?.cwd() ?? '.'}/scripts/.cache/wod/skillgrid.cjs`;
const VOC_ENUM: Record<Vocation, string> = { knight: 'Knight', paladin: 'Paladin', sorcerer: 'Sorcerer', druid: 'Druid', monk: 'Monk' };

describe.skipIf(!(existsSync(cachePath) as boolean))('planner code vs official planner WASM', () => {
  it('the official planner loads our codes with the same points', async () => {
    const { createRequire } = await nodeImport('node:module');
    const req = createRequire(import.meta.url) as (p: string) => () => Promise<any>;
    const M = await req(cachePath)();
    for (const input of CASES) {
      const r = optimize(input);
      const planner = new M.SkillwheelPlanner(M.EActiveVocation[VOC_ENUM[input.vocation]]);
      expect(planner.updateByCode(r.plannerCode)).toBe(1);
      const v = planner.getSkillParameters();
      const pts: Record<number, number> = {};
      for (let i = 0; i < v.size(); i++) {
        const t = v.get(i);
        if (t.currentSkillPoints > 0) pts[t.id.value] = t.currentSkillPoints;
      }
      v.delete();
      planner.delete();
      expect(pts).toEqual(Object.fromEntries(Object.entries(r.allocation).map(([id, p]) => [gridForSliceId(id, input.vocation), p])));
    }
  });
});

describe('mana is not preferred over HP (max mana does not raise damage)', () => {
  it.each(['paladin', 'sorcerer', 'druid', 'monk'] as const)('%s lesser gem recommendation is not Mana, even at max DPS priority', (vocation) => {
    for (const priority of [0, 10, 30]) {
      const r = optimize({ vocation, points: 550, monster: null, priority, context: { mode: 'hunt', huntStyle: 'solo' }, character: { level: 600 } });
      const lesser = r.gemRecommendations.find((g) => g.quality === 'lesser');
      expect(lesser?.mods.some((m) => /^Mana$/.test(m.name))).toBe(false);
    }
  });
});
