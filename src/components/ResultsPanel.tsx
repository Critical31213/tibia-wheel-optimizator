import type { OptimizerResult, PerkCategory, WheelDefinition } from '../types';
import { CATEGORY_LABELS, cx, DOMAIN_COLORS, DOMAIN_LABELS, formatNumber } from '../lib/labels';

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
  wheel: WheelDefinition;
  result: OptimizerResult;
}

/** Textual breakdown of the optimized build. */
export function ResultsPanel({ wheel, result }: ResultsPanelProps) {
  const byId = new Map(wheel.slices.map((s) => [s.id, s]));

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ScoreBar label="Offense" value={result.offenseScore} color="bg-offense" />
        <ScoreBar label="Defense" value={result.defenseScore} color="bg-defense" />
      </div>
      <p className="mt-2 text-xs text-parchment-400">
        {formatNumber(result.pointsUsed)} of {formatNumber(result.pointsTotal)} points used.
      </p>

      {result.revelations.length > 0 && (
        <>
          <SubHeading>Revelation perks</SubHeading>
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
                    <span className="flex gap-1" role="img" aria-label={`Stage ${stage} of ${perk.thresholds.length}`}>
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
                    {DOMAIN_LABELS[perk.domain]} · {formatNumber(domainPoints)} pts
                    {next !== undefined && ` · next stage at ${formatNumber(next)}`}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {result.convictions.length > 0 && (
        <>
          <SubHeading>Conviction perks</SubHeading>
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
          <SubHeading>Stats</SubHeading>
          <dl className="divide-y divide-ink-700 rounded-lg border border-ink-700">
            {result.stats.map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                <dt className="text-parchment-200">
                  <span className={cx('mr-2 text-[10px] uppercase', CATEGORY_TEXT[s.category])}>
                    {CATEGORY_LABELS[s.category]}
                  </span>
                  {s.label}
                </dt>
                <dd className="tabular-nums text-parchment-50">{s.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {result.rationale.length > 0 && (
        <>
          <SubHeading>Why this build</SubHeading>
          <ul className="list-disc space-y-1 pl-5 text-sm text-parchment-200 marker:text-gold-500">
            {result.rationale.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      )}

      {result.path.length > 0 && (
        <>
          <SubHeading>Fill order</SubHeading>
          <ol className="space-y-1 text-sm">
            {result.path.map((id, i) => {
              const s = byId.get(id);
              const pts = result.allocation[id] ?? 0;
              return (
                <li key={id} className="flex items-center gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full border border-gold-700 text-xs text-gold-300 tabular-nums">
                    {i + 1}
                  </span>
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ background: s ? DOMAIN_COLORS[s.domain].base : undefined }}
                  />
                  <span className="min-w-0 flex-1 truncate text-parchment-200">
                    {s ? s.conviction.name : id}
                    {s && <span className="text-parchment-400"> · {DOMAIN_LABELS[s.domain]}, ring {s.ring}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-parchment-300">
                    {pts}
                    {s && `/${s.capacity}`}
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
