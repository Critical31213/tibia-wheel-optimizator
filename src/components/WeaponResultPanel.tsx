import { useId } from 'react';
import type { OwnedWeapon, WeaponPick, WeaponResult } from '../types';
import { useT } from '../i18n';
import { getShapingOption, getWeapon, levelOptions } from '../lib/api';
import { formatNumber } from '../lib/labels';
import { perkLabel, shapingLabel } from '../lib/weapons';
import { WeaponMeta } from './WeaponsPanel';

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${formatNumber(Math.abs(Math.round(n * 10) / 10))}`;

interface WeaponResultPanelProps {
  result: WeaponResult;
  /** Owned weapons the result was computed with (manual perks, reshapes). */
  owned: readonly OwnedWeapon[];
  suggest: boolean;
  busy: boolean;
  onSuggestChange: (on: boolean) => void;
}

function PickPerks({ pick, owned }: { pick: WeaponPick; owned?: OwnedWeapon }) {
  const t = useT();
  const weapon = getWeapon(pick.weaponId);
  if (!weapon) return null;
  const options = levelOptions(owned ?? { level: weapon.levels.length }, weapon);
  return (
    <ol className="flex flex-col gap-0.5 text-xs">
      {pick.perks.map((k, i) => {
        const p = options[i]?.[k];
        if (!p) return null;
        const manual = owned?.perks?.[i] != null;
        return (
          <li key={i} className="flex gap-2">
            <span className="w-6 shrink-0 text-right tabular-nums text-parchment-400">{i + 1}.</span>
            <span className="min-w-0 flex-1 text-parchment-100">{perkLabel(t, p)}</span>
            {options[i].length > 1 && (
              <span className="shrink-0 text-parchment-400">{manual ? t('weaponResult.yours') : t('weaponResult.picked')}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** D47: chosen weapon with its perks, the other owned weapons, dust reshapes and (optional) unowned suggestions. */
export function WeaponResultPanel({ result, owned, suggest, busy, onSuggestChange }: WeaponResultPanelProps) {
  const t = useT();
  const suggestId = useId();
  const ownedOf = (id: string) => owned.find((w) => w.weaponId === id);
  const best = getWeapon(result.best.weaponId);
  const bestOwned = ownedOf(result.best.weaponId);
  const others = result.ranking.slice(1);
  const bestOptions = best && bestOwned ? levelOptions({ level: bestOwned.level }, best) : [];

  return (
    <div className="flex flex-col gap-4">
      {best && (
        <section aria-label={t('weaponResult.best')}>
          <h3 className="text-xs uppercase tracking-wide text-parchment-400">{t('weaponResult.best')}</h3>
          <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm font-medium text-gold-300">
            {best.name} <WeaponMeta weapon={best} />
          </p>
          <div className="mt-1">
            <PickPerks pick={result.best} owned={bestOwned} />
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section aria-label={t('weaponResult.ranking')}>
          <h3 className="mb-1 text-xs uppercase tracking-wide text-parchment-400">{t('weaponResult.ranking')}</h3>
          <ul className="flex flex-col gap-1">
            {others.map((p) => (
              <li key={p.weaponId} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-parchment-100">{getWeapon(p.weaponId)?.name ?? p.weaponId}</span>
                <span className="shrink-0 text-xs tabular-nums text-parchment-400">{t('weaponResult.delta', { delta: signed(p.delta) })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.reshapes.length > 0 && (
        <section aria-label={t('weaponResult.reshapes')}>
          <h3 className="mb-1 text-xs uppercase tracking-wide text-parchment-400">{t('weaponResult.reshapes')}</h3>
          <ul className="flex flex-col gap-1.5">
            {result.reshapes.map((r) => {
              const o = getShapingOption(r.option);
              const replaced = bestOptions[r.level - 1]?.[r.replaces];
              return (
                <li key={`${r.level}-${r.option}`} className="flex items-start justify-between gap-2 text-sm">
                  <span className="min-w-0 text-parchment-100">
                    {t('weaponResult.reshape', { level: r.level, option: o ? shapingLabel(t, o, 10) : r.option })}
                    {replaced && (
                      <span className="block text-xs text-parchment-400">{t('weaponResult.replaces', { perk: perkLabel(t, replaced) })}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-weak">{t('weaponResult.gain', { gain: signed(r.gain) })}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <details
        open={suggest}
        onToggle={(e) => {
          const open = (e.currentTarget as HTMLDetailsElement).open;
          if (open !== suggest) onSuggestChange(open);
        }}
      >
        <summary id={suggestId} className="cursor-pointer text-sm text-gold-400 hover:underline">
          {t('weaponResult.suggest')}
        </summary>
        <p className="mt-1 text-[11px] text-parchment-400">{t('weaponResult.suggestHint')}</p>
        {!result.suggestions ? (
          <p className="mt-1 text-xs text-parchment-300">{busy ? t('weaponResult.computing') : ''}</p>
        ) : result.suggestions.length === 0 ? (
          <p className="mt-1 text-xs text-parchment-300">{t('weaponResult.noSuggestions')}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-3" aria-labelledby={suggestId}>
            {result.suggestions.map((p) => {
              const w = getWeapon(p.weaponId);
              return (
                <li key={p.weaponId}>
                  <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
                    <span className="text-parchment-100">{w?.name ?? p.weaponId}</span>
                    <span className="text-xs tabular-nums text-weak">{t('weaponResult.gain', { gain: signed(p.delta) })}</span>
                  </p>
                  {w && <WeaponMeta weapon={w} />}
                  <div className="mt-1">
                    <PickPerks pick={p} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </details>
      <p className="text-[11px] text-parchment-400">{t('weaponResult.units')}</p>
    </div>
  );
}
