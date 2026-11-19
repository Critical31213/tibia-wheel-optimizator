import { useCallback, useEffect, useState } from 'react';
import { getMonsterById, loadMonsterData } from '../lib/api';
import { DEFAULT_INPUTS, fromQuery, sanitize, toQuery, withKnownMonsters } from '../lib/inputState';
import type { InputState } from '../lib/inputState';

const STORAGE_KEY = 'wheel-optimizer:inputs:v1';

function readStorage(): Partial<InputState> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? sanitize(parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function initialState(): InputState {
  if (typeof window === 'undefined') return DEFAULT_INPUTS;
  // Priority: URL (shared link) > localStorage (last visit) > defaults.
  return { ...DEFAULT_INPUTS, ...readStorage(), ...fromQuery(window.location.search) };
}

/**
 * The optimizer inputs, persisted to localStorage and mirrored into
 * the URL query string (via `history.replaceState`, so no history spam).
 */
export function usePersistentInputs() {
  const [state, setState] = useState<InputState>(initialState);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage blocked (private mode, quota) — ignore */
    }
    try {
      const search = toQuery(state, window.location.search);
      if (search !== window.location.search) {
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`);
      }
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
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  return [state, update] as const;
}
