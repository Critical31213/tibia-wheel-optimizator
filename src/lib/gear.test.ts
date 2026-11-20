import { describe, expect, it } from 'vitest';
import { addPiece, EMPTY_GEAR, gearInput, parseGear, removePiece, sanitizeGear, updatePiece } from './gear';
import { gearEffects, type WornGear } from '../engine/gear';
import { optimize } from '../engine';
import { getWeapon } from '../data/proficiency';
import { getItem, itemsFor, maxTier, SLOT_ITEMS, tierChance } from '../data/equipment';
import { valuationFor, wearBest } from '../engine/optimizer';
import { buildSpellModel } from '../engine/spells';
import { resistParts } from '../engine/values';
import type { GearEffects, Monster, OptimizerInput } from '../types';

const item = (id: string) => getItem(id)!;

describe('equipment data', () => {
  it('has items per slot, usable by vocation', () => {
    expect(itemsFor(SLOT_ITEMS.helmet, 'sorcerer').some((i) => i.id === 'cobra-crown')).toBe(true);
    expect(itemsFor(SLOT_ITEMS.helmet, 'knight').some((i) => i.id === 'cobra-crown')).toBe(false);
    expect(maxTier(4)).toBe(10);
    expect(maxTier(2)).toBe(2);
    expect(maxTier(undefined)).toBe(0);
    expect(tierChance('onslaught', 0)).toBe(0);
    expect(tierChance('onslaught', 1)).toBe(0.5);
  });
});

const worn = (pieces: WornGear['pieces'], weapon: WornGear['weapon'] = null): WornGear => ({ pieces, weapon });

describe('gear storage', () => {
  it('drops unknown or unusable items, bad tiers and duplicate or foreign imbuements', () => {
    const g = sanitizeGear(
      {
        pieces: {
          helmet: [{ itemId: 'cobra-crown', tier: 9 }, { itemId: 'hat-of-the-mad' }],
          legs: [{ itemId: 'nope' }],
          armor: [{ itemId: 'molten-plate' }],
        },
        weapon: { tier: 3, imbues: [{ id: 'strike', level: 3 }, { id: 'strike', level: 1 }, { id: 'slash', level: 2 }, { id: 'vampirism', level: 2 }] },
      },
      'sorcerer',
    );
    expect(g.pieces.helmet).toEqual([{ itemId: 'cobra-crown' }, { itemId: 'hat-of-the-mad' }]);
    expect(g.pieces.legs).toBeUndefined();
    expect(g.pieces.armor).toBeUndefined();
    expect(g.weapon).toEqual({ tier: 3, imbues: [{ id: 'strike', level: 3 }, { id: 'vampirism', level: 2 }] });
    expect(parseGear('{bad', 'sorcerer')).toEqual(EMPTY_GEAR);
    expect(parseGear(JSON.stringify(g), 'sorcerer')).toEqual(g);
  });

  it('reads the single-item format', () => {
    expect(sanitizeGear({ pieces: { helmet: { itemId: 'cobra-crown' } }, weapon: null }, 'druid').pieces.helmet).toEqual([{ itemId: 'cobra-crown' }]);
  });

  it('edits owned items', () => {
    let g = addPiece(addPiece(EMPTY_GEAR, 'legs', item('bast-legs')), 'legs', item('blue-legs'));
    g = updatePiece(g, 'legs', 0, { tier: 2 });
    expect(g.pieces.legs).toEqual([{ itemId: 'bast-legs', tier: 2 }, { itemId: 'blue-legs' }]);
    expect(removePiece(g, 'legs', 0).pieces.legs).toEqual([{ itemId: 'blue-legs' }]);
    expect(removePiece(removePiece(g, 'legs', 0), 'legs', 0).pieces.legs).toBeUndefined();
    expect(gearInput(EMPTY_GEAR)).toBeUndefined();
    expect(gearInput(g)).toEqual({ pieces: g.pieces, weapon: null });
  });
});

describe('gear effects', () => {
  it('sums item and imbuement skills, resistances and tiers', () => {
    const g = worn(
      {
        legs: { itemId: 'bast-legs' },
        helmet: { itemId: 'cobra-crown', imbues: [{ id: 'epiphany', level: 3 }] },
        boots: { itemId: 'void-boots', tier: 2 },
      },
      { tier: 4, imbues: [{ id: 'precision', level: 3 }] },
    );
    const fx = gearEffects(g, 'paladin', null);
    expect(fx.skills.main).toBe(2 + 4);
    expect(fx.resist.energy).toBe(4 + (getItem('void-boots')!.bonus?.resist?.energy ?? 0));
    expect(fx.onslaught).toBeCloseTo(tierChance('onslaught', 4) * (1 + tierChance('amplification', 2) / 100));
    // The weapon is set: only its chosen imbuements count (no Strike, no Vampirism).
    expect(fx.crit).toEqual({ chance: 0, extra: 0 });
    expect(fx.weaponImbues?.lifeLeech).toBe(0);
  });

  it('empty slots keep their default assumption', () => {
    const fx = gearEffects(worn({ legs: { itemId: 'bast-legs' } }), 'paladin', null);
    expect(fx.weaponImbues).toBeUndefined();
    expect(fx.crit).toBeUndefined();
    expect(fx.offhand).toBeUndefined();
    expect(fx.lifeLeech).toBe(50);
  });

  it('knights count the trained melee skill', () => {
    const g = worn({}, { tier: 0, imbues: [{ id: 'chop', level: 3 }] });
    expect(gearEffects(g, 'knight', 'axe').skills.main).toBe(4);
    expect(gearEffects(g, 'knight', 'sword').skills.main).toBe(0);
  });
});

describe('wearing the best owned items', () => {
  const fire: Monster = { id: 'fire', name: 'fire', elementModifiers: {}, damageTypes: ['fire'], maxDamage: 1000 };
  const death: Monster = { ...fire, id: 'death', name: 'death', damageTypes: ['death'] };
  const input = (monster: Monster, priority = 50): OptimizerInput => ({
    vocation: 'paladin',
    points: 400,
    monster: null,
    monsters: [{ monster, weight: 1 }],
    priority,
    character: { level: 400, mainSkill: 110 },
    gear: { pieces: { armor: [{ itemId: 'burial-shroud' }, { itemId: 'lavos-armor' }], legs: [{ itemId: 'blue-legs' }, { itemId: 'bast-legs' }] }, weapon: null },
  });

  it('picks per slot for the spot', () => {
    expect(wearBest(input(fire))!.gear.worn).toEqual({ armor: 1, legs: 1 });
    expect(wearBest(input(death))!.gear.worn).toEqual({ armor: 0, legs: 1 });
  });

  it('skips items above the character level', () => {
    const low = { ...input(fire), character: { level: 100, mainSkill: 80 } };
    expect(wearBest(low)!.gear.worn).toEqual({ armor: 1, legs: 0 });
  });

  it('a two-handed knight weapon takes the shield off', () => {
    const knight = (weaponId: string): OptimizerInput => ({
      vocation: 'knight',
      points: 400,
      monster: null,
      priority: 50,
      meleeSkill: 'axe',
      character: { level: 400, mainSkill: 110, shielding: 100 },
      weapons: [{ weaponId, level: 0 }],
      gear: { pieces: { offhand: [{ itemId: 'prismatic-shield' }] }, weapon: null },
      alternatives: 0,
    });
    const two = optimize(knight('amber-greataxe'));
    expect(two.gear?.offhandOff).toBe(true);
    expect(two.gear?.effects.offhand).toBeUndefined();
    expect(two.gear?.effects.resist.physical).toBeUndefined();
    const one = optimize(knight('amber-axe'));
    expect(one.gear?.offhandOff).toBeUndefined();
    expect(one.gear?.effects.resist.physical).toBe(4);
    // Without the shield the two-handed weapon pays its mitigation.
    const v1 = valuationFor({ ...knight('amber-axe'), equipment: one.gear!.effects, equipmentTwoHanded: two.gear!.effects });
    const lo = (id: string) => ({ weapon: getWeapon(id)!, perks: [] });
    const v2 = valuationFor({ ...knight('amber-axe'), equipment: one.gear!.effects, equipmentTwoHanded: two.gear!.effects }, null, undefined, [], lo('amber-greataxe'));
    const w1 = valuationFor({ ...knight('amber-axe'), equipment: one.gear!.effects, equipmentTwoHanded: two.gear!.effects }, null, undefined, [], lo('amber-axe'));
    expect(v2.mitigation).toBeLessThan(w1.mitigation);
    expect(v2.mitigationRef).toBeCloseTo(w1.mitigationRef);
    expect(v1.mitigation).toBeCloseTo(w1.mitigation);
  });

  it('reports the worn set with the build', () => {
    const r = optimize({ ...input(death), alternatives: 0 });
    expect(r.gear?.worn.armor).toBe(0);
    expect(r.gear?.effects.resist.death).toBe(5);
  });
});

const fx = (patch: Partial<GearEffects>): GearEffects => ({ skills: { main: 0, magic: 0, shielding: 0 }, elementMl: {}, resist: {}, onslaught: 0, ruse: 0, ...patch });

describe('engine with equipment', () => {
  const base = { vocation: 'paladin' as const, points: 600, monster: null, character: { level: 600, mainSkill: 110 } };

  it('adds equipment skills to entered skills', () => {
    const plain = valuationFor(base).model.total;
    const same = valuationFor({ ...base, equipment: fx({}) }).model.total;
    const more = valuationFor({ ...base, equipment: fx({ skills: { main: 10, magic: 0, shielding: 0 } }) }).model.total;
    expect(same).toBeCloseTo(plain);
    expect(more).toBeGreaterThan(plain);
  });

  it('no Strike lowers damage; onslaught raises it', () => {
    const plain = buildSpellModel('knight', { mode: 'hunt' }, null, { level: 600, mainSkill: 110 }).total;
    const noStrike = buildSpellModel('knight', { mode: 'hunt' }, null, { level: 600, mainSkill: 110 }, undefined, undefined,
      fx({ crit: { chance: 0, extra: 0 }, weaponImbues: { critChance: 0, critExtra: 0, lifeLeech: 0, manaLeech: 0 } })).total;
    const onslaught = buildSpellModel('knight', { mode: 'hunt' }, null, { level: 600, mainSkill: 110 }, undefined, undefined, fx({ onslaught: 5 })).total;
    expect(noStrike).toBeLessThan(plain);
    expect(onslaught).toBeCloseTo(plain * 1.03, 3);
  });

  it('weighs resistance against the damage still taken after equipment resistances', () => {
    const v = { ...valuationFor(base), incoming: { fire: 0.5, physical: 0.5 } };
    const plain = resistParts(v, 'fire', 5).def;
    expect(resistParts({ ...v, resist: {} }, 'fire', 5).def).toBeCloseTo(plain);
    // Less physical damage taken: each fire point removes a larger share of what is left.
    expect(resistParts({ ...v, resist: { physical: 20 } }, 'fire', 5).def).toBeGreaterThan(plain);
  });
});
