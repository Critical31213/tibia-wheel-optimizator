import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActivatedRevelation, Domain, ModDefinition, Slice, VesselAssignment, WheelDefinition, WheelVariant } from '../types';
import type { BuildResult } from '../lib/api';
import { getWheelData } from '../data/wheel';
import { useT } from '../i18n';
import { cx, DOMAIN_COLORS, formatNumber } from '../lib/labels';
import { VesselGems } from './VesselGems';

/**
 * D106: the wheel drawn like the official planner (test server): its backdrop, vocation front, corner and perk icon
 * sheets (© CipSoft GmbH, `public/wheel/`) composed on a canvas with the planner's geometry and colours.
 */
const SIZE = 522;
const C = 261;
const RING = 50;
const GAP = 2;
const RAD = Math.PI / 180;
const inner = (r: number) => r * (RING + GAP) + 1;
const outer = (r: number) => inner(r) + RING;

const UNLOCKED: Record<Domain, string> = { topLeft: '#46b21c31', topRight: '#ae143431', bottomLeft: '#198d4031', bottomRight: '#841d9e31' };
const FILLED: Record<Domain, string> = { topLeft: '#94c4126b', topRight: '#ef1a386b', bottomLeft: '#18cd8f6b', bottomRight: '#e618da6b' };
const HOVER = '#80808067';
/** Corner angle base (the revelation circle sits at base + 45°) and rotation of the corner art. */
const CORNER: Record<Domain, { base: number; rotate: number; mirror: boolean }> = {
  topLeft: { base: 180, rotate: 0, mirror: false },
  topRight: { base: 270, rotate: 90, mirror: true },
  bottomLeft: { base: 90, rotate: 270, mirror: true },
  bottomRight: { base: 0, rotate: 180, mirror: false },
};
const CORNER_R = 25;
const corner = (d: Domain) => {
  const a = (CORNER[d].base + 45) * RAD;
  return { x: Math.round(Math.cos(a) * 311) + C, y: Math.round(Math.sin(a) * 311) + C };
};
/** Slice angles (degrees, clockwise from 3 o'clock) by planner tile name, ring index 0 = centre. */
const TILES: Record<string, [number, number, number]> = {};
{
  const q: [string, number][] = [['TL', 180], ['TR', 270], ['BR', 0], ['BL', 90]];
  // Tile number → [ring, start offset, end offset] in the TL quarter; other quarters mirror the order.
  const tl: Record<number, [number, number, number]> = {
    0: [0, 0, 90], 1: [1, 0, 45], 3: [1, 45, 90], 2: [2, 0, 30], 4: [2, 30, 60], 6: [2, 60, 90], 5: [3, 15, 45], 7: [3, 45, 75], 8: [4, 15, 75],
  };
  for (const [name, base] of q) {
    const flip = name === 'TR' || name === 'BL';
    for (const [n, [r, a, b]] of Object.entries(tl)) TILES[`Q${name}${n}`] = flip ? [r, base + 90 - b, base + 90 - a] : [r, base + a, base + b];
  }
}
const THRESHOLDS = [0, 250, 500, 1000];
/** Legend order (2 columns, like the wheel quadrants). */
const QUADRANTS: readonly Domain[] = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
const VOC_FRONT = { knight: 'knight', paladin: 'paladin', sorcerer: 'sorc', druid: 'druid', monk: 'monk' } as const;

const IMAGES = {
  backdrop: 'backdrop_skillwheel',
  corner: 'backdrop_skillwheel_largebonus',
  light: 'backdrop_skillwheel_largebonus_light',
  front0: 'backdrop_skillwheel_largebonus_front0',
  front1: 'backdrop_skillwheel_largebonus_front1',
  front2: 'backdrop_skillwheel_largebonus_front2',
  front3: 'backdrop_skillwheel_largebonus_front3',
  large: 'icons-skillwheel-largeperks',
  medium: 'icons-skillwheel-mediumperks',
  small: 'icons-skillwheel-smallperks',
  knight: 'backdrop_skillwheel_front_knight',
  paladin: 'backdrop_skillwheel_front_paladin',
  sorc: 'backdrop_skillwheel_front_sorc',
  druid: 'backdrop_skillwheel_front_druid',
  monk: 'backdrop_skillwheel_front_monk',
} as const;
type Images = Record<keyof typeof IMAGES, HTMLImageElement>;
const wheelImage = (file: string) => `${import.meta.env.BASE_URL}wheel/${file}.png`;

let loading: Promise<Images> | null = null;
function loadImages(): Promise<Images> {
  loading ??= Promise.all(
    Object.entries(IMAGES).map(
      ([k, f]) =>
        new Promise<[string, HTMLImageElement]>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve([k, img]);
          img.onerror = reject;
          img.src = wheelImage(f);
        }),
    ),
  ).then((e) => Object.fromEntries(e) as Images);
  return loading;
}

function sector(ctx: CanvasRenderingContext2D, r0: number, r1: number, a0: number, a1: number) {
  ctx.beginPath();
  if (r0 === 0) ctx.moveTo(C, C);
  else ctx.arc(C, C, r0, a0, a1, false);
  ctx.arc(C, C, r1, a1, a0, true);
  ctx.closePath();
}

function fill(ctx: CanvasRenderingContext2D, color: string) {
  ctx.fillStyle = color;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fill('evenodd');
}

function pie(ctx: CanvasRenderingContext2D, frac: number, x: number, y: number) {
  ctx.beginPath();
  if (frac !== 1) ctx.moveTo(x, y);
  ctx.arc(x, y, CORNER_R, -90 * RAD, (360 * frac - 90) * RAD, false);
  ctx.closePath();
}

function rotate(ctx: CanvasRenderingContext2D, deg: number) {
  ctx.translate(C, C);
  ctx.rotate(deg * RAD);
  ctx.translate(-C, -C);
}

function mirror(ctx: CanvasRenderingContext2D, img: HTMLImageElement) {
  ctx.translate(img.height / 2, img.width / 2);
  ctx.rotate(-90 * RAD);
  ctx.scale(-1, 1);
  ctx.translate(-img.width / 2, -img.height / 2);
}

interface TileInfo {
  slice: Slice;
  ring: number;
  a0: number;
  a1: number;
  points: number;
  unlocked: boolean;
  medium: number;
  small: number;
}

interface CornerInfo {
  domain: Domain;
  stage: number;
  frac: number;
  largePerkId: number;
  revelation?: ActivatedRevelation;
}

function draw(ctx: CanvasRenderingContext2D, img: Images, vocationFront: keyof Images, tiles: TileInfo[], corners: CornerInfo[], hover: string | null) {
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.drawImage(img.backdrop, 0, 0);
  ctx.save();
  for (const t of tiles) {
    const r0 = inner(t.ring);
    const r1 = outer(t.ring);
    const frac = t.slice.capacity ? t.points / t.slice.capacity : 0;
    const f = r0 + frac * (r1 - r0);
    if (frac > 0) {
      sector(ctx, r0, frac < 0.5 ? Math.ceil(f) : Math.floor(f), t.a0 * RAD, t.a1 * RAD);
      fill(ctx, FILLED[t.slice.domain]);
    }
    if (t.unlocked) {
      sector(ctx, r0, r1, t.a0 * RAD, t.a1 * RAD);
      fill(ctx, UNLOCKED[t.slice.domain]);
    }
  }
  ctx.restore();
  const hovered = tiles.find((t) => t.slice.id === hover);
  if (hovered) {
    ctx.save();
    sector(ctx, inner(hovered.ring), outer(hovered.ring), hovered.a0 * RAD, hovered.a1 * RAD);
    fill(ctx, HOVER);
    ctx.restore();
  }
  ctx.drawImage(img[vocationFront], 0, 0);

  const m = img.medium.height;
  const s = img.small.height;
  for (const t of tiles) {
    const a = ((t.a0 + t.a1) / 2) * RAD;
    let r = (inner(t.ring) + outer(t.ring)) / 2;
    if (r < outer(0)) r += 2;
    const x = Math.round(Math.cos(a) * r + C - m / 2);
    const y = Math.round(Math.sin(a) * r + C - m / 2);
    ctx.drawImage(img.medium, t.medium * m, 0, m, m, x, y, m, m);
    ctx.drawImage(img.small, t.small * s, 0, s, s, x - 3, y + 17, s, s);
  }

  for (const k of corners) {
    const { rotate: deg, mirror: flip, base } = CORNER[k.domain];
    const { x, y } = corner(k.domain);
    ctx.save();
    if (deg) rotate(ctx, deg);
    if (flip) mirror(ctx, img.corner);
    ctx.drawImage(img.corner, 0, 0);
    ctx.restore();
    ctx.save();
    pie(ctx, k.frac, x, y);
    fill(ctx, FILLED[k.domain]);
    pie(ctx, 1, x, y);
    fill(ctx, UNLOCKED[k.domain]);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, 270, (base + 40) * RAD, (base + 50) * RAD, false);
    ctx.arc(C, C, 285, (base + 50) * RAD, (base + 40) * RAD, true);
    ctx.closePath();
    for (let i = 0; i < 3; i++) fill(ctx, FILLED[k.domain]);
    ctx.restore();
    if (hover === k.domain) {
      ctx.save();
      pie(ctx, 1, x, y);
      fill(ctx, HOVER);
      ctx.restore();
    }
    ctx.save();
    if (deg) rotate(ctx, deg);
    ctx.globalAlpha = 0.4;
    ctx.drawImage(img.light, 0, 0);
    ctx.restore();
    const front = img[`front${Math.min(3, k.stage)}` as 'front0'];
    ctx.save();
    if (deg) rotate(ctx, deg);
    if (flip) mirror(ctx, front);
    ctx.drawImage(front, 0, 0);
    ctx.restore();
    const l = img.large.height;
    ctx.drawImage(img.large, k.largePerkId * l, 0, l, l, x - l / 2, y - l / 2, l, l);
  }

  if (hovered) {
    ctx.save();
    sector(ctx, inner(hovered.ring) - GAP / 2, outer(hovered.ring) + GAP / 2, hovered.a0 * RAD, hovered.a1 * RAD);
    ctx.lineWidth = GAP;
    ctx.strokeStyle = 'white';
    ctx.stroke();
    ctx.restore();
  }
}

/** Slice (planner tile name) or corner domain under a canvas point. */
function hitTest(tiles: TileInfo[], x: number, y: number): string | null {
  for (const d of Object.keys(CORNER) as Domain[]) {
    const c = corner(d);
    if (Math.hypot(c.x - x, c.y - y) <= CORNER_R) return d;
  }
  const dx = x - C;
  const dy = y - C;
  const r = Math.hypot(dx, dy);
  const a = ((Math.atan2(dy, dx) / RAD) + 360) % 360;
  const t = tiles.find((t) => inner(t.ring) - GAP / 2 <= r && r <= outer(t.ring) + GAP / 2 && t.a0 <= a && a < t.a1);
  return t?.slice.id ?? null;
}

interface WheelChartProps {
  wheel: WheelDefinition;
  variant: WheelVariant;
  result: Pick<BuildResult, 'allocation' | 'pointsUsed' | 'revelations'> | null;
  /** D106: gems of the build's vessels, shown under the wheel. */
  vessels?: VesselAssignment[];
  mods: ModDefinition[];
}

export function WheelChart({ wheel, variant, result, vessels, mods }: WheelChartProps) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState<Images | null>(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadImages().then(
      (img) => live && setImages(img),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  const data = useMemo(() => getWheelData(wheel.vocation, variant), [wheel.vocation, variant]);
  const tiles = useMemo<TileInfo[]>(() => {
    const alloc = result?.allocation ?? {};
    const full = new Set(wheel.slices.filter((s) => (alloc[s.id] ?? 0) >= s.capacity).map((s) => s.id));
    const largeOf = new Map(data.revelations.map((r) => [r.domain, r.largePerkId]));
    return wheel.slices.flatMap((slice) => {
      const tile = data.tiles.find((x) => x.tileName === slice.id);
      const geo = TILES[slice.id];
      if (!tile || !geo) return [];
      const points = alloc[slice.id] ?? 0;
      return [{
        slice,
        ring: geo[0],
        a0: geo[1],
        a1: geo[2],
        points,
        unlocked: points > 0 || tile.initiallyUnlocked || slice.adjacent.some((a) => full.has(a)),
        medium: tile.conviction.id + (tile.conviction.category === 'revelationMastery' ? (largeOf.get(tile.domain) ?? 0) : 0),
        small: tile.dedication.smallPerkId,
      }];
    });
  }, [wheel, data, result]);
  const corners = useMemo<CornerInfo[]>(
    () =>
      data.revelations.map((r) => {
        const revelation = result?.revelations.find((x) => x.perk.domain === r.domain);
        const pts = revelation?.domainPoints ?? 0;
        const stage = revelation?.stage ?? 0;
        const lo = THRESHOLDS[stage];
        const hi = THRESHOLDS[stage + 1];
        return { domain: r.domain, stage, largePerkId: r.largePerkId, revelation, frac: hi === undefined ? 1 : Math.max(0, Math.min(1, (pts - lo) / (hi - lo))) };
      }),
    [data, result],
  );

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx || !images) return;
    ctx.imageSmoothingEnabled = false;
    draw(ctx, images, VOC_FRONT[wheel.vocation], tiles, corners, hover);
  }, [images, tiles, corners, hover, wheel.vocation]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * SIZE) / r.width, y: ((e.clientY - r.top) * SIZE) / r.height };
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = point(e);
    setHover(hitTest(tiles, p.x, p.y));
  };

  const tile = tiles.find((x) => x.slice.id === hover);
  const cornerHover = corners.find((k) => k.domain === hover);
  const anchor = tile
    ? (() => {
        const a = ((tile.a0 + tile.a1) / 2) * RAD;
        const r = (inner(tile.ring) + outer(tile.ring)) / 2;
        return { x: C + Math.cos(a) * r, y: C + Math.sin(a) * r };
      })()
    : cornerHover
      ? corner(cornerHover.domain)
      : null;
  const revOf = (d: Domain) => wheel.revelations.find((r) => r.domain === d);

  return (
    <div>
      <div className="relative mx-auto aspect-square w-full max-w-[522px]">
        <canvas
          ref={canvas}
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label={t('wheel.aria')}
          className={cx('size-full touch-manipulation', hover && 'cursor-pointer')}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        />
        {failed && <p className="absolute inset-0 grid place-items-center text-xs text-parchment-400">{t('wheel.imagesFailed')}</p>}

        {anchor && (tile || cornerHover) && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 w-56 rounded-lg border border-gold-700 bg-ink-850/95 p-2.5 text-xs shadow-xl shadow-black/60"
            style={{
              left: `${Math.min(78, Math.max(22, (anchor.x / SIZE) * 100))}%`,
              top: `${(anchor.y / SIZE) * 100}%`,
              transform: `translate(-50%, ${anchor.y > C ? 'calc(-100% - 18px)' : '18px'})`,
            }}
          >
            {tile ? (
              <>
                <p className="font-semibold text-parchment-50">{tile.slice.conviction.name}</p>
                <p className="mt-0.5 text-parchment-300">{tile.slice.conviction.description}</p>
                <p className="mt-1.5 flex justify-between gap-2 text-parchment-200">
                  <span style={{ color: DOMAIN_COLORS[tile.slice.domain].text }}>
                    {t(`domain.${tile.slice.domain}`)} · {t('wheel.ring', { ring: tile.slice.ring })}
                  </span>
                  <span className="tabular-nums">
                    {tile.points}/{tile.slice.capacity}
                  </span>
                </p>
                <p className="mt-0.5 text-parchment-400">
                  {t(`category.${tile.slice.conviction.category}`)} · {tile.slice.dedicationLabel}
                </p>
              </>
            ) : (
              cornerHover && (
                <>
                  <p className="font-semibold" style={{ color: DOMAIN_COLORS[cornerHover.domain].text }}>
                    {revOf(cornerHover.domain)?.name}
                  </p>
                  <p className="mt-0.5 text-parchment-300">{revOf(cornerHover.domain)?.description}</p>
                  <p className="mt-1.5 flex justify-between gap-2 text-parchment-200">
                    <span>
                      {t('results.stage', { stage: cornerHover.stage, total: 3 })}
                      {cornerHover.stage < 3 && t('results.nextStage', { points: formatNumber(THRESHOLDS[cornerHover.stage + 1]) })}
                    </span>
                    <span className="tabular-nums">{t('wheel.revelationPts', { n: formatNumber(cornerHover.revelation?.domainPoints ?? 0) })}</span>
                  </p>
                </>
              )
            )}
          </div>
        )}
        <ul className="sr-only">
          {tiles.map((x) => (
            <li key={x.slice.id}>
              {t('wheel.sliceAria', { domain: t(`domain.${x.slice.domain}`), ring: x.slice.ring, name: x.slice.conviction.name, points: x.points, capacity: x.slice.capacity })}
            </li>
          ))}
        </ul>
      </div>

      {vessels && vessels.length > 0 && <VesselGems vocation={wheel.vocation} vessels={vessels} mods={mods} />}

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
        {t('wheel.pointsUsed', { n: formatNumber(result?.pointsUsed ?? 0) })} · {t('wheel.hint')} {t('wheel.credit')}
      </p>
    </div>
  );
}
