import { beforeAll, describe, expect, it } from 'vitest';
import { optimize } from '.';
import { autoPresets } from '../data/damage/rotations';
import { getMonsterById, loadMonsterData } from '../lib/api';
import { SPOTS } from '../data/spots';

const HUNT = { monster: null, priority: 0, context: { mode: 'hunt' as const }, alternatives: 0 };
const spot = (name: string) => SPOTS.find((s) => s.name === name)!.monsters.map((m) => ({ monster: getMonsterById(m.id)!, weight: m.weight }));

describe('D103: paladin rotation when the spot takes no holy damage', () => {
  beforeAll(() => loadMonsterData());

  it('offers the exception only on a mostly holy-immune spot', () => {
    expect(autoPresets('paladin', 0.6).map((p) => p.id)).toEqual(['rp-ethereal-rune']);
    expect(autoPresets('paladin', 0.4).map((p) => p.id)).not.toContain('rp-ethereal-rune');
    expect(autoPresets('knight', 1).length).toBeGreaterThan(0);
  });

  it('Energy Library: Ethereal Barrage on cooldown, the best rune for its elements in the other turns', () => {
    const r = optimize({ vocation: 'paladin', points: 1000, monsters: spot('Energy Library'), ...HUNT });
    expect(r.rotation!.presetId).toBe('rp-ethereal-rune');
    const share = new Map(r.rotation!.spells.map((s) => [s.name, s.share]));
    expect(share.get('Ethereal Barrage')).toBeGreaterThan(0);
    expect(share.get('Stone Shower')).toBeGreaterThan(0);
  });

  it('Fire Library keeps the usual rotations', () => {
    const r = optimize({ vocation: 'paladin', points: 1000, monsters: spot('Fire Library'), ...HUNT });
    expect(r.rotation!.presetId).not.toBe('rp-ethereal-rune');
  });

  it('picks the rune of the best element for the spot', () => {
    const r = optimize({ vocation: 'paladin', points: 1000, monsters: spot('Fire Library'), rotationId: 'rp-ethereal-rune', ...HUNT });
    const names = r.rotation!.spells.map((s) => s.name);
    expect(names).toContain('Avalanche');
    expect(names).not.toContain('Stone Shower');
  });
});
