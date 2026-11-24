/**
 * D101: stored inputs. The vocation and wheel variant are shared; everything else (level, points, skills, spot,
 * priority, mode) is kept per vocation, so each vocation can be reset on its own.
 */
import { VOCATIONS, type Vocation } from '../types';
import { compareStorageKey } from './compare';
import { gearStorageKey } from './gear';
import { gemsStorageKey } from './gems';
import { DEFAULT_INPUTS, sanitize, type InputState } from './inputState';
import { spellPrefsStorageKey } from './spellPrefs';
import { weaponsStorageKey } from './weapons';

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type SharedInputs = Pick<InputState, 'vocation' | 'wheel'>;
export type VocationInputs = Omit<InputState, 'vocation' | 'wheel'>;

/** Up to D100: the whole InputState, shared by every vocation. */
export const LEGACY_INPUTS_KEY = 'wheel-optimizer:inputs:v1';
export const SHARED_INPUTS_KEY = 'wheel-optimizer:inputs:v2';
export const vocationInputsKey = (vocation: Vocation) => `wheel-optimizer:inputs:v2:${vocation}`;

export const sharedOf = ({ vocation, wheel }: InputState): SharedInputs => ({ vocation, wheel });
export function vocationOf<T extends Partial<InputState>>(s: T): Omit<T, 'vocation' | 'wheel'> {
  const rest = { ...s };
  delete rest.vocation;
  delete rest.wheel;
  return rest;
}

function readJson(storage: KeyValueStorage, key: string): Partial<InputState> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? 'null');
    return parsed && typeof parsed === 'object' ? sanitize(parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The legacy shared inputs become every vocation's own (where it has none yet); the legacy key is removed. */
export function migrateInputs(storage: KeyValueStorage): void {
  if (storage.getItem(LEGACY_INPUTS_KEY) === null) return;
  const old = readJson(storage, LEGACY_INPUTS_KEY);
  const own = JSON.stringify(vocationOf(old));
  for (const v of VOCATIONS) if (storage.getItem(vocationInputsKey(v)) === null) storage.setItem(vocationInputsKey(v), own);
  if (storage.getItem(SHARED_INPUTS_KEY) === null) storage.setItem(SHARED_INPUTS_KEY, JSON.stringify({ vocation: old.vocation, wheel: old.wheel }));
  storage.removeItem(LEGACY_INPUTS_KEY);
}

export function readShared(storage: KeyValueStorage): Partial<SharedInputs> {
  const { vocation, wheel } = readJson(storage, SHARED_INPUTS_KEY);
  return { ...(vocation ? { vocation } : {}), ...(wheel ? { wheel } : {}) };
}

/** The vocation's own inputs over the defaults. */
export function readVocation(storage: KeyValueStorage, vocation: Vocation): VocationInputs {
  return { ...vocationOf(DEFAULT_INPUTS), ...vocationOf(readJson(storage, vocationInputsKey(vocation))) };
}

export function writeInputs(storage: KeyValueStorage, state: InputState): void {
  storage.setItem(SHARED_INPUTS_KEY, JSON.stringify(sharedOf(state)));
  storage.setItem(vocationInputsKey(state.vocation), JSON.stringify(vocationOf(state)));
}

/** Every stored setting of one vocation (inputs, spells, gems, weapons, gear with charms, compare code). */
export const vocationStorageKeys = (vocation: Vocation): string[] => [
  vocationInputsKey(vocation),
  spellPrefsStorageKey(vocation),
  gemsStorageKey(vocation),
  weaponsStorageKey(vocation),
  gearStorageKey(vocation),
  compareStorageKey(vocation),
];

export function resetVocation(storage: KeyValueStorage, vocation: Vocation): void {
  for (const k of vocationStorageKeys(vocation)) storage.removeItem(k);
}
