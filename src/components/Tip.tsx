import type { ReactNode } from 'react';
import { cx } from '../lib/labels';

/** D52: small tooltip shown on hover / keyboard focus (the wrapped control keeps its own accessible name). */
export function Tip({ text, align = 'center', children }: { text: string; align?: 'start' | 'center' | 'end'; children: ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        aria-hidden="true"
        className={cx(
          'pointer-events-none absolute bottom-full z-30 mb-1 hidden w-max max-w-56 rounded-md border border-ink-600 bg-ink-850 px-2 py-1 text-[11px] leading-snug text-parchment-100 shadow-lg shadow-black/60 group-focus-within/tip:block group-hover/tip:block',
          align === 'start' ? 'left-0' : align === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2',
        )}
      >
        {text}
      </span>
    </span>
  );
}

