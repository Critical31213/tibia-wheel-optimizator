import { describe, expect, it } from 'vitest';
import { optimize } from '.';
import { cooldownTurns } from './spells';

const HUNT = { monster: null, priority: 0, context: { mode: 'hunt' as const }, alternatives: 0 };
const augs = (r: ReturnType<typeof optimize>, name: string) => r.convictions.filter((c) => c.name.startsWith(`Augmented ${name}`)).length;
const keys = (r: ReturnType<typeof optimize>) => (r.rationaleMsgs ?? []).map((m) => m.key);

describe('D65: preset cooldowns on the 2 s turn grid', () => {
  it('casts land on 2 s turns: a cooldown is rounded up to whole turns', () => {
    expect([2, 3, 4, 5, 6, 7, 8].map(cooldownTurns)).toEqual([1, 2, 2, 3, 3, 4, 4]);
    expect(cooldownTurns(0)).toBe(1);
  });

  it('FB – Groundshaker – Berserk 1:1:1 takes the Groundshaker cooldown augment when affordable', () => {
    const r = optimize({ vocation: 'knight', points: 400, rotationId: 'ek-mas', ...HUNT });
    expect(augs(r, 'Groundshaker')).toBeGreaterThanOrEqual(1);
    expect(keys(r)).toContain('rationale.rotationCooldown');
    const rates = new Map(r.rotation!.spells.map((s) => [s.name, s.ratio]));
    expect(rates.get('Groundshaker')).toBe(rates.get('Berserk'));
  });

  it('chosen preset out of budget: kept, rotation degrades, reported', () => {
    const r = optimize({ vocation: 'knight', points: 200, rotationId: 'ek-mas', ...HUNT });
    expect(keys(r)).toContain('rationale.rotationCooldownMissing');
    expect(r.rotation!.spells.find((s) => s.name === 'Groundshaker')!.ratio).toBe(7.5);
  });

  it('TFB 2 of 5 turns needs stage II (-4 s); GFoB (16 s, no augment) is reported', () => {
    const r = optimize({ vocation: 'monk', points: 800, rotationId: 'em-tfb', ...HUNT });
    expect(augs(r, 'Thousand Fist Blows')).toBe(2);
    expect(keys(r)).toContain('rationale.rotationCooldownTooLong');
  });

  it('auto mode prefers a preset whose cooldown augments are affordable (else the playable one)', () => {
    const r = optimize({ vocation: 'knight', points: 200, ...HUNT });
    expect(r.rotation!.presetId).not.toBe('ek-mas');
    expect(keys(r)).not.toContain('rationale.rotationCooldownMissing');
  });
});
