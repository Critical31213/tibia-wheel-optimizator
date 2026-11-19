import type { PerkCategory } from '../types';
import type { BuildResult } from '../lib/api';
import { engineText, useT } from '../i18n';
import { cx, DOMAIN_COLORS, formatNumber } from '../lib/labels';

const CATEGORY_TEXT: Record<PerkCategory, string> = {
  offense: 'text-offense',
  defense: 'text-defense',
  utility: 'text-utility',
};

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-parchment-300">{label}</span>
        <span className="tabular-nums text-parchment-100">{v}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        className="h-2.5 overflow-hidden rounded-full bg-ink-950 ring-1 ring-ink-600"
      >
        <div className={cx('h-full rounded-full transition-[width] duration-300', color)} style={{ width: `${v}%` }} />
      </div>
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
      <div className="grid gap-3 sm:grid-cols-2">
        <ScoreBar label={t('results.offense')} value={result.offenseScore} color="bg-offense" />
        <ScoreBar label={t('results.defense')} value={result.defenseScore} color="bg-defense" />
      </div>
      <p className="mt-2 text-xs text-parchment-400">
        {t('results.pointsUsed', { used: formatNumber(result.pointsUsed), total: formatNumber(result.pointsTotal) })}
      </p>

      {result.revelations.length > 0 && (
        <>
          <SubHeading>{t('results.revelations')}</SubHeading>
          <ul className="grid gap-2 sm:grid-cols-2">
            {result.revelations.map(({ perk, stage, domainPoints }) => {
              const next = perk.thresholds[stage];
              const col = DOMAIN_COLORS[perk.domain];
              return (
                <li
                  key={perk.id}
                  className={cx('rounded-lg border p-2.5', stage > 0 ? 'border-ink-500 bg-ink-850' : 'border-ink-700 opacity-70')}
                  title={perk.description}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium" style={{ color: col.text }}>
                      {perk.name}
                    </span>
                    <span className="flex gap-1" role="img" aria-label={t('results.stage', { stage, total: perk.thresholds.length })}>
                      {perk.thresholds.map((t, i) => (
                        <span
                          key={t}
                          className="size-2.5 rounded-full ring-1 ring-ink-500"
                          style={{ background: i < stage ? col.base : 'transparent' }}
                        />
                      ))}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-parchment-400">
                    {t('results.domainPoints', { domain: t(`domain.${perk.domain}`), points: formatNumber(domainPoints) })}
                    {next !== undefined && t('results.nextStage', { points: formatNumber(next) })}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {result.convictions.length > 0 && (
        <>
          <SubHeading>{t('results.convictions')}</SubHeading>
          <ul className="flex flex-wrap gap-1.5">
            {result.convictions.map((p, i) => (
              <li
                key={`${p.id}-${i}`}
                title={p.description}
                className={cx('rounded-full border border-ink-600 bg-ink-950/60 px-2 py-0.5 text-xs', CATEGORY_TEXT[p.category])}
              >
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
            {result.stats.map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
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

/** D57: the engine's reasons for the build (own panel at the end of the page). */
export function BuildRationale({ result }: { result: BuildResult }) {
  const t = useT();
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-parchment-200 marker:text-gold-500">
      {result.rationale.map((r, i) => (
        <li key={r}>{engineText(t, result.rationaleMsgs?.[i], r)}</li>
      ))}
    </ul>
  );
}
