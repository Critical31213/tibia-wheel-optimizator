import { useCallback, useEffect, useState } from 'react';
import { getMonsterById, loadMonsterData } from '../lib/api';
import { DEFAULT_INPUTS, fromQuery, toQuery, withKnownMonsters } from '../lib/inputState';
import type { InputState } from '../lib/inputState';
import { linkSearch, migrateInputs, mirrorSearch, readShared, readVocation, vocationOf, writeInputs } from '../lib/inputStorage';

function initialState(): InputState {
  if (typeof window === 'undefined') return DEFAULT_INPUTS;
  try {
    migrateInputs(window.localStorage);
    // Priority: URL (shared link) > localStorage (last visit) > defaults.
    const url = fromQuery(linkSearch());
    const shared = { ...DEFAULT_INPUTS, ...readShared(window.localStorage), ...url };
    return { ...shared, ...readVocation(window.localStorage, shared.vocation), ...url };
  } catch {
    return { ...DEFAULT_INPUTS, ...fromQuery(linkSearch()) };
  }
}

function vocationInputs(vocation: InputState['vocation']) {
  try {
    return readVocation(window.localStorage, vocation);
  } catch {
    return vocationOf(DEFAULT_INPUTS);
  }
}

/**
 * The optimizer inputs, persisted to localStorage (D101: per vocation, except the vocation and wheel variant) and
 * mirrored into the URL query string (via `history.replaceState`, so no history spam).
 */
export function usePersistentInputs() {
  const [state, setState] = useState<InputState>(initialState);

  useEffect(() => {
    try {
      writeInputs(window.localStorage, state);
    } catch {
      /* storage blocked (private mode, quota) — ignore */
    }
    try {
      mirrorSearch(toQuery(state, window.location.search));
    } catch {
      /* sandboxed iframe etc. — ignore */
    }
  }, [state]);

  // Once the (lazy) monster dataset is in, drop unknown monster ids from a stale link / storage.
  useEffect(() => {
    loadMonsterData()
      .then(() => setState((s) => withKnownMonsters(s, (id) => getMonsterById(id) !== undefined)))
      .catch(() => undefined);
  }, []);

  const update = useCallback((patch: Partial<InputState>) => {
    setState((prev) =>
      // A vocation switch brings that vocation's own inputs (the wheel variant stays).
      patch.vocation && patch.vocation !== prev.vocation
        ? { ...prev, ...vocationInputs(patch.vocation), ...patch }
        : { ...prev, ...patch },
    );
  }, []);

  return [state, update] as const;
}
