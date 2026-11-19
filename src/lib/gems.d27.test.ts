import { describe, expect, it } from 'vitest';
import type { OwnedGem } from '../types';
import { gemFromRecommendation, sanitizeGems, setModGrade, updateGem } from './gems';

const gem = (id: string, hp: number, grade: 1 | 2 | 3 | 4): OwnedGem => ({ id, quality: 'regular', basic1: { modId: hp, grade }, basic2: null, supreme: null });

describe('D27 gem helpers', () => {
  it('a grade edit applies to every gem with the mod', () => {
    const out = updateGem([gem('a', 1, 1), gem('b', 1, 1), gem('c', 2, 1)], { ...gem('a', 1, 3) });
    expect(out.map((g) => g.basic1!.grade)).toEqual([3, 3, 1]);
  });
  it('a newly picked mod takes the character grade', () => {
    const out = updateGem([gem('a', 1, 4), gem('b', 2, 1)], gem('b', 1, 1));
    expect(out[1].basic1!.grade).toBe(4);
  });
  it('loading and adding use the shared grade', () => {
    expect(sanitizeGems([gem('a', 1, 2), gem('b', 1, 4)]).map((g) => g.basic1!.grade)).toEqual([4, 4]);
    const added = gemFromRecommendation({ quality: 'lesser', mods: [{ kind: 'basic', modId: 1, name: 'HP', grade: 1 }], gain: 1, reason: '' }, [gem('a', 1, 3)]);
    expect(added.basic1!.grade).toBe(3);
    expect(setModGrade([gem('a', 1, 1), gem('b', 2, 1)], 'basic', 1, 2).map((g) => g.basic1!.grade)).toEqual([2, 1]);
  });
});
