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
