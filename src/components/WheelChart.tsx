import { useMemo, useState } from 'react';
import type { OptimizerResult, Slice, WheelDefinition } from '../types';
import { annularSectorPath, fillRadius, ringBounds, sectorCentroid, sliceAngles } from '../lib/geometry';
import { useT } from '../i18n';
import { DOMAIN_COLORS, DOMAINS, formatNumber } from '../lib/labels';

const SIZE = 400;
const C = SIZE / 2;
const HUB = 34;
const OUTER = 192;

interface WheelChartProps {
  wheel: WheelDefinition;
  result: OptimizerResult | null;
}

interface SliceShape {
  slice: Slice;
  points: number;
  order: number;
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
    const order = new Map(result?.path.map((id, i) => [id, i + 1]) ?? []);
    return wheel.slices.map((slice) => {
      const [a0, a1] = sliceAngles(slice.indexInRing, slice.slicesInRing);
      const { inner, outer } = ringBounds(slice.ring, ringCount, HUB, OUTER);
      const points = result?.allocation[slice.id] ?? 0;
      const frac = slice.capacity > 0 ? points / slice.capacity : 0;
      return {
        slice,
        points,
        order: order.get(slice.id) ?? 0,
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
          {shapes
            .filter((s) => s.order > 0)
            .map(({ slice, order, centroid }) => (
              <g key={`b-${slice.id}`} pointerEvents="none" aria-hidden="true">
                <circle cx={centroid.x} cy={centroid.y} r={8.5} fill="#0d0a07" fillOpacity={0.85} stroke="#f3d27c" strokeWidth={1} />
                <text x={centroid.x} y={centroid.y + 3} textAnchor="middle" fontSize={order > 99 ? 7 : 9} fontWeight={700} fill="#f3d27c">
                  {order}
                </text>
              </g>
            ))}
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
              {active.order > 0 && ` · ${t('wheel.step', { n: active.order })}`}
            </p>
          </div>
        )}
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4" aria-label={t('wheel.legend')}>
        {DOMAINS.map((d) => (
          <li key={d} className="flex items-center gap-2">
            <span aria-hidden="true" className="size-3 rounded-sm" style={{ background: DOMAIN_COLORS[d].base }} />
            <span className="text-parchment-300">{t(`domain.${d}`)}</span>
            <span className="ml-auto tabular-nums text-parchment-100">{formatNumber(result?.domainPoints[d] ?? 0)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-parchment-400">
        {t('wheel.hint')}
      </p>
    </div>
  );
}
