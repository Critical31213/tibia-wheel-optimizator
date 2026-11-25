import type { ReactNode } from 'react';
import { useT, type MessageKey } from '../i18n';
import { en } from '../i18n/en';
import { cx } from '../lib/labels';

interface PanelProps {
  title: string;
  /** Optional step number shown as a gold badge (input panels). */
  step?: number;
  /** id for the heading, so controls can reference it via aria-labelledby; also picks the `help.<id>` tutorial. */
  headingId?: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Bordered card with a small-caps heading. Used for every section. */
export function Panel({ title, step, headingId, aside, className, children }: PanelProps) {
  const t = useT();
  const key = headingId && `help.${headingId.replace(/-heading$/, '')}`;
  const help = key && key in en ? t(key as MessageKey) : null;
  return (
    <section className={cx('panel', className)} aria-labelledby={headingId}>
      <div className="relative mb-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
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
          {help && <Help label={t('help.label', { title })} text={help} />}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** D109: section tutorial, a small "?" with the text on hover / focus (spans the panel width under the heading). */
function Help({ label, text }: { label: string; text: string }) {
  return (
    <span className="group/help">
      <span
        tabIndex={0}
        role="img"
        aria-label={`${label}. ${text}`}
        className="grid size-4 cursor-help place-items-center rounded-full border border-ink-500 text-[10px] font-semibold leading-none text-parchment-400 outline-none hover:border-gold-500 hover:text-gold-300 focus-visible:ring-1 focus-visible:ring-gold-400"
      >
        ?
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-full z-40 mt-1 hidden rounded-md border border-gold-700 bg-ink-850 px-2.5 py-2 text-xs leading-snug text-parchment-200 shadow-lg shadow-black/60 group-focus-within/help:block group-hover/help:block"
      >
        {text}
      </span>
    </span>
  );
}
