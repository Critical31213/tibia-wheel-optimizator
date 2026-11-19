import { useCallback, useEffect, useState } from 'react';
import { CUSTOM_ROTATION_ID, type Vocation } from '../types';
import { getCustomRotationSpells, getForceableSpells, getRevelationNames, getRotationPresets, getStanceOptions } from '../lib/api';
import { parseSpellPrefs, spellPrefsFromQuery, spellPrefsStorageKey, spellPrefsToQuery } from '../lib/spellPrefs';
import type { SpellPrefs } from '../lib/spellPrefs';

const optionsOf = (vocation: Vocation) =>
  [[...getRotationPresets(vocation).map((r) => r.id), CUSTOM_ROTATION_ID], getForceableSpells(vocation), getStanceOptions(vocation), getRevelationNames(vocation), getCustomRotationSpells(vocation)] as const;

function readPrefs(vocation: Vocation, fromUrl: boolean): SpellPrefs {
  const [ids, spells, stances, revs, custom] = optionsOf(vocation);
  if (fromUrl) {
    const q = spellPrefsFromQuery(window.location.search, ids, spells, stances, revs, custom);
    if (q) return q;
  }
  try {
    return parseSpellPrefs(window.localStorage.getItem(spellPrefsStorageKey(vocation)), ids, spells, stances, revs, custom);
  } catch {
    return parseSpellPrefs(null, ids, spells, stances, revs, custom);
  }
}

/**
 * Rotation choice + forced spells + stance of the current vocation: localStorage per vocation, mirrored to the
 * URL (`r`, `fs`, `st`). On a vocation switch the stored prefs of the new vocation (else auto / none) apply.
 */
export function usePersistentSpellPrefs(vocation: Vocation) {
  const [state, setState] = useState(() => ({ vocation, prefs: readPrefs(vocation, typeof window !== 'undefined') }));

  let current = state;
  if (state.vocation !== vocation) {
    current = { vocation, prefs: readPrefs(vocation, false) };
    setState(current);
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(spellPrefsStorageKey(state.vocation), JSON.stringify(state.prefs));
    } catch {
      /* storage blocked — ignore */
    }
    try {
      const search = spellPrefsToQuery(state.prefs, window.location.search);
      if (search !== window.location.search) {
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`);
      }
    } catch {
      /* sandboxed iframe — ignore */
    }
  }, [state]);

  const update = useCallback((patch: Partial<SpellPrefs>) => {
    setState((s) => ({ ...s, prefs: { ...s.prefs, ...patch } }));
  }, []);

  return [current.prefs, update] as const;
}
