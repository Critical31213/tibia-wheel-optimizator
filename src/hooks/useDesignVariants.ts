import { useCallback, useEffect, useState } from 'react';
import type { GearFallback } from '../lib/gear';

/**
 * D74 (temporary): design variants of the equipment panel shown side by side for review. The chosen variant
 * stays; this hook and the switch in the panel go.
 */
export interface DesignVariants {
  /** How empty slots count once some equipment is set. */
  fallback: GearFallback;
  /** Item picker: modal window or inline below the paper doll. */
  picker: 'modal' | 'inline';
}

const KEY = 'wheel-optimizer:design-variants:v1';
const DEFAULT: DesignVariants = { fallback: 'slot', picker: 'modal' };

function read(): DesignVariants {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Partial<DesignVariants>;
    return {
      fallback: raw.fallback === 'all' ? 'all' : 'slot',
      picker: raw.picker === 'inline' ? 'inline' : 'modal',
    };
  } catch {
    return DEFAULT;
  }
}

export function useDesignVariants() {
  const [v, setV] = useState(read);
  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(v));
    } catch {
      /* storage blocked — ignore */
    }
  }, [v]);
  const update = useCallback((patch: Partial<DesignVariants>) => setV((x) => ({ ...x, ...patch })), []);
  return [v, update] as const;
}
