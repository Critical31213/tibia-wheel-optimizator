import { useId } from 'react';
import type { OwnedWeapon, WeaponPick, WeaponResult } from '../types';
import type { TFunction } from '../i18n';
import { useT } from '../i18n';
import { getAmmo, getShapingOption, getWeapon, levelOptions } from '../lib/api';
import { cx } from '../lib/labels';
import { perkLabel, shapingLabel } from '../lib/weapons';
import { Gain } from './Gain';
import { PerkIcon } from './PerkIcon';
import { Tip } from './Tip';
import { WeaponMeta } from './WeaponsPanel';

/** Alpha strike only pays off when the player hits a fresh target first, i.e. playing solo. */
const SoloNote = ({ kind, t }: { kind?: string; t: TFunction }) =>
  kind === 'alphaStrike' ? <span className="text-weak"> ({t('weaponResult.solo')})</span> : null;

const AmmoNote = ({ pick, t }: { pick: WeaponPick; t: TFunction }) => {
  const a = pick.ammo ? getAmmo(pick.ammo) : undefined;
  return a ? <p className="text-xs text-parchment-300">{t('weaponResult.ammo', { name: a.name })}</p> : null;
};

interface WeaponResultPanelProps {
  result: WeaponResult;
  /** Owned weapons the result was computed with (manual perks, reshapes). */
  owned: readonly OwnedWeapon[];
  suggest: boolean;
  busy: boolean;
  onSuggestChange: (on: boolean) => void;
}

/** D52: the picked perk per level as icons; the effect in a tooltip, manual choices framed in gold. */
function PickPerks({ pick, owned }: { pick: WeaponPick; owned?: OwnedWeapon }) {
  const t = useT();
  const weapon = getWeapon(pick.weaponId);
  if (!weapon) return null;
  const options = levelOptions(owned ?? { level: weapon.levels.length }, weapon);
  const n = pick.perks.length;
  return (
    <ol className="flex flex-wrap gap-1">
      {pick.perks.map((k, i) => {
        const p = options[i]?.[k];
        if (!p) return null;
        const manual = owned?.perks?.[i] != null;
        const label = `${t('weapons.levelN', { n: i + 1 })}: ${perkLabel(t, p)}${p.kind === 'alphaStrike' ? ` (${t('weaponResult.solo')})` : ''}${
          options[i].length > 1 ? ` · ${manual ? t('weaponResult.yours') : t('weaponResult.picked')}` : ''
        }`;
        return (
          <li key={i}>
            <Tip text={label} align={i < 2 ? 'start' : i >= n - 2 ? 'end' : 'center'}>
              <span tabIndex={0} aria-label={label} className={cx('relative block rounded-md border p-0.5', manual ? 'border-gold-400' : 'border-ink-600')}>
                <PerkIcon perk={p} size={24} />
                {p.kind === 'alphaStrike' && <span aria-hidden="true" className="absolute -right-1 -top-1 text-[9px] leading-none text-weak">solo</span>}
              </span>
            </Tip>
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
          <AmmoNote pick={result.best} t={t} />
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
                <span className="min-w-0 truncate text-parchment-100">
                  {getWeapon(p.weaponId)?.name ?? p.weaponId}
                  {p.ammo && <span className="text-xs text-parchment-400"> · {getAmmo(p.ammo)?.name}</span>}
                </span>
                <Gain effect={p.effect} score={p.delta} />
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
                <li key={`${r.level}-${r.option}`} className="flex items-start gap-2 text-sm">
                  {o && <PerkIcon perk={o} size={16} />}
                  <span className="min-w-0 flex-1 text-parchment-100">
                    {t('weaponResult.reshape', { level: r.level, option: o ? shapingLabel(t, o, 10) : r.option })}
                    <SoloNote kind={o?.kind} t={t} />
                    {replaced && (
                      <span className="block text-xs text-parchment-400">{t('weaponResult.replaces', { perk: perkLabel(t, replaced) })}</span>
                    )}
                  </span>
                  <Gain effect={r.effect} score={r.gain} />
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
                    <Gain effect={p.effect} score={p.delta} />
                  </p>
                  {w && <WeaponMeta weapon={w} />}
                  <AmmoNote pick={p} t={t} />
                  <div className="mt-1">
                    <PickPerks pick={p} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </details>
    </div>
  );
}
