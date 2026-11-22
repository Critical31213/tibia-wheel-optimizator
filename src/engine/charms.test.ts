import { describe, expect, it } from 'vitest';
import { optimize } from '.';
import { getMonsterById } from '../data';
import { charmModel } from './spells';
import { ownedCharms } from './charms';
import { sanitizeGear } from '../lib/gear';
import type { OwnedCharm } from '../types';

const spot = ['dragon-lord', 'dragon', 'demon', 'hydra'].map((id) => ({ monster: getMonsterById(id)!, weight: 1 }));
const ALL: OwnedCharm[] = (['wound', 'enflame', 'poison', 'freeze', 'zap', 'curse', 'divineWrath', 'overpower', 'overflux', 'carnage', 'lowBlow', 'savageBlow'] as const).map((id) => ({ id, stage: 3 }));
const base = { vocation: 'druid' as const, points: 900, monster: null, monsters: spot, priority: 0, context: { mode: 'hunt' as const }, alternatives: 0, character: { level: 800 } };

describe('D93: charms', () => {
  it('no charms: the build is unchanged', () => {
    expect(optimize({ ...base, charms: [] })).toEqual(optimize(base));
  });

  it('each charm on one creature, each creature one charm; damage and rationale include them', () => {
    const r = optimize({ ...base, charms: ALL });
    const picks = r.charms!;
    expect(picks.length).toBe(4);
    expect(new Set(picks.map((p) => p.id)).size).toBe(picks.length);
    expect(new Set(picks.map((p) => p.monsterId)).size).toBe(picks.length);
    expect(picks.every((p) => p.gain > 0)).toBe(true);
    expect(r.rotation!.window!.charms).toBeGreaterThan(0);
    expect(r.rotation!.window!.total).toBeGreaterThan(optimize(base).rotation!.window!.total);
    expect(r.rationaleMsgs?.some((m) => m.key === 'rationale.charms')).toBe(true);
  });

  it('an elemental charm follows the creature: Freeze, not Enflame, on fire-immune dragons', () => {
    const r = optimize({ ...base, monsters: [spot[0]], charms: [{ id: 'enflame', stage: 3 }, { id: 'freeze', stage: 3 }] });
    expect(r.charms!.map((p) => p.id)).toEqual(['freeze']);
  });

  it('charm model: 5 % of the creature HP capped at 2 × level, element applied after the cap; crit charms weighted', () => {
    const dl = spot[0].monster;
    const at = (level: number) => charmModel('druid', level, { mode: 'hunt' }, [{ monster: dl, weight: 1 }], [{ id: 'freeze', stage: 3, monsterId: dl.id }])!.perHit;
    expect(at(800)).toBeCloseTo(0.11 * 95 * 1.1, 6);
    expect(at(40)).toBeCloseTo(0.11 * 80 * 1.1, 6);
    const half = [{ monster: dl, weight: 0.5 }, { monster: spot[1].monster, weight: 0.5 }];
    expect(charmModel('druid', 800, { mode: 'hunt' }, half, [{ id: 'lowBlow', stage: 3, monsterId: dl.id }])!.critChance).toBeCloseTo(4.5, 6);
  });

  it('D95: crit charms reach auto attacks of a proficiency weapon; gains are on the built wheel', () => {
    const pal = { ...base, vocation: 'paladin' as const, monsters: [spot[0]], character: { level: 800 }, weapons: [{ weaponId: 'sanguine-bow', level: 7 }] };
    const plain = optimize(pal);
    const r = optimize({ ...pal, charms: [{ id: 'lowBlow', stage: 3 }] });
    expect(r.charms!.map((p) => p.id)).toEqual(['lowBlow']);
    // +9 pp crit chance: at least ×(1 + 0.19 × 0.5) / (1 + 0.1 × 0.5) on auto attacks (the bow's perks add crit damage).
    expect(r.rotation!.window!.autoAttack / plain.rotation!.window!.autoAttack).toBeGreaterThan(1.095 / 1.05);
    expect(r.charms![0].gain).toBeGreaterThan(0);
    expect(r.rotation!.window!.total).toBeGreaterThan(plain.rotation!.window!.total * (1 + r.charms![0].gain / 200));
  });

  it('owned charms and stored prefs: known ids, valid stages, no duplicates', () => {
    expect(ownedCharms([{ id: 'zap', stage: 1 }, { id: 'zap', stage: 3 }, { id: 'nope' as 'zap', stage: 2 }, { id: 'wound', stage: 4 as 3 }])).toEqual([{ id: 'zap', stage: 3 }]);
    expect(sanitizeGear({ charms: [{ id: 'carnage', stage: 2 }, { id: 'carnage', stage: 1 }, { id: 'x', stage: 1 }] }, 'druid').charms).toEqual([{ id: 'carnage', stage: 2 }]);
  });
});
