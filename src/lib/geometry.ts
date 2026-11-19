/**
 * Pure geometry helpers for the SVG Wheel of Destiny chart.
 *
 * Angles are in degrees, measured clockwise from 12 o'clock (matching
 * `Slice.indexInRing`). SVG's y axis points down, so a point at angle `a`
 * and radius `r` is (cx + r·sin a, cy − r·cos a).
 */

export interface Point {
  x: number;
  y: number;
}

export interface RingBounds {
  inner: number;
  outer: number;
}

const round = (n: number) => Math.round(n * 1000) / 1000 + 0; // +0 normalises -0

export function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): Point {
  const a = (angleDeg * Math.PI) / 180;
  return { x: round(cx + r * Math.sin(a)), y: round(cy - r * Math.cos(a)) };
}

/** Start/end angle of a slice within its ring. */
export function sliceAngles(indexInRing: number, slicesInRing: number): [number, number] {
  const step = 360 / Math.max(1, slicesInRing);
  return [indexInRing * step, (indexInRing + 1) * step];
}

/**
 * Inner/outer radius of ring `ring` (1 = innermost) when `ringCount` rings
 * are laid out evenly between `hubRadius` and `outerRadius`.
 */
export function ringBounds(
  ring: number,
  ringCount: number,
  hubRadius: number,
  outerRadius: number,
): RingBounds {
  const width = (outerRadius - hubRadius) / Math.max(1, ringCount);
  return { inner: hubRadius + (ring - 1) * width, outer: hubRadius + ring * width };
}

/**
 * Outer radius that makes the annular sector [inner, r] cover `fraction` of
 * the area of the sector [inner, outer]. Used so a half-filled slice
 * *looks* half full (area-proportional, not radius-proportional).
 */
export function fillRadius(inner: number, outer: number, fraction: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  return Math.sqrt(inner * inner + f * (outer * outer - inner * inner));
}

/**
 * SVG path for an annular sector (a "slice" of a ring).
 * Spans of 360° or more are clamped slightly below a full turn because an
 * SVG arc cannot start and end at the same point.
 */
export function annularSectorPath(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  startDeg: number,
  endDeg: number,
): string {
  let end = endDeg;
  if (end - startDeg >= 360) end = startDeg + 359.9;
  const largeArc = end - startDeg > 180 ? 1 : 0;
  const o0 = polarToCartesian(cx, cy, outer, startDeg);
  const o1 = polarToCartesian(cx, cy, outer, end);
  const i1 = polarToCartesian(cx, cy, inner, end);
  const i0 = polarToCartesian(cx, cy, inner, startDeg);
  return [
    `M ${o0.x} ${o0.y}`,
    `A ${outer} ${outer} 0 ${largeArc} 1 ${o1.x} ${o1.y}`,
    `L ${i1.x} ${i1.y}`,
    inner > 0 ? `A ${inner} ${inner} 0 ${largeArc} 0 ${i0.x} ${i0.y}` : `L ${i0.x} ${i0.y}`,
    'Z',
  ].join(' ');
}

/** Visual centre of an annular sector (mid angle, mid radius). */
export function sectorCentroid(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  startDeg: number,
  endDeg: number,
): Point {
  return polarToCartesian(cx, cy, (inner + outer) / 2, (startDeg + endDeg) / 2);
}
