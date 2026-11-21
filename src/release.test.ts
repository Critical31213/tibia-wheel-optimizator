import { describe, expect, it, vi } from 'vitest';
import type { OptimizerInput } from './types';
import { optimize } from './engine';
import { applyWheelUpdate } from './data/wheel/update';
import wheelJson from './data/wheel/wheel-data.json';
import type { WheelDataFile } from './data/wheel/types';

/** D90: the app once the update is released (`WHEEL_UPDATE_RELEASED = true`), loaded next to the normal one. */
async function released() {
  vi.resetModules();
  vi.doMock('./data/wheel/release', () => ({ WHEEL_UPDATE_RELEASED: true }));
  const [engine, build, data, code, input, compare] = await Promise.all([
    import('./engine'),
    import('./engine/wheel/build'),
    import('./data/wheel'),
    import('./data/wheel/plannerCode'),
    import('./lib/inputState'),
    import('./lib/compare'),
  ]);
  vi.doUnmock('./data/wheel/release');
  return { engine, build, data, code, input, compare };
}

const base: OptimizerInput = { vocation: 'druid', points: 900, monster: null, priority: 40, context: { mode: 'hunt' }, gems: [], alternatives: 0 };

describe('D90: after the update is released', () => {
  it('the current wheel gives exactly the same builds', async () => {
    const r = await released();
    for (const v of ['knight', 'paladin', 'monk'] as const) {
      const input = { ...base, vocation: v };
      expect(r.engine.optimize(input)).toEqual(optimize(input));
    }
  });

  it('the old live wheel is gone: requests, stored inputs and own-wheel codes fall back', async () => {
    const r = await released();
    expect(r.data.wheelVariants()).toEqual(['current']);
    expect(r.build.getEngineWheel('knight', 'live').variant).toBe('current');
    const res = r.engine.optimize({ ...base, wheelVariant: 'live' });
    expect(res.wheelVariant).toBeUndefined();
    expect(res.plannerCode?.[1]).toBe('1');
    expect(res).toEqual(optimize(base));
    expect(r.input.sanitize({ wheel: 'live' }).wheel).toBe('current');
    expect(r.input.fromQuery('?v=druid&w=live').wheel).toBe('current');
    expect(r.data.wheelVariants().includes(r.compare.parseOwnWheel('K0Y2AgDP4jAQA')!.variant)).toBe(false);
  });

  it('planner links go to www.tibia.com', async () => {
    const r = await released();
    expect(r.code.PLANNER_URL).toBe(r.code.LIVE_PLANNER_URL);
    expect(r.code.plannerUrl(optimize(base).plannerCode!)).toMatch(/^https:\/\/www\.tibia\.com\//);
  });

  it('re-extracted data that already has the new layout is not swapped back', () => {
    const once = applyWheelUpdate(wheelJson as WheelDataFile);
    expect(applyWheelUpdate(once)).toEqual(once);
  });
});
