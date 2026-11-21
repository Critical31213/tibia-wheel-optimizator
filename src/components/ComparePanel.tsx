import { useId } from 'react';
import type { ComparisonItem, Vocation, WheelComparison, WheelVariant } from '../types';
import { engineText, useT } from '../i18n';
import { MAX_COMPARE_CODE, type OwnWheel } from '../lib/compare';
import { wheelVariants } from '../lib/api';
import { cx, VOCATION_LABELS } from '../lib/labels';
import { Gain } from './Gain';

const STAGE = ['0', 'I', 'II', 'III'];

const VERDICT_STYLE: Record<WheelComparison['verdict'], string> = {
  equal: 'border-weak/50 bg-weak/10 text-weak',
  better: 'border-weak/50 bg-weak/10 text-weak',
  close: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  worse: 'border-resist/50 bg-resist/10 text-resist',
};

interface ComparePanelProps {
  code: string;
  onCode: (code: string) => void;
  own: OwnWheel | null;
  vocation: Vocation;
  variant: WheelVariant;
  onVariant: (v: WheelVariant) => void;
  /** Comparison of the shown build (undefined while computing or without a valid code). */
  comparison?: WheelComparison;
  showOwn: boolean;
  onShowOwn: (v: boolean) => void;
}

function ItemRow({ item, live }: { item: ComparisonItem; live: boolean }) {
  const t = useT();
  const values =
    item.kind === 'revelation'
      ? t('compare.stages', { own: STAGE[item.own], best: STAGE[item.best] })
      : item.kind === 'vessels'
        ? t('compare.count', { own: item.own, best: item.best })
        : t('compare.points', { own: item.own, best: item.best });
  return (
    <li className="flex items-center gap-2 rounded-lg border border-ink-700 px-2.5 py-1.5 text-sm">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-parchment-100">{item.kind === 'vessels' ? t(live ? 'compare.vessels.resonance' : 'compare.vessels.global') : item.name}</span>
        <span className="text-xs text-parchment-400">{values}</span>
      </span>
      <Gain effect={item.effect} score={item.score} />
    </li>
  );
}

/** D89: the player's own wheel (planner code) compared with the optimal build. */
export function ComparePanel({ code, onCode, own, vocation, variant, onVariant, comparison, showOwn, onShowOwn }: ComparePanelProps) {
  const t = useT();
  const id = useId();
  const status = !code.trim()
    ? null
    : !own
      ? t('compare.invalidCode')
      : own.vocation !== vocation
        ? t('compare.otherVocation', { vocation: VOCATION_LABELS[own.vocation] })
        : !wheelVariants().includes(own.variant)
          ? t('compare.retiredVariant')
          : null;
  const otherVariant = own && own.vocation === vocation && own.variant !== variant && wheelVariants().includes(own.variant) ? own.variant : null;
  const better = comparison?.items.filter((x) => x.score > 1e-6) ?? [];
  const worse = comparison?.items.filter((x) => x.score < -1e-6) ?? [];

  return (
    <div>
      <label htmlFor={`${id}-code`} className="text-xs text-parchment-300">
        {t('compare.codeLabel')}
      </label>
      <input
        id={`${id}-code`}
        type="text"
        value={code}
        maxLength={MAX_COMPARE_CODE}
        spellCheck={false}
        placeholder={t('compare.placeholder')}
        onChange={(e) => onCode(e.target.value)}
        className="field mt-1 font-mono text-xs"
      />
      <p className="mt-1 text-xs text-parchment-400">{t('compare.hint')}</p>
      {status && (
        <p role="status" className="mt-2 text-xs text-amber-300">
          {status}
        </p>
      )}
      {otherVariant && (
        <p role="status" className="mt-2 flex flex-wrap items-center gap-2 text-xs text-amber-300">
          {t('compare.otherVariant', { variant: t(`wheelVariant.${otherVariant}`) })}
          <button type="button" onClick={() => onVariant(otherVariant)} className="field w-auto px-2 py-1 text-xs">
            {t('compare.switchVariant')}
          </button>
        </p>
      )}

      {comparison && (
        <div className="mt-3">
          <div className={cx('rounded-lg border px-3 py-2 text-sm', VERDICT_STYLE[comparison.verdict])}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 font-medium">{engineText(t, comparison.reasonMsgs[0], comparison.reasons[0])}</span>
              {comparison.verdict !== 'equal' && (
                <span className="text-xs text-parchment-300">
                  {t('compare.optimalGives')} <Gain effect={comparison.effect} score={comparison.score} align="end" />
                </span>
              )}
            </div>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-parchment-300">
            <input type="checkbox" checked={showOwn} onChange={(e) => onShowOwn(e.target.checked)} />
            {t('compare.showOwn')}
          </label>

          {better.length > 0 && (
            <>
              <h3 className="mt-3 mb-1 text-xs font-semibold tracking-wider text-parchment-400 uppercase">{t('compare.betterTitle')}</h3>
              <ul className="space-y-1">
                {better.slice(0, 8).map((x) => (
                  <ItemRow key={x.kind + x.id} item={x} live={variant === 'live'} />
                ))}
              </ul>
            </>
          )}
          {worse.length > 0 && (
            <>
              <h3 className="mt-3 mb-1 text-xs font-semibold tracking-wider text-parchment-400 uppercase">{t('compare.worseTitle')}</h3>
              <ul className="space-y-1">
                {worse.slice(0, 8).map((x) => (
                  <ItemRow key={x.kind + x.id} item={x} live={variant === 'live'} />
                ))}
              </ul>
            </>
          )}
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-parchment-200 marker:text-gold-500">
            {comparison.reasons.slice(1).map((r, i) => (
              <li key={r}>{engineText(t, comparison.reasonMsgs[i + 1], r)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
