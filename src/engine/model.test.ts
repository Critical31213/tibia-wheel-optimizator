import { describe, expect, it } from 'vitest';
import { VOCATIONS } from '../types';
import { getWheelData, WHEEL_DATA } from '../data/wheel';
import { getWheel } from './index';
import { DOMAIN_ORDER, getEngineWheel, isAvailable, stageFor } from './wheel/build';
import { ENGINE_MESSAGES, renderMessage } from './messages';

describe.each(VOCATIONS)('wheel model: %s', (vocation) => {
  const w = getEngineWheel(vocation);
  const def = getWheel(vocation);

  it('has 36 slices, 4×50 8×75 12×100 8×150 4×200 = 4000, 1000 per domain', () => {
    expect(def.slices).toHaveLength(36);
    expect(def.totalCapacity).toBe(4000);
    const byRing = new Map<number, number[]>();
    for (const s of def.slices) byRing.set(s.ring, [...(byRing.get(s.ring) ?? []), s.capacity]);
    expect([1, 2, 3, 4, 5].map((r) => byRing.get(r)!.length)).toEqual([4, 8, 12, 8, 4]);
    expect([1, 2, 3, 4, 5].map((r) => new Set(byRing.get(r)))).toEqual([50, 75, 100, 150, 200].map((c) => new Set([c])));
    for (const d of DOMAIN_ORDER) {
      expect(def.slices.filter((s) => s.domain === d).reduce((a, s) => a + s.capacity, 0)).toBe(1000);
    }
  });

  it('indexInRing runs clockwise from 12 o\'clock with consistent domains', () => {
    for (const s of def.slices) {
      const perDomain = s.slicesInRing / 4;
      expect(DOMAIN_ORDER[Math.floor(s.indexInRing / perDomain)]).toBe(s.domain);
    }
    for (const ring of [1, 2, 3, 4, 5]) {
      const idx = def.slices.filter((s) => s.ring === ring).map((s) => s.indexInRing).sort((a, b) => a - b);
      expect(idx).toEqual(idx.map((_, k) => k));
    }
  });

  it('uses the directed unlock graph of the planner; adjacency is its undirected version', () => {
    const edges = WHEEL_DATA.unlockGraph.edges;
    for (const s of w.slices) {
      const expected = Object.entries(edges)
        .filter(([, tos]) => tos.includes(s.idx))
        .map(([from]) => Number(from))
        .sort((a, b) => a - b);
      expect(s.unlockedBy).toEqual(expected);
      expect(s.initiallyUnlocked).toBe([14, 15, 20, 21].includes(s.idx));
      for (const a of s.slice.adjacent) expect(def.slices.find((x) => x.id === a)!.adjacent).toContain(s.slice.id);
    }
    const empty = new Array(36).fill(0);
    expect(w.slices.filter((s) => isAvailable(w, empty, s.idx)).map((s) => s.idx)).toEqual([14, 15, 20, 21]);
  });

  it('a slice unlocks its neighbours only when completely filled', () => {
    const alloc = new Array(36).fill(0);
    const target = WHEEL_DATA.unlockGraph.edges['14'][0];
    alloc[14] = 49;
    expect(isAvailable(w, alloc, target)).toBe(false);
    alloc[14] = 50;
    expect(isAvailable(w, alloc, target)).toBe(true);
    expect(isAvailable(w, alloc, 14)).toBe(false);
  });

  it('pairs every augment with exactly one twin', () => {
    const augs = w.slices.filter((s) => s.kind === 'augment');
    expect(augs.length).toBe(10);
    for (const s of augs) {
      expect(s.twin).toBeGreaterThanOrEqual(0);
      expect(w.slices[s.twin].twin).toBe(s.idx);
      expect(w.slices[s.twin].tile.conviction.name).toBe(s.tile.conviction.name);
    }
  });

  it('fills vessels (8, planner qualities and unlock order) and mods', () => {
    expect(def.vessels.map((v) => v.quality)).toEqual(WHEEL_DATA.vessels.list.map((v) => v.quality));
    expect(def.vessels.map((v) => v.unlockOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(def.vessels.map((v) => v.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(w.vesselTiles).toHaveLength(8);
    const data = getWheelData(vocation);
    expect(def.mods.filter((m) => m.kind === 'basic')).toHaveLength(data.mods.basic.length);
    expect(def.mods.filter((m) => m.kind === 'supreme')).toHaveLength(data.mods.supreme.length);
    for (const m of def.mods) {
      expect(m.gradeValues).toHaveLength(4);
      if (m.kind === 'basic') expect(m.slots!.length).toBeGreaterThan(0);
    }
    const rm = def.mods.filter((m) => m.kind === 'supreme' && m.name.startsWith('Revelation Mastery'));
    expect(rm.length).toBe(4);
    for (const m of rm) expect(def.revelations.map((r) => r.name)).toContain(m.target);
  });

  it('has 4 revelations in clockwise domain order with thresholds 250/500/1000', () => {
    expect(def.revelations.map((r) => r.domain)).toEqual(DOMAIN_ORDER);
    for (const r of def.revelations) expect(r.thresholds).toEqual([250, 500, 1000]);
    expect(def.revelations.filter((r) => /^Avatar of/.test(r.name))).toHaveLength(1);
  });
});

describe('stages and messages', () => {
  it('stageFor uses 250/500/1000', () => {
    expect([0, 249, 250, 499, 500, 999, 1000, 1350].map((p) => stageFor(p))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('renders message templates and keeps unknown placeholders', () => {
    expect(renderMessage({ key: 'rationale.priority', params: { priority: 30, offense: 70, defense: 30 } })).toBe(
      'Priority 30/100: offense weighted 70%, survivability 30%.',
    );
    expect(renderMessage({ key: 'spell.immune', params: { monster: 'X' } })).toBe('X is immune to {element}.');
    for (const [key, tpl] of Object.entries(ENGINE_MESSAGES)) {
      expect(key).toMatch(/^[a-z]+\.[A-Za-z]+$/);
      expect(tpl.length).toBeGreaterThan(0);
    }
  });
});
