import { describe, expect, it } from 'vitest';
import type { ModDefinition, OwnedGem } from '../types';
import { createGem, gemsStorageKey, modsForSlot, normalizeGem, parseGems, serializeGems, slotsForQuality } from './gems';

const MODS: ModDefinition[] = [
  { id: 0, kind: 'basic', name: 'A', category: 'offense', gradeValues: [], slots: [1] },
  { id: 1, kind: 'basic', name: 'B', category: 'defense', gradeValues: [], slots: [2] },
  { id: 2, kind: 'basic', name: 'C', category: 'utility', gradeValues: [] },
  { id: 0, kind: 'supreme', name: 'S', category: 'offense', gradeValues: [] },
];

const full: OwnedGem = {
  id: 'x',
  quality: 'greater',
  basic1: { modId: 0, grade: 2 },
  basic2: { modId: 1, grade: 4 },
  supreme: { modId: 0, grade: 1 },
};

describe('gem slot rules', () => {
  it('maps quality to slots', () => {
    expect(slotsForQuality('lesser')).toEqual(['basic1']);
    expect(slotsForQuality('regular')).toEqual(['basic1', 'basic2']);
    expect(slotsForQuality('greater')).toEqual(['basic1', 'basic2', 'supreme']);
  });

  it('filters mods per slot', () => {
    expect(modsForSlot(MODS, 'basic1').map((m) => m.name)).toEqual(['A', 'C']);
    expect(modsForSlot(MODS, 'basic2').map((m) => m.name)).toEqual(['B', 'C']);
    expect(modsForSlot(MODS, 'supreme').map((m) => m.name)).toEqual(['S']);
  });

  it('clears slots on quality downgrade', () => {
    expect(normalizeGem({ ...full, quality: 'lesser' })).toEqual({ ...full, quality: 'lesser', basic2: null, supreme: null });
    expect(normalizeGem(full)).toEqual(full);
    expect(createGem('regular', 'id')).toEqual({ id: 'id', quality: 'regular', basic1: null, basic2: null, supreme: null });
  });
});

describe('gem persistence', () => {
  it('round-trips', () => {
    expect(parseGems(serializeGems([full]))).toEqual([full]);
  });

  it('drops invalid data', () => {
    expect(parseGems(null)).toEqual([]);
    expect(parseGems('{oops')).toEqual([]);
    expect(parseGems('{"a":1}')).toEqual([]);
    const parsed = parseGems(
      JSON.stringify([
        { id: 'a', quality: 'epic' },
        { id: 'b', quality: 'lesser', basic1: { modId: 3, grade: 9 }, basic2: { modId: 1, grade: 2 } },
        { id: 'b', quality: 'regular', basic1: { modId: -1 } },
      ]),
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ id: 'b', quality: 'lesser', basic1: { modId: 3, grade: 1 }, basic2: null, supreme: null });
    expect(parsed[1].id).not.toBe('b');
    expect(parsed[1].basic1).toBeNull();
  });

  it('uses a per-vocation storage key', () => {
    expect(gemsStorageKey('druid')).not.toBe(gemsStorageKey('knight'));
  });
});
