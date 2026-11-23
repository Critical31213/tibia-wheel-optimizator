import { describe, expect, it } from 'vitest';
import { getMonsterById } from '.';
import { SPOTS, spotsWithMonster } from './spots';
import { loadMonsterData, spotOf } from '../lib/api';

describe('hunting spots (D99)', () => {
  it('lists known monsters, 2–10 per spot, positive weights', () => {
    expect(SPOTS.length).toBeGreaterThan(150);
    for (const s of SPOTS) {
      expect(s.monsters.length).toBeGreaterThanOrEqual(2);
      expect(s.monsters.length).toBeLessThanOrEqual(10);
      expect(new Set(s.monsters.map((m) => m.id)).size).toBe(s.monsters.length);
      for (const m of s.monsters) {
        expect(getMonsterById(m.id), m.id).toBeDefined();
        expect(m.weight).toBeGreaterThan(0);
      }
    }
  });

  it('weights a spot with creatures of its own by kills, others 1', () => {
    const s = spotsWithMonster('dragolisk')[0];
    expect(s.monsters.map((m) => m.id).sort()).toEqual(['dragolisk', 'mega-dragon', 'wardragon']);
    const w = Object.fromEntries(s.monsters.map((m) => [m.id, m.weight]));
    expect(w['mega-dragon']).toBeLessThan(w.dragolisk);
    expect(spotsWithMonster('hellspawn').some((x) => x.monsters.every((m) => m.weight === 1))).toBe(true);
  });

  it('names the spot only for exactly its monsters', async () => {
    await loadMonsterData();
    const s = spotsWithMonster('dragolisk')[0];
    const ids = s.monsters.map((m) => m.id);
    expect(spotOf([...ids].reverse())?.name).toBe(s.name);
    expect(spotOf(ids.slice(0, 2))).toBeUndefined();
    expect(spotOf([...ids, 'dragon'])).toBeUndefined();
  });

  it('applies the curated names and removals', () => {
    const feru = SPOTS.find((s) => s.name === 'Feru Way');
    expect(feru?.aliases).toContain('Hell Hub');
    expect(SPOTS.some((s) => s.name === 'Hell Hub')).toBe(false);
    expect(SPOTS.find((s) => s.name === 'Nykri Delta')?.monsters.map((m) => m.id).sort()).toEqual(['lamassu', 'sphinx']);
  });

  it('puts the spot where the monster is the largest share first', () => {
    const list = spotsWithMonster('lost-berserker');
    expect(list.length).toBeGreaterThan(1);
    const share = (i: number) => {
      const s = list[i];
      return s.monsters.find((m) => m.id === 'lost-berserker')!.weight / s.monsters.reduce((a, m) => a + m.weight, 0);
    };
    expect(share(0)).toBeGreaterThanOrEqual(share(1));
  });
});
