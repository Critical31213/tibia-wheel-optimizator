import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { VOCATIONS } from '../types';
import type { Vocation } from '../types';
import { cx, VOCATION_BLURBS, VOCATION_LABELS } from '../lib/labels';
import { Panel } from './Panel';
import { VocationIcon } from './VocationIcon';

interface VocationPickerProps {
  value: Vocation;
  onChange: (v: Vocation) => void;
}

/** Five toggle cards with radiogroup semantics (roving tabindex, arrow keys). */
export function VocationPicker({ value, onChange }: VocationPickerProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = VOCATIONS.indexOf(value);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % VOCATIONS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + VOCATIONS.length) % VOCATIONS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = VOCATIONS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(VOCATIONS[next]);
    refs.current[next]?.focus();
  };

  return (
    <Panel title="Vocation" step={1} headingId="vocation-heading">
      <div
        role="radiogroup"
        aria-labelledby="vocation-heading"
        onKeyDown={onKeyDown}
        className="grid grid-cols-3 gap-2 sm:grid-cols-5"
      >
        {VOCATIONS.map((v, i) => {
          const checked = v === value;
          return (
            <button
              key={v}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              title={VOCATION_BLURBS[v]}
              onClick={() => onChange(v)}
              className={cx(
                'flex flex-col items-center gap-1 rounded-xl border px-1 py-2.5 text-xs font-medium transition-colors',
                checked
                  ? 'border-gold-500 bg-gold-700/30 text-gold-300 shadow-inner shadow-black/40'
                  : 'border-ink-600 bg-ink-950/50 text-parchment-300 hover:border-gold-700 hover:text-parchment-100',
              )}
            >
              <VocationIcon vocation={v} className="size-6" />
              {VOCATION_LABELS[v]}
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
