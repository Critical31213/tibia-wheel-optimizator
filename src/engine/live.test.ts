import { describe, expect, it } from 'vitest';
import { type OptimizerInput, type OwnedGem, VOCATIONS, type Vocation } from '../types';
import { getWheelData } from '../data/wheel';
import { decodePlannerCode } from '../data/wheel/plannerCode';
import { optimize } from './index';
import { activeSlots, matchBonus } from './gems';
import { getEngineWheel, nextVesselKey, resonanceOf, vesselKeyOf, vesselSpots } from './wheel/build';

/** D88: live wheel (www.tibia.com, Vessel Resonance). */
function gemsFor(vocation: Vocation): OwnedGem[] {
  const { basic, supreme } = getWheelData(vocation, 'live').mods;
  const b1 = basic.filter((m) => m.slots.includes(1));
  const b2 = basic.filter((m) => m.slots.includes(2));
  return [
    { id: 'g', quality: 'greater', basic1: { modId: b1[0].id, grade: 2 }, basic2: { modId: b2[3].id, grade: 2 }, supreme: { modId: supreme[8].id, grade: 2 } },
    { id: 'r', quality: 'regular', basic1: { modId: b1[1].id, grade: 1 }, basic2: { modId: b2[5].id, grade: 1 }, supreme: null },
    { id: 'l', quality: 'lesser', basic1: { modId: b1[2].id, grade: 1 }, basic2: null, supreme: null },
  ];
}

const input = (vocation: Vocation, points: number): OptimizerInput => ({
  vocation,
  points,
  monster: null,
  priority: 50,
  context: { mode: 'hunt' },
  gems: gemsFor(vocation),
  wheelVariant: 'live',
  alternatives: 0,
});

describe('D88: live wheel (Vessel Resonance)', () => {
  it('has one vessel per domain, 3 Gem Vessel slices each and no Revelation Mastery slices', () => {
    for (const v of VOCATIONS) {
      const w = getEngineWheel(v, 'live');
      expect(w.gemSystem).toBe('resonance');
      expect(w.definition.vessels.map((x) => x.domain)).toEqual(['topLeft', 'topRight', 'bottomLeft', 'bottomRight']);
      for (let d = 0; d < 4; d++) expect(w.vesselTiles.filter((i) => w.slices[i].domainIdx === d)).toHaveLength(3);
      expect(w.slices.some((s) => s.kind === 'rm')).toBe(false);
      expect(getEngineWheel(v).gemSystem).toBe('global');
    }
  });

  it('resonance n activates the first n slots; a matching quality adds +1 (+2 greater)', () => {
    expect(activeSlots('greater', 'lesser', true)).toEqual(['basic1']);
    expect(activeSlots('lesser', 'greater', true)).toEqual(['basic1']);
    expect(activeSlots('greater', 'regular', true)).toEqual(['basic1', 'basic2']);
    expect(activeSlots('greater', 'regular')).toEqual([]);
    expect([matchBonus('lesser', 'lesser', true), matchBonus('regular', 'regular', true), matchBonus('greater', 'greater', true)]).toEqual([1, 1, 2]);
    expect(matchBonus('regular', 'greater', true) + matchBonus('greater', 'greater', false)).toBe(0);
  });

  it('vessel state keys count filled Gem Vessel slices per domain (max III)', () => {
    const w = getEngineWheel('knight', 'live');
    let key = 0;
    for (let k = 0; k < 4; k++) key = nextVesselKey(w, key, 2);
    expect(resonanceOf(key, 2)).toBe(3);
    const alloc = w.slices.map((s) => (s.kind === 'vessel' && s.domainIdx === 1 ? s.capacity : 0));
    const spots = vesselSpots(w, vesselKeyOf(w, alloc));
    expect(spots.map((s) => [s.resonance, s.unlocked])).toEqual(
      w.definition.vessels.map((v) => (v.domain === 'bottomRight' ? [3, true] : [0, false])),
    );
  });

  it('builds export a version 0 code with gems in their domain vessels', () => {
    for (const v of VOCATIONS) {
      const r = optimize(input(v, 1500));
      expect(r.wheelVariant).toBe('live');
      expect(r.vessels).toHaveLength(4);
      const code = decodePlannerCode(r.plannerCode!);
      expect(code).toMatchObject({ variant: 'live', vocation: v });
      const w = getEngineWheel(v, 'live');
      for (const vs of r.vessels) {
        const d = w.revelations.findIndex((x) => x.perk.domain === vs.domain);
        const full = w.vesselTiles.filter((i) => w.slices[i].domainIdx === d && (r.allocation[w.slices[i].slice.id] ?? 0) >= w.slices[i].capacity);
        expect(vs.resonance).toBe(full.length);
        if (vs.gem) expect(code.vessels.find((x) => x.vesselId === vs.vesselId)?.basic1).toBe(vs.gem.basic1?.modId);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Against the live planner WASM (gitignored cache; skipped when absent).

type NodeMod = Record<string, (...a: unknown[]) => unknown>;
const nodeImport = (m: string) => import(/* @vite-ignore */ m) as Promise<NodeMod>;
const proc = (globalThis as unknown as { process?: { cwd(): string } }).process;
const { existsSync } = await nodeImport('node:fs');
const cachePath = `${proc?.cwd() ?? '.'}/scripts/.cache/wod-live/skillgrid.cjs`;
const hasWasm = existsSync(cachePath) as boolean;
const VOC_ENUM: Record<Vocation, string> = { knight: 'Knight', paladin: 'Paladin', sorcerer: 'Sorcerer', druid: 'Druid', monk: 'Monk' };

describe.skipIf(!hasWasm)('D88: live builds vs the live planner WASM', () => {
  it('the planner loads the code with the same resonance, gems and damage & healing', async () => {
    const { createRequire } = await nodeImport('node:module');
    const req = createRequire(import.meta.url) as (p: string) => () => Promise<any>;
    const M = await req(cachePath)();
    const arr = (v: any) => {
      const a: any[] = [];
      for (let i = 0; i < v.size(); i++) a.push(v.get(i));
      v.delete();
      return a;
    };
    for (const v of VOCATIONS)
      for (const points of [300, 900, 2000, 4000]) {
        const r = optimize(input(v, points));
        const p = new M.SkillwheelPlanner(M.EActiveVocation[VOC_ENUM[v]]);
        expect(p.updateByCode(r.plannerCode)).toBeTruthy();
        expect(decodePlannerCode(p.getCode())).toEqual(decodePlannerCode(r.plannerCode!));
        expect(p.getSpentSkillPoints()).toBe(r.pointsUsed);
        const corners = arr(p.getCornerParameters());
        for (const vs of r.vessels) {
          const c = corners.find((x) => x.id.value === vs.vesselId);
          expect(c.vesselLevel, `${v} ${points} vessel ${vs.vesselId}`).toBe(vs.resonance);
          expect(c.hasGem).toBe(!!vs.gem);
        }
        const flat = r.stats.find((s) => s.labelMsg?.key === 'stat.flatBonus')?.value ?? '+0';
        expect(Number(flat), `${v} ${points} damage & healing`).toBe(p.getGridDamageAndHealingBonus() + p.getVesselsDamageAndHealingBonus());
        p.delete();
      }
  }, 60_000);
});
