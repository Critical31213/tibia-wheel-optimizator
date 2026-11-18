import type { AlternativeBuild } from '../types';
import { engineText, useT } from '../i18n';
import { SegmentedControl } from './SegmentedControl';

interface BuildSwitcherProps {
  alternatives: AlternativeBuild[];
  /** 0 = best build, i = alternatives[i - 1]. */
  value: number;
  onChange: (index: number) => void;
}

/** "Best build · Alt 1 · Alt 2" toggle plus the selected alternative's label, trade-off and score. */
export function BuildSwitcher({ alternatives, value, onChange }: BuildSwitcherProps) {
  const t = useT();
  const alt = value > 0 ? alternatives[value - 1] : undefined;
  return (
    <div>
      <SegmentedControl<number>
        label={t('alts.label')}
        value={value}
        onChange={onChange}
        options={[
          { value: 0, label: t('alts.best') },
          ...alternatives.map((a, i) => ({
            value: i + 1,
            label: t('alts.altN', { n: i + 1 }),
            title: engineText(t, a.labelMsg, a.label),
          })),
        ]}
      />
      <div className="mt-2 text-xs text-parchment-300" aria-live="polite">
        {alt ? (
          <>
            <p>
              <span className="font-semibold text-parchment-100">{engineText(t, alt.labelMsg, alt.label)}</span>
              {' · '}
              <span className="tabular-nums">{t('alts.score', { score: Math.round(alt.relativeScore) })}</span>
            </p>
            <p className="mt-1">{engineText(t, alt.tradeoffMsg, alt.tradeoff)}</p>
          </>
        ) : (
          <p>{t('alts.bestHint')}</p>
        )}
      </div>
    </div>
  );
}
