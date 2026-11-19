import type { GainEffect } from '../types';
import { useT } from '../i18n';
import { cx, formatNumber } from '../lib/labels';
import { Tip } from './Tip';

/** Signed with one decimal (two below 0.1). */
const signed = (n: number) => {
  const a = Math.abs(n);
  const r = a < 0.1 ? Math.round(a * 100) / 100 : Math.round(a * 10) / 10;
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${formatNumber(r)}`;
};

const SHOWN = 0.05;

/**
 * D55: a gain as % damage per turn and % effective HP; the blended optimizer score only in the tooltip
 * (or shown when neither part is visible, e.g. utility).
 */
export function Gain({ effect, score, align = 'end', className }: { effect?: GainEffect; score: number; align?: 'start' | 'center' | 'end'; className?: string }) {
  const t = useT();
  const dmg = effect && Math.abs(effect.dmg) >= SHOWN ? effect.dmg : null;
  const ehp = effect && Math.abs(effect.ehp) >= SHOWN ? effect.ehp : null;
  const tip = t('gain.tip', { dmg: signed(effect?.dmg ?? 0), ehp: signed(effect?.ehp ?? 0), score: signed(score) });
  return (
    <Tip text={tip} align={align}>
      <span tabIndex={0} aria-label={tip} className={cx('inline-flex shrink-0 gap-1.5 whitespace-nowrap text-xs tabular-nums', className)}>
        {dmg !== null && <span className={dmg > 0 ? 'text-offense' : 'text-resist'}>{t('gain.dmg', { v: signed(dmg) })}</span>}
        {ehp !== null && <span className={ehp > 0 ? 'text-defense' : 'text-resist'}>{t('gain.ehp', { v: signed(ehp) })}</span>}
        {dmg === null && ehp === null && <span className="text-parchment-300">{t('gain.score', { v: signed(score) })}</span>}
      </span>
    </Tip>
  );
}
