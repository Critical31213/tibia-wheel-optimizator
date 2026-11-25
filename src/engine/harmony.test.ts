import { describe, expect, it } from 'vitest';
import { optimize } from '.';

const at = (rotationId: string) =>
  optimize({ vocation: 'monk', points: 1000, monster: null, priority: 0, context: { mode: 'hunt' }, alternatives: 0, rotationId, forcedRevelations: [{ name: 'Spiritual Outburst', stage: 1 }] });
const rates = (r: ReturnType<typeof optimize>) => new Map(r.rotation!.spells.map((s) => [s.name, s.ratio]));
const reached = (r: ReturnType<typeof optimize>) => r.revelations.find((x) => x.perk.name === 'Spiritual Outburst')!.stage > 0;

describe('D66: monk Harmony spender slot', () => {
  it('Spiritual Outburst takes the spender slot while off cooldown; builders keep their casts', () => {
    const so = at('em-voh-so');
    const plain = at('em-voh');
    expect(reached(so)).toBe(true);
    const a = rates(so);
    const b = rates(plain);
    expect(a.get('Spiritual Outburst')).toBeGreaterThan(0);
    expect(a.get('Spiritual Outburst')! + a.get('Sweeping Takedown')!).toBeCloseTo(b.get('Sweeping Takedown')!, 1);
    expect(a.get('Chained Penance')).toBe(b.get('Chained Penance'));
  });

  it('a Takedown-only preset never casts Spiritual Outburst, even with the revelation', () => {
    const r = at('em-voh');
    expect(reached(r)).toBe(true);
    expect(rates(r).has('Spiritual Outburst')).toBe(false);
  });
});

describe('D67: rotation damage window', () => {
  it('30 s: 15 turns of casts; the sum is auto-attack plus every spell', () => {
    const r = optimize({ vocation: 'monk', points: 661, monster: null, priority: 0, context: { mode: 'hunt' }, alternatives: 0 });
    const w = r.rotation!.window!;
    const spells = r.rotation!.spells.filter((s) => s.damage);
    expect(w.seconds).toBe(30);
    expect(spells.reduce((a, s) => a + s.damage!.casts, 0)).toBeCloseTo(15, 0);
    expect(Math.abs(spells.reduce((a, s) => a + s.damage!.total, 0) + w.autoAttack - w.total)).toBeLessThanOrEqual(spells.length + 1);
  });

  it('D105: Min < Avg < Max; Avg × targets within the cast damage', () => {
    const r = optimize({ vocation: 'sorcerer', points: 1000, monster: null, priority: 0, context: { mode: 'hunt' }, alternatives: 0 });
    const spells = r.rotation!.spells.filter((s) => s.damage);
    expect(spells.some((s) => s.damage!.minHit !== undefined)).toBe(true);
    for (const { damage: d } of spells) {
      expect(d!.avgHit! * d!.targets).toBeLessThanOrEqual(d!.perCast + 1);
      if (d!.minHit === undefined) continue;
      expect(d!.minHit).toBeLessThan(d!.avgHit!);
      expect(d!.maxHit!).toBeGreaterThan(d!.avgHit!);
    }
  });
});

describe('D107: own average targets', () => {
  const run = (spellTargets?: Record<string, number>, mode: 'hunt' | 'boss' = 'hunt') =>
    optimize({ vocation: 'druid', points: 1000, monster: null, priority: 0, context: { mode }, alternatives: 0, rotationId: 'custom', customRotation: [{ name: 'Terra Wave', ratio: 1 }], spellTargets });
  const dmg = (r: ReturnType<typeof optimize>) => r.rotation!.spells.find((s) => s.name === 'Terra Wave')!.damage!;

  it('hunt: more targets → more per cast; the default value equals no override', () => {
    const base = dmg(run());
    const more = dmg(run({ 'Terra Wave': 10 }));
    expect(more.targets).toBeGreaterThan(base.targets);
    expect(more.perCast).toBeGreaterThan(base.perCast);
    expect(dmg(run({ 'Terra Wave': 5.8 })).perCast).toBeCloseTo(base.perCast, 6);
  });

  it('boss: ignored', () => {
    expect(dmg(run({ 'Terra Wave': 10 }, 'boss')).targets).toBe(dmg(run(undefined, 'boss')).targets);
  });
});

describe('D68: five builders before each spender', () => {
  it.each(['em-voh', 'em-voh-so', 'em-voj', 'em-tfb', 'em-tfb-so'])('%s: builder casts = 5 × spender casts, turns all used', (id) => {
    const r = optimize({ vocation: 'monk', points: 1000, monster: null, priority: 0, context: { mode: 'hunt' }, alternatives: 0, rotationId: id });
    const spells = r.rotation!.spells;
    const spend = spells.filter((s) => s.name === 'Sweeping Takedown' || s.name === 'Spiritual Outburst').reduce((a, s) => a + s.ratio, 0);
    const build = spells.filter((s) => s.name !== 'Sweeping Takedown' && s.name !== 'Spiritual Outburst').reduce((a, s) => a + s.ratio, 0);
    expect(build).toBeCloseTo(5 * spend, 0);
    expect(build + spend).toBeCloseTo(30, 0);
  });
});

describe('D70: custom rotation', () => {
  const run = (vocation: 'druid' | 'monk', customRotation: { name: string; ratio: number }[]) =>
    optimize({ vocation, points: 1000, monster: null, priority: 0, context: { mode: 'hunt' }, alternatives: 0, rotationId: 'custom', customRotation });

  it('uses the chosen spells and weights', () => {
    const r = run('druid', [
      { name: 'Strong Ice Wave', ratio: 2 },
      { name: 'Terra Wave', ratio: 1 },
    ]);
    expect(r.rotation!.presetId).toBe('custom');
    const m = rates(r);
    expect(m.get('Strong Ice Wave')).toBeGreaterThan(m.get('Terra Wave')!);
    expect(m.has('Ice Wave')).toBe(false);
  });

  it('monk: Spiritual Outburst goes into the spender slot', () => {
    const m = rates(run('monk', [{ name: 'Chained Penance', ratio: 5 }, { name: 'Spiritual Outburst', ratio: 1 }]));
    expect(m.get('Chained Penance')).toBeGreaterThan(0);
    expect(m.get('Spiritual Outburst')! + (m.get('Sweeping Takedown') ?? 0)).toBeGreaterThan(0);
  });

  it('no valid spell: the engine picks the rotation', () => {
    expect(run('druid', [{ name: 'Nope', ratio: 3 }]).rotation!.presetId).not.toBe('custom');
  });
});
