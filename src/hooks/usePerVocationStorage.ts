import { useCallback, useEffect, useState } from 'react';
import type { OwnedGem, Vocation } from '../types';
import { gemsStorageKey, parseGems, serializeGems } from '../lib/gems';
import { gearStorageKey, parseGear, type GearPrefs } from '../lib/gear';
import { parseWeaponPrefs, serializeWeaponPrefs, weaponsStorageKey, type WeaponPrefs } from '../lib/weapons';
import { compareStorageKey, parseCompareCode } from '../lib/compare';

export interface VocationStore<T> {
  key: (vocation: Vocation) => string;
  parse: (json: string | null, vocation: Vocation) => T;
  serialize: (value: T) => string;
}

function read<T>(store: VocationStore<T>, vocation: Vocation): T {
  try {
    return store.parse(window.localStorage.getItem(store.key(vocation)), vocation);
  } catch {
    return store.parse(null, vocation);
  }
}

/**
 * A value of the current vocation, persisted per vocation in localStorage (not in the URL). On a vocation switch
 * the stored value of the new vocation applies. `store` must be a stable (module-level) object.
 */
export function usePerVocationStorage<T>(vocation: Vocation, store: VocationStore<T>) {
  const [state, setState] = useState(() => ({ vocation, value: read(store, vocation) }));

  let current = state;
  if (state.vocation !== vocation) {
    current = { vocation, value: read(store, vocation) };
    setState(current);
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(store.key(state.vocation), store.serialize(state.value));
    } catch {
      /* storage blocked — ignore */
    }
  }, [state, store]);

  const update = useCallback((f: (value: T) => T) => {
    setState((s) => ({ ...s, value: f(s.value) }));
  }, []);

  return [current.value, update] as const;
}

// ---------------------------------------------------------------------------
// Stores

const GEMS: VocationStore<OwnedGem[]> = { key: gemsStorageKey, parse: (json) => parseGems(json), serialize: serializeGems };
const WEAPONS: VocationStore<WeaponPrefs> = { key: weaponsStorageKey, parse: parseWeaponPrefs, serialize: serializeWeaponPrefs };
const GEAR: VocationStore<GearPrefs> = { key: gearStorageKey, parse: parseGear, serialize: (g) => JSON.stringify(g) };

/** Owned gems of the current vocation. */
export const usePersistentGems = (vocation: Vocation) => usePerVocationStorage(vocation, GEMS);
/** D47: owned weapons of the current vocation. */
export const usePersistentWeapons = (vocation: Vocation) => usePerVocationStorage(vocation, WEAPONS);
/** D74: equipment of the current vocation. */
export const usePersistentGear = (vocation: Vocation) => usePerVocationStorage(vocation, GEAR);
const COMPARE: VocationStore<string> = { key: compareStorageKey, parse: parseCompareCode, serialize: (c) => JSON.stringify(c) };
/** D89: the own wheel's planner code of the current vocation. */
export const usePersistentCompareCode = (vocation: Vocation) => usePerVocationStorage(vocation, COMPARE);
