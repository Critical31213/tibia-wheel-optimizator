import type { ReactNode } from 'react';
import { cx } from '../lib/labels';

interface PanelProps {
  title: string;
  /** Optional step number shown as a gold badge (input panels). */
  step?: number;
  /** id for the heading, so controls can reference it via aria-labelledby. */
  headingId?: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Bordered card with a small-caps heading. Used for every section. */
export function Panel({ title, step, headingId, aside, className, children }: PanelProps) {
  return (
    <section className={cx('panel', className)} aria-labelledby={headingId}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id={headingId} className="section-title flex items-center gap-2">
          {step !== undefined && (
            <span
              aria-hidden="true"
              className="grid size-6 place-items-center rounded-full border border-gold-600 bg-ink-950 text-xs text-gold-300"
            >
              {step}
            </span>
          )}
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
