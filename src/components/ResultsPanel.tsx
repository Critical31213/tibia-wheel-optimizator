import type { PerkCategory } from '../types';
import type { BuildResult } from '../lib/api';
import { engineText, useT } from '../i18n';
import { cx, formatNumber } from '../lib/labels';
import { groupConvictions } from '../lib/vessels';

const CATEGORY_TEXT: Record<PerkCategory, string> = {
  offense: 'text-offense',
  defense: 'text-defense',
  utility: 'text-utility',
};

const pct = (n: number) => `${n >= 0 ? '+' : '−'}${formatNumber(Math.abs(Math.round(n * 10) / 10))}%`;

/** D58: what the wheel adds, as one number. */
function EffectTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-950/50 px-3 py-2">
      <p className="text-xs text-parchment-300">{label}</p>
      <p className={cx('text-xl font-semibold tabular-nums', color)}>{pct(value)}</p>
    </div>
  );
}

function SubHeading({ children }: { children: string }) {
  return <h3 className="mt-5 mb-2 text-xs font-semibold tracking-wider text-parchment-400 uppercase">{children}</h3>;
}

interface ResultsPanelProps {
  result: BuildResult;
}

/** Textual breakdown of the optimized build. */
export function ResultsPanel({ result }: ResultsPanelProps) {
  const t = useT();

  return (
    <div>
      {result.wheelEffect && (
        <div className="grid grid-cols-2 gap-2">
          <EffectTile label={t('results.damage')} value={result.wheelEffect.dmg} color="text-offense" />
          <EffectTile label={t('results.ehp')} value={result.wheelEffect.ehp} color="text-defense" />
        </div>
      )}
      {(result.wheelEffect?.other ?? 0) > 0 && (
        <p className="mt-2 text-xs text-parchment-300">{t('results.otherOffense', { n: result.wheelEffect!.other!.toFixed(1) })}</p>
      )}
      <p className="mt-2 text-xs text-parchment-400">
        {t('results.vsEmpty')} {t('results.pointsUsed', { used: formatNumber(result.pointsUsed), total: formatNumber(result.pointsTotal) })}
      </p>

      {result.convictions.length > 0 && (
        <>
          <SubHeading>{t('results.convictions')}</SubHeading>
          <ul className="flex flex-wrap gap-1.5">
            {groupConvictions(result.convictions).map(({ perk: p, count }) => (
              <li
                key={p.id}
                title={p.description}
                className={cx('rounded-full border border-ink-600 bg-ink-950/60 px-2 py-0.5 text-xs', CATEGORY_TEXT[p.category])}
              >
                {count > 1 && <span className="text-parchment-300">{count} × </span>}
                {p.name}
              </li>
            ))}
          </ul>
        </>
      )}

      {result.stats.length > 0 && (
        <>
          <SubHeading>{t('results.stats')}</SubHeading>
          <dl className="divide-y divide-ink-700 rounded-lg border border-ink-700">
            {result.stats.map((s, i) => (
              <div key={`${i}-${s.label}`} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                <dt className="text-parchment-200">
                  <span className={cx('mr-2 text-[10px] uppercase', CATEGORY_TEXT[s.category])}>
                    {t(`category.${s.category}`)}
                  </span>
                  {engineText(t, s.labelMsg, s.label)}
                </dt>
                <dd className="tabular-nums text-parchment-50">{s.value === 'Active' ? t('common.active') : s.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

    </div>
  );
}
