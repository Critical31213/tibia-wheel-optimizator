import type { GemQuality } from '../types';
import { cx, QUALITY_COLORS } from '../lib/labels';

/** Small faceted diamond tinted by gem / vessel quality. */
export function GemIcon({ quality, dim, className }: { quality: GemQuality; dim?: boolean; className?: string }) {
  const c = QUALITY_COLORS[quality];
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cx('size-4 shrink-0', dim && 'opacity-40', className)}>
      <path d="M4 2h8l3 4-7 8-7-8z" fill={c} fillOpacity={0.35} stroke={c} strokeWidth={1.2} strokeLinejoin="round" />
      <path d="M1 6h14M6 2 8 14l2-12" fill="none" stroke={c} strokeWidth={0.8} strokeOpacity={0.8} />
    </svg>
  );
}
