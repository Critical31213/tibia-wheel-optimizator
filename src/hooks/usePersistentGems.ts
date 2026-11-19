import { useCallback, useEffect, useState } from 'react';
import type { OwnedGem, Vocation } from '../types';
import { gemsStorageKey, parseGems, serializeGems } from '../lib/gems';

function readGems(vocation: Vocation): OwnedGem[] {
  try {
    return parseGems(window.localStorage.getItem(gemsStorageKey(vocation)));
  } catch {
    return [];
  }
}

/** Owned gems of the current vocation, persisted per vocation in localStorage (not in the URL). */
export function usePersistentGems(vocation: Vocation) {
  const [state, setState] = useState(() => ({ vocation, gems: readGems(vocation) }));

  let current = state;
  if (state.vocation !== vocation) {
    current = { vocation, gems: readGems(vocation) };
    setState(current);
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(gemsStorageKey(state.vocation), serializeGems(state.gems));
    } catch {
      /* storage blocked — ignore */
    }
  }, [state]);

  const setGems = useCallback((update: (gems: OwnedGem[]) => OwnedGem[]) => {
    setState((s) => ({ ...s, gems: update(s.gems) }));
  }, []);

  return [current.gems, setGems] as const;
}
