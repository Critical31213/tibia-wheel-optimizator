import { describe, expect, it } from 'vitest';
import { optimize } from '.';
import { getExcludableSpells } from '../lib/api';

const HUNT = { vocation: 'paladin' as const, points: 900, monster: null, priority: 0, context: { mode: 'hunt' as const }, alternatives: 0 };
const cast = (r: ReturnType<typeof optimize>) => r.rotation!.spells.map((s) => s.name);
const augments = (r: ReturnType<typeof optimize>, spell: string) => r.convictions.filter((c) => c.name.startsWith(`Augmented ${spell}`)).length;

describe('D92: excluded spells', () => {
  it('Divine Grenade and Divine Empowerment: never cast, their revelations only for the flat bonus', () => {
    const base = optimize(HUNT);
    expect(cast(base)).toContain('Divine Grenade');
    const r = optimize({ ...HUNT, excludedSpells: ['Divine Grenade', 'Divine Empowerment'] });
    expect(cast(r)).not.toContain('Divine Grenade');
    expect(augments(r, 'Divine Empowerment')).toBe(0);
    // The points go elsewhere: the build changes.
    expect(r.convictions).not.toEqual(base.convictions);
    expect(r.rationaleMsgs?.some((m) => m.key === 'rationale.excluded')).toBe(true);
    expect(r.spells.find((s) => s.name === 'Divine Grenade')).toMatchObject({ useful: false, reasonMsg: { key: 'spell.excluded' } });
  });

  it('an excluded rotation spell leaves the rotation; `or` alternatives fall back to the other element', () => {
    const r = optimize({ ...HUNT, excludedSpells: ['Divine Caldera'] });
    expect(cast(r)).not.toContain('Divine Caldera');
    const ed = optimize({ ...HUNT, vocation: 'druid', rotationId: 'ed-forks', excludedSpells: ['Eternal Winter'] });
    expect(cast(ed)).not.toContain('Eternal Winter');
    expect(cast(ed)).toContain('Wrath of Nature');
  });

  it('the excludable list covers revelation and rotation spells', () => {
    expect(getExcludableSpells('paladin')).toEqual(expect.arrayContaining(['Divine Grenade', 'Divine Empowerment', 'Divine Caldera']));
  });
});
