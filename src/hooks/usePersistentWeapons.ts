import { useCallback, useEffect, useState } from 'react';
import type { Vocation } from '../types';
import { parseWeaponPrefs, serializeWeaponPrefs, weaponsStorageKey, type WeaponPrefs } from '../lib/weapons';

function readPrefs(vocation: Vocation): WeaponPrefs {
  try {
    return parseWeaponPrefs(window.localStorage.getItem(weaponsStorageKey(vocation)), vocation);
  } catch {
    return parseWeaponPrefs(null, vocation);
  }
}

/** D47: owned weapons of the current vocation, persisted per vocation in localStorage (not in the URL). */
export function usePersistentWeapons(vocation: Vocation) {
  const [state, setState] = useState(() => ({ vocation, prefs: readPrefs(vocation) }));

  let current = state;
  if (state.vocation !== vocation) {
    current = { vocation, prefs: readPrefs(vocation) };
    setState(current);
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(weaponsStorageKey(state.vocation), serializeWeaponPrefs(state.prefs));
    } catch {
      /* storage blocked — ignore */
    }
  }, [state]);

  const setPrefs = useCallback((update: (prefs: WeaponPrefs) => WeaponPrefs) => {
    setState((s) => ({ ...s, prefs: update(s.prefs) }));
  }, []);

  return [current.prefs, setPrefs] as const;
}
