import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUTS } from './inputState';
import { gemsStorageKey } from './gems';
import {
  LEGACY_INPUTS_KEY,
  SHARED_INPUTS_KEY,
  migrateInputs,
  readShared,
  readVocation,
  resetVocation,
  vocationInputsKey,
  writeInputs,
  type KeyValueStorage,
} from './inputStorage';

function memory(init: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('per-vocation inputs (D101)', () => {
  it('migrates the shared legacy inputs to every vocation', () => {
    const s = memory({ [LEGACY_INPUTS_KEY]: JSON.stringify({ ...DEFAULT_INPUTS, vocation: 'druid', level: 600, wheel: 'live' }) });
    migrateInputs(s);
    expect(s.getItem(LEGACY_INPUTS_KEY)).toBeNull();
    expect(readShared(s)).toEqual({ vocation: 'druid', wheel: 'live' });
    expect(readVocation(s, 'knight').level).toBe(600);
    expect(readVocation(s, 'druid').level).toBe(600);
  });

  it('keeps each vocation apart and resets only one', () => {
    const s = memory();
    writeInputs(s, { ...DEFAULT_INPUTS, vocation: 'knight', level: 500, monsters: [{ id: 'demon', weight: 1 }] });
    writeInputs(s, { ...DEFAULT_INPUTS, vocation: 'sorcerer', level: 800 });
    s.setItem(gemsStorageKey('knight'), '[]');
    s.setItem(gemsStorageKey('sorcerer'), '[]');
    expect(readVocation(s, 'knight').monsters).toEqual([{ id: 'demon', weight: 1 }]);
    expect(readShared(s).vocation).toBe('sorcerer');

    resetVocation(s, 'knight');
    expect(readVocation(s, 'knight')).toEqual(readVocation(memory(), 'knight'));
    expect(s.getItem(gemsStorageKey('knight'))).toBeNull();
    expect(readVocation(s, 'sorcerer').level).toBe(800);
    expect(s.getItem(gemsStorageKey('sorcerer'))).toBe('[]');
    expect(s.getItem(SHARED_INPUTS_KEY)).not.toBeNull();
    expect(s.getItem(vocationInputsKey('sorcerer'))).not.toBeNull();
  });
});
