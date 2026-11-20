import { describe, expect, it } from 'vitest';
import { EMPTY_GEAR, gearEffects, parseGear, sanitizeGear, setPiece, updatePiece, type GearPrefs } from './gear';
import { getItem, itemsFor, maxTier, SLOT_ITEMS, tierChance } from '../data/equipment';
import { valuationFor } from '../engine/optimizer';
import { buildSpellModel } from '../engine/spells';
import { resistParts } from '../engine/values';
import type { GearEffects } from '../types';

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

describe('gear storage', () => {
  it('drops unknown or unusable items, bad tiers and duplicate or foreign imbuements', () => {
    const g = sanitizeGear(
      {
        pieces: {
          helmet: { itemId: 'cobra-crown', tier: 9 },
          legs: { itemId: 'nope' },
          armor: { itemId: 'molten-plate' },
        },
        weapon: { tier: 3, imbues: [{ id: 'strike', level: 3 }, { id: 'strike', level: 1 }, { id: 'slash', level: 2 }, { id: 'vampirism', level: 2 }] },
      },
      'sorcerer',
    );
    expect(g.pieces.helmet).toEqual({ itemId: 'cobra-crown' });
    expect(g.pieces.legs).toBeUndefined();
    expect(g.pieces.armor).toBeUndefined();
    expect(g.weapon).toEqual({ tier: 3, imbues: [{ id: 'strike', level: 3 }, { id: 'vampirism', level: 2 }] });
    expect(parseGear('{bad', 'sorcerer')).toEqual(EMPTY_GEAR);
    expect(parseGear(JSON.stringify(g), 'sorcerer')).toEqual(g);
  });

  it('edits pieces', () => {
    let g = setPiece(EMPTY_GEAR, 'legs', item('bast-legs'));
    g = updatePiece(g, 'legs', { tier: 2 });
    expect(g.pieces.legs).toEqual({ itemId: 'bast-legs', tier: 2 });
    expect(setPiece(g, 'legs', null).pieces.legs).toBeUndefined();
  });
});

describe('gear effects', () => {
  it('none until something is set', () => {
    expect(gearEffects(EMPTY_GEAR, 'paladin', null, 'slot')).toBeUndefined();
  });

  it('sums item and imbuement skills, resistances and tiers', () => {
    const g: GearPrefs = {
      pieces: {
        legs: { itemId: 'bast-legs' },
        helmet: { itemId: 'cobra-crown', imbues: [{ id: 'epiphany', level: 3 }] },
        boots: { itemId: 'void-boots', tier: 2 },
      },
      weapon: { tier: 4, imbues: [{ id: 'precision', level: 3 }] },
    };
    const fx = gearEffects(g, 'paladin', null, 'slot')!;
    expect(fx.skills.main).toBe(2 + 4);
    expect(fx.resist.energy).toBe(4 + (getItem('void-boots')!.bonus?.resist?.energy ?? 0));
    expect(fx.onslaught).toBeCloseTo(tierChance('onslaught', 4) * (1 + tierChance('amplification', 2) / 100));
    // The weapon is set: only its chosen imbuements count (no Strike, no Vampirism).
    expect(fx.crit).toEqual({ chance: 0, extra: 0 });
    expect(fx.weaponImbues?.lifeLeech).toBe(0);
  });

  it('empty slots keep the default per slot or count as empty', () => {
    const g = setPiece(EMPTY_GEAR, 'legs', item('bast-legs'));
    const slot = gearEffects(g, 'paladin', null, 'slot')!;
    const all = gearEffects(g, 'paladin', null, 'all')!;
    expect(slot.weaponImbues).toBeUndefined();
    expect(slot.offhand).toBeUndefined();
    expect(slot.lifeLeech).toBeGreaterThan(0);
    expect(all.weaponImbues).toEqual({ critChance: 0, critExtra: 0, lifeLeech: 0, manaLeech: 0 });
    expect(all.offhand).toEqual({ kind: 'none', defense: 0 });
    expect(all.lifeLeech).toBe(0);
  });

  it('knights count the trained melee skill', () => {
    const g: GearPrefs = { pieces: {}, weapon: { tier: 0, imbues: [{ id: 'chop', level: 3 }] } };
    expect(gearEffects(g, 'knight', 'axe', 'slot')!.skills.main).toBe(4);
    expect(gearEffects(g, 'knight', 'sword', 'slot')!.skills.main).toBe(0);
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
