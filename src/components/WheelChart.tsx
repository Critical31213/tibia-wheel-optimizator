import { useMemo, useState } from 'react';
import type { Domain, Slice, WheelDefinition } from '../types';
import type { BuildResult } from '../lib/api';
import { annularSectorPath, fillRadius, ringBounds, sectorCentroid, sliceAngles } from '../lib/geometry';
import { useT } from '../i18n';
import { cx, DOMAIN_COLORS, formatNumber } from '../lib/labels';

const SIZE = 400;
const C = SIZE / 2;
const HUB = 34;
const OUTER = 192;
/** Grid order matching the wheel quadrants (2 columns). */
const QUADRANTS: readonly Domain[] = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

interface WheelChartProps {
  wheel: WheelDefinition;
  result: BuildResult | null;
}

interface SliceShape {
  slice: Slice;
  points: number;
  bg: string;
  fill: string | null;
  centroid: { x: number; y: number };
}

/** SVG Wheel of Destiny: rings of slices, filled proportionally to points. */
export function WheelChart({ wheel, result }: WheelChartProps) {
  const t = useT();
  const [hover, setHover] = useState<string | null>(null);

  const shapes = useMemo<SliceShape[]>(() => {
    const ringCount = Math.max(1, ...wheel.slices.map((s) => s.ring));
    return wheel.slices.map((slice) => {
      const [a0, a1] = sliceAngles(slice.indexInRing, slice.slicesInRing);
      const { inner, outer } = ringBounds(slice.ring, ringCount, HUB, OUTER);
      const points = result?.allocation[slice.id] ?? 0;
      const frac = slice.capacity > 0 ? points / slice.capacity : 0;
      return {
        slice,
        points,
        bg: annularSectorPath(C, C, inner, outer, a0, a1),
        fill: frac > 0 ? annularSectorPath(C, C, inner, fillRadius(inner, outer, frac), a0, a1) : null,
        centroid: sectorCentroid(C, C, inner, outer, a0, a1),
      };
    });
  }, [wheel, result]);

  const active = shapes.find((s) => s.slice.id === hover);

  return (
    <div>
      <div className="relative mx-auto aspect-square w-full max-w-[440px]">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-full" role="group" aria-label={t('wheel.aria')}>
          <circle cx={C} cy={C} r={OUTER + 4} fill="#0d0a07" stroke="#6b4f19" strokeWidth={2} />
          {shapes.map(({ slice, points, bg, fill }) => {
            const col = DOMAIN_COLORS[slice.domain];
            const isActive = hover === slice.id;
            return (
              <g
                key={slice.id}
                tabIndex={0}
                role="img"
                aria-label={t('wheel.sliceAria', { domain: t(`domain.${slice.domain}`), ring: slice.ring, name: slice.conviction.name, points, capacity: slice.capacity })}
                onMouseEnter={() => setHover(slice.id)}
                onMouseLeave={() => setHover((h) => (h === slice.id ? null : h))}
                onFocus={() => setHover(slice.id)}
                onBlur={() => setHover((h) => (h === slice.id ? null : h))}
                className="cursor-pointer outline-none"
              >
                <path d={bg} fill={col.dim} stroke="#0d0a07" strokeWidth={1.5} />
                {fill && <path d={fill} fill={col.base} opacity={points === slice.capacity ? 1 : 0.8} />}
                <path
                  d={bg}
                  fill="none"
                  stroke={isActive ? '#f3d27c' : 'transparent'}
                  strokeWidth={2.5}
                  pointerEvents="none"
                />
              </g>
            );
          })}
          <line x1={C} y1={C - OUTER - 4} x2={C} y2={C + OUTER + 4} stroke="#0d0a07" strokeWidth={3} pointerEvents="none" />
          <line x1={C - OUTER - 4} y1={C} x2={C + OUTER + 4} y2={C} stroke="#0d0a07" strokeWidth={3} pointerEvents="none" />
          <circle cx={C} cy={C} r={HUB - 2} fill="#15110c" stroke="#9c7222" strokeWidth={2} />
          <text x={C} y={C - 2} textAnchor="middle" className="fill-gold-300 font-display" fontSize={13}>
            {result ? formatNumber(result.pointsUsed) : 0}
          </text>
          <text x={C} y={C + 12} textAnchor="middle" className="fill-parchment-400" fontSize={8}>
            {t('wheel.points')}
          </text>
        </svg>

        {active && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 w-52 rounded-lg border border-gold-700 bg-ink-850/95 p-2.5 text-xs shadow-xl shadow-black/60"
            style={{
              left: `${Math.min(80, Math.max(20, (active.centroid.x / SIZE) * 100))}%`,
              top: `${(active.centroid.y / SIZE) * 100}%`,
              transform: `translate(-50%, ${active.centroid.y > C ? 'calc(-100% - 14px)' : '14px'})`,
            }}
          >
            <p className="font-semibold text-parchment-50">{active.slice.conviction.name}</p>
            <p className="mt-0.5 text-parchment-300">{active.slice.conviction.description}</p>
            <p className="mt-1.5 flex justify-between gap-2 text-parchment-200">
              <span style={{ color: DOMAIN_COLORS[active.slice.domain].text }}>
                {t(`domain.${active.slice.domain}`)} · {t('wheel.ring', { ring: active.slice.ring })}
              </span>
              <span className="tabular-nums">
                {active.points}/{active.slice.capacity}
              </span>
            </p>
            <p className="mt-0.5 text-parchment-400">
              {t(`category.${active.slice.conviction.category}`)} · {active.slice.dedicationLabel}
            </p>
          </div>
        )}
      </div>

      {result && result.revelations.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-2 text-xs" aria-label={t('wheel.revelations')}>
          {QUADRANTS.map((d) => {
            const r = result.revelations.find((x) => x.perk.domain === d);
            if (!r) return <li key={d} aria-hidden="true" />;
            const col = DOMAIN_COLORS[d];
            const next = r.perk.thresholds[r.stage];
            return (
              <li
                key={d}
                title={r.perk.description}
                className={cx('min-w-0 rounded-lg border px-2.5 py-1.5', r.stage > 0 ? 'border-ink-500 bg-ink-850' : 'border-ink-700 opacity-60')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium" style={{ color: col.text }}>{r.perk.name}</span>
                  <span className="flex shrink-0 gap-1" role="img" aria-label={t('results.stage', { stage: r.stage, total: r.perk.thresholds.length })}>
                    {r.perk.thresholds.map((th, i) => (
                      <span key={th} className="size-2 rounded-full ring-1 ring-ink-500" style={{ background: i < r.stage ? col.base : 'transparent' }} />
                    ))}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-parchment-400">
                  {t('wheel.revelationPts', { n: formatNumber(r.domainPoints) })}
                  {next !== undefined && t('results.nextStage', { points: formatNumber(next) })}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-xs text-parchment-400">
        {t('wheel.hint')}
      </p>
    </div>
  );
}
