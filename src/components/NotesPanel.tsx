import type { Vocation } from '../types';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { formatNumber } from '../lib/labels';

/** D54: descriptive hints gathered at the end of the page, collapsed by default. */
export function NotesPanel({ vocation, capacity }: { vocation: Vocation; capacity: number }) {
  const t = useT();
  const keys: MessageKey[] = [
    'notes.skills',
    ...(vocation === 'knight' ? (['notes.meleeSkill'] as const) : []),
    'notes.context',
    'notes.monsters',
    'notes.weapons',
    'notes.assumptions',
    'notes.units',
    'notes.storage',
  ];
  return (
    <details className="panel mt-3 group">
      <summary className="section-title cursor-pointer list-none select-none">
        <span aria-hidden="true" className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
        {t('notes.title')}
      </summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-parchment-300">
        <li>{t('notes.extraPoints', { points: formatNumber(capacity) })}</li>
        {keys.map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ul>
    </details>
  );
}
