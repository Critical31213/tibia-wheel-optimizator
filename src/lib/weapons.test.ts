import { describe, expect, it } from 'vitest';
import { getWeapon, SHAPING_OPTIONS, WEAPONS } from '../data/proficiency';
import { translator } from '../i18n';
import { ownWeapon, parseWeaponPrefs, perkLabel, serializeWeaponPrefs, setPerk, setShaped, shapingLabel } from './weapons';

const epee = getWeapon('stellar-moonsilver-epee')!;

describe('weapon prefs (D47)', () => {
  it('round-trips and sanitizes stored weapons', () => {
    const own = setShaped(setPerk(ownWeapon(epee), 1, 2), 2, 'alphaStrike', 1);
    const prefs = { weapons: [own], suggest: true };
    expect(parseWeaponPrefs(serializeWeaponPrefs(prefs), 'knight')).toEqual(prefs);
    // Other vocation, unknown ids, duplicates, bad levels / perks / reshapes are dropped.
    const raw = JSON.stringify({
      weapons: [own, own, { weaponId: 'nope', level: 3 }, { weaponId: epee.id, level: 99 }, { weaponId: 'grand-sanguine-bow', level: 7 }],
      suggest: 'yes',
    });
    expect(parseWeaponPrefs(raw, 'knight')).toEqual({ weapons: [own], suggest: false });
    expect(parseWeaponPrefs(JSON.stringify({ weapons: [{ weaponId: epee.id, level: 9, perks: [5], shaped: [{ level: 1, replaces: 0, option: 'x' }] }] }), 'knight').weapons)
      .toEqual([{ weaponId: epee.id, level: 0 }]);
    expect(parseWeaponPrefs('{bad', 'knight')).toEqual({ weapons: [], suggest: false });
  });

  it('keeps a tier and imbuements per weapon within its limits (D81)', () => {
    const imbues = [{ id: 'strike', level: 3 }, { id: 'chop', level: 3 }, { id: 'vampirism', level: 2 }, { id: 'void', level: 3 }, { id: 'frost', level: 3 }];
    const read = (weaponId: string, vocation: 'knight' | 'monk' | 'druid', gear: unknown) =>
      parseWeaponPrefs(JSON.stringify({ weapons: [{ weaponId, level: 0, gear }] }), vocation).weapons[0].gear;
    // Amber Greataxe: 2 slots, native axe skill and earth damage (no Chop, no Frost).
    expect(read('amber-greataxe', 'knight', { tier: 10, imbues })).toEqual({ tier: 10, imbues: [{ id: 'strike', level: 3 }, { id: 'vampirism', level: 2 }] });
    // Soulkamas: 3 slots, native fist (no Fist imbuement); the elemental bond allows damage imbuements.
    const monk = read('soulkamas', 'monk', { tier: 2, imbues: [{ id: 'fist', level: 3 }, ...imbues] });
    expect(monk?.imbues.map((x) => x.id)).toEqual(['strike', 'vampirism', 'void']);
    expect(read('soulkamas', 'monk', undefined)).toBeUndefined();
    expect(read('amber-greataxe', 'knight', { tier: 11, imbues: [] })?.tier).toBe(0);
    // D83: native life leech (Cobra Rod) blocks Vampirism, native crit (Lion Rod) blocks Strike, as on TibiaWiki.
    const mage = [{ id: 'strike', level: 3 }, { id: 'vampirism', level: 3 }, { id: 'void', level: 3 }];
    expect(read('cobra-rod', 'druid', { tier: 0, imbues: mage })?.imbues.map((x) => x.id)).toEqual(['strike', 'void']);
    expect(read('lion-rod', 'druid', { tier: 0, imbues: mage })?.imbues.map((x) => x.id)).toEqual(['vampirism', 'void']);
  });

  it('edits perks and reshapes', () => {
    const o = setPerk(ownWeapon(epee), 2, 1);
    expect(o.perks?.[2]).toBe(1);
    expect(setPerk(o, 2, null).perks).toBeUndefined();
    const s = setShaped(setShaped(o, 3, 'omegaStrike'), 1, 'alphaStrike');
    expect(s.shaped?.map((x) => x.level)).toEqual([1, 3]);
    expect(setShaped(setShaped(s, 1, null), 3, null).shaped).toBeUndefined();
  });

  it('labels every perk and shaping option in both languages', () => {
    for (const lang of ['en', 'pl'] as const) {
      const t = translator(lang);
      for (const p of WEAPONS.flatMap((w) => w.levels.flat())) expect(perkLabel(t, p)).not.toMatch(/perk\.|\{|undefined|NaN/);
      for (const o of SHAPING_OPTIONS) expect(shapingLabel(t, o)).not.toMatch(/perk\.|\{|undefined|NaN/);
    }
    const t = translator('en');
    expect(perkLabel(t, { kind: 'augment', value: -2, spell: 'Front Sweep', augment: 'cooldown' })).toBe('Front Sweep: −2 s cooldown');
    expect(perkLabel(t, { kind: 'bestiary', value: 0.03, bestiary: 'Dragon' })).toBe('+3% damage vs Dragon');
    expect(shapingLabel(t, SHAPING_OPTIONS.find((o) => o.kind === 'alphaStrike')!, 10)).toBe('Alpha strike +10%');
  });
});
