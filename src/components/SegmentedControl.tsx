import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from '../lib/labels';

interface SegmentedControlProps<T extends string | number> {
  options: readonly { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  /** Accessible name: id of a visible label, or a plain label. */
  labelledBy?: string;
  label?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}

/** Compact radiogroup of toggle buttons (roving tabindex, arrows / Home / End). */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  labelledBy,
  label,
  size = 'md',
  disabled,
  className,
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = options.length;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className={cx('flex rounded-lg border border-ink-600 bg-ink-950/60 p-0.5', className)}
    >
      {options.map((o, i) => {
        const checked = i === index;
        return (
          <button
            key={String(o.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cx(
              'min-w-0 flex-1 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1.5 text-xs',
              checked ? 'bg-gold-700/45 text-gold-300 shadow-inner shadow-black/40' : 'text-parchment-300 hover:text-parchment-100',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
