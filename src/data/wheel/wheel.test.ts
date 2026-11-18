import { describe, expect, it } from 'vitest';
import { VOCATIONS } from '../../types';
import { SPELLS, WHEEL_DATA, getSpell, getWheelData, getWheelSpellNames } from './index';

describe('wheel data', () => {
  it.each(VOCATIONS)('%s has 36 tiles with capacities summing to 4000', (v) => {
    const w = getWheelData(v);
    expect(w.tiles).toHaveLength(36);
    expect(w.tiles.map((t) => t.gridId)).toEqual([...Array(36).keys()]);
    expect(w.tiles.reduce((s, t) => s + t.capacity, 0)).toBe(4000);
    for (const q of ['TL', 'TR', 'BL', 'BR'] as const) {
      expect(w.tiles.filter((t) => t.quarter === q).reduce((s, t) => s + t.capacity, 0)).toBe(1000);
    }
    const caps = w.tiles.map((t) => t.capacity);
    expect([50, 75, 100, 150, 200].map((c) => caps.filter((x) => x === c).length)).toEqual([4, 8, 12, 8, 4]);
  });

  it('unlock graph is sane: inner tiles start unlocked, every tile reachable', () => {
    const g = WHEEL_DATA.unlockGraph;
    expect(g.initiallyUnlocked).toEqual([14, 15, 20, 21]);
    const seen = new Set(g.initiallyUnlocked);
    const queue = [...g.initiallyUnlocked];
    while (queue.length) {
      for (const n of g.edges[queue.shift()!]) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
    expect(seen.size).toBe(36);
    for (const [from, tos] of Object.entries(g.edges)) for (const to of tos) expect(to).not.toBe(Number(from));
    for (const corner of [0, 5, 30, 35]) expect(g.edges[corner]).toEqual([]);
  });

  it('revelation thresholds and bonus', () => {
    expect(WHEEL_DATA.revelation.thresholds).toEqual([250, 500, 1000]);
    expect(WHEEL_DATA.revelation.damageHealingBonusPerStage).toEqual([0, 4, 9, 20]);
    expect(WHEEL_DATA.revelationMastery.pointsPerConvictionSlice).toBe(125);
  });

  it.each(VOCATIONS)('%s has 4 revelations, Gift of Life top-left', (v) => {
    const r = getWheelData(v).revelations;
    expect(r).toHaveLength(4);
    expect(r[0].name).toBe('Gift of Life');
    for (const x of r) expect(x.stageTexts).toHaveLength(3);
    expect(r.filter((x) => x.isAvatar)).toHaveLength(1);
  });

  it.each(VOCATIONS)('%s has 8 vessels unlocked by 8 gem vessel slices', (v) => {
    const w = getWheelData(v);
    expect(w.vessels).toHaveLength(8);
    expect(w.vessels.map((x) => x.unlockOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(w.vessels.map((x) => x.quality)).toEqual(['lesser', 'regular', 'greater', 'lesser', 'greater', 'regular', 'greater', 'greater']);
    expect(w.gemVesselTiles).toHaveLength(8);
    expect(w.tiles.filter((t) => t.isGemVessel)).toHaveLength(8);
  });

  it.each(VOCATIONS)('%s mods have 4 grades and valid slots', (v) => {
    const { basic, supreme } = getWheelData(v).mods;
    expect(basic.length).toBeGreaterThan(20);
    expect(supreme.length).toBeGreaterThan(20);
    for (const m of [...basic, ...supreme]) expect(m.gradeValues).toHaveLength(4);
    for (const m of basic) expect(m.slots.length).toBeGreaterThan(0);
    expect(supreme.filter((m) => m.category === 'revelationMastery')).toHaveLength(4);
    for (const m of supreme.filter((x) => x.momentum)) expect(m.momentum).toEqual([0, 0.33, 0.66, 1]);
  });

  it.each(VOCATIONS)('%s augmentations come in pairs', (v) => {
    const aug = getWheelData(v).tiles.filter((t) => t.conviction.category === 'augmentation');
    const counts = new Map<number, number>();
    for (const t of aug) counts.set(t.conviction.id, (counts.get(t.conviction.id) ?? 0) + 1);
    expect([...counts.values()].every((c) => c === 2)).toBe(true);
  });

  it.each(VOCATIONS)('%s: every augment/revelation/supreme spell has metadata', (v) => {
    for (const name of getWheelSpellNames(v)) {
      const s = getSpell(name);
      expect(s, name).toBeDefined();
      expect(s!.vocations).toContain(v);
    }
  });

  it('spell table is consistent', () => {
    expect(new Set(SPELLS.map((s) => s.name)).size).toBe(SPELLS.length);
    for (const s of SPELLS) {
      if (s.area === 'beam') expect(s.avgHitsHuntOuter).toBeDefined();
      if (s.kind === 'damage') expect(s.element).not.toBeNull();
    }
    expect(SPELLS.filter((s) => s.isAvatar)).toHaveLength(5);
    expect(getSpell('death echo')?.isNew).toBe(true);
  });

  it.each(VOCATIONS)('%s reference builds are decoded', (v) => {
    for (const b of getWheelData(v).referenceBuilds.builds) {
      expect(Object.values(b.tiles).reduce((s, x) => s + x, 0)).toBe(b.spent);
    }
  });
});
