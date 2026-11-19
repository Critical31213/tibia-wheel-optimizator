import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { GemQuality, GemRecommendation, ModDefinition, ModGrade, OwnedGem, UpgradeRecommendation, Vocation } from '../types';
import type { BuildResult } from '../lib/api';
import { engineText, useT } from '../i18n';
import { findMod, GEM_QUALITIES, slotKind, slotsForQuality } from '../lib/gems';
import { recommendationsByQuality } from '../lib/vessels';
import { cx, formatNumber, gemName, ROMAN } from '../lib/labels';
import { GemIcon } from './GemIcon';

function SubHeading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mt-5 mb-2 flex items-center justify-between gap-2 first:mt-0">
      <h3 className="text-xs font-semibold tracking-wider text-parchment-400 uppercase">{children}</h3>
      {aside}
    </div>
  );
}

const Empty = ({ children }: { children: string }) => <p className="text-sm text-parchment-400">{children}</p>;

const gain = (n: number) => `+${formatNumber(Math.round(n * 10) / 10)}`;

function ModChip({ name, grade }: { name: string; grade: ModGrade }) {
  return (
    <li className="rounded-full border border-ink-600 bg-ink-950/60 px-2 py-0.5 text-[11px] text-parchment-200">
      {name} <span className="text-gold-300">{ROMAN[grade]}</span>
    </li>
  );
}

function GemMods({ gem, mods }: { gem: OwnedGem; mods: ModDefinition[] }) {
  const refs = slotsForQuality(gem.quality).flatMap((slot) => {
    const ref = gem[slot];
    return ref ? [{ slot, ref, name: findMod(mods, slotKind(slot), ref.modId)?.name ?? `#${ref.modId}` }] : [];
  });
  if (!refs.length) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-1">
      {refs.map(({ slot, ref, name }) => (
        <ModChip key={slot} name={name} grade={ref.grade} />
      ))}
    </ul>
  );
}

interface VesselsPanelProps {
  vocation: Vocation;
  result: BuildResult;
  mods: ModDefinition[];
  /** Adds a recommended gem to the character (hidden when absent). */
  onAddGem?: (rec: GemRecommendation) => void;
  /** Applies a +1 grade upgrade to every gem with the mod (hidden when absent). */
  onUpgrade?: (u: UpgradeRecommendation) => void;
}

/** Vessel placement, gem recommendations, upgrades and per-context spell usage. */
export function VesselsPanel({ vocation, result, mods, onAddGem, onUpgrade }: VesselsPanelProps) {
  const t = useT();
  const spellsId = useId();
  const [spellsOpen, setSpellsOpen] = useState(false);
  const [closed, setClosed] = useState<ReadonlySet<GemQuality>>(new Set());
  const toggle = (q: GemQuality) =>
    setClosed((s) => {
      const n = new Set(s);
      if (!n.delete(q)) n.add(q);
      return n;
    });
  const recs = useMemo(() => recommendationsByQuality(result.gemRecommendations), [result.gemRecommendations]);

  return (
    <div>
      {result.vessels.length === 0 ? (
        <Empty>{t('vessels.none')}</Empty>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {result.vessels.map((v) => (
            <li
              key={v.vesselId}
              className={cx('rounded-lg border p-2.5', v.unlocked ? 'border-ink-500 bg-ink-850' : 'border-ink-700 opacity-60')}
            >
              <div className="flex items-center gap-2 text-xs">
                <GemIcon quality={v.quality} dim={!v.unlocked} />
                <span className="font-medium text-parchment-100">
                  {t('vessels.vesselN', { n: v.vesselId + 1 })}
                </span>
                <span className="text-parchment-400">{t(`quality.${v.quality}`)}</span>
                <span className={cx('ml-auto', v.unlocked ? 'text-weak' : 'text-parchment-400')}>
                  {v.unlocked ? t('vessels.unlocked') : t('vessels.locked')}
                </span>
              </div>
              {v.gem && v.source === 'owned' ? (
                <div className="mt-1.5">
                  <div className="flex items-center gap-2 text-sm text-parchment-200">
                    <span className="min-w-0 flex-1 truncate">{gemName(vocation, v.gem.quality)}</span>
                    <span className="shrink-0 rounded-full bg-weak/15 px-1.5 py-0.5 text-[10px] text-weak uppercase">{t('vessels.owned')}</span>
                  </div>
                  <GemMods gem={v.gem} mods={mods} />
                </div>
              ) : (
                <p className={cx('mt-1.5 text-xs', v.unlocked ? 'text-amber-300' : 'text-parchment-400')}>
                  {v.unlocked ? t('vessels.emptyAdd') : t('vessels.empty')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <SubHeading>{t('recs.title')}</SubHeading>
      <div className="flex flex-col gap-3">
        {GEM_QUALITIES.map((q) => (
          <section key={q} aria-label={gemName(vocation, q)}>
            <h4 className="mb-1">
              <button
                type="button"
                aria-expanded={!closed.has(q)}
                onClick={() => toggle(q)}
                className="flex w-full items-center gap-2 text-left text-sm font-medium text-parchment-100 hover:text-gold-300"
              >
                <span aria-hidden="true" className="w-3 text-xs text-parchment-400">{closed.has(q) ? '▸' : '▾'}</span>
                <GemIcon quality={q} />
                <span className="min-w-0 flex-1 truncate">{gemName(vocation, q)}</span>
                <span className="text-xs font-normal text-parchment-400">{recs[q].length}</span>
              </button>
            </h4>
            {closed.has(q) ? null : recs[q].length === 0 ? (
              <p className="text-sm text-parchment-400">—</p>
            ) : (
              <ol className="space-y-2">
                {recs[q].map((r, i) => (
                  <li key={i} className="rounded-lg border border-ink-700 p-2.5">
                    <div className="flex items-center gap-2 text-sm">
                      <ul className="flex min-w-0 flex-1 flex-wrap gap-1">
                        {r.mods.map((m) => (
                          <ModChip key={`${m.kind}-${m.modId}`} name={m.name} grade={m.grade} />
                        ))}
                      </ul>
                      <span className="shrink-0 text-xs tabular-nums text-weak">{t('recs.gain', { gain: gain(r.gain) })}</span>
                      {onAddGem && (
                        <button type="button" onClick={() => onAddGem(r)} className="rounded-md border border-gold-600 bg-gold-700/30 px-2 py-0.5 text-xs font-medium text-gold-300 hover:bg-gold-700/50 shrink-0">
                          + {t('recs.add')}
                        </button>
                      )}
                    </div>
                    {r.replaces && <p className="mt-1 text-xs text-amber-300">{t('recs.replaces')}</p>}
                    {r.reason && <p className="mt-1 text-xs text-parchment-400">{engineText(t, r.reasonMsg, r.reason)}</p>}
                    {!!r.similar?.length && (
                      <p className="mt-1 text-xs text-parchment-300">
                        {t('recs.similar')}{' '}
                        {r.similar.map((s) => `${s.name} (${t(`slot.${s.slot}`)}, ${s.relative}%)`).join(' · ')}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>

      <SubHeading>{t('upgrades.title')}</SubHeading>
      {result.upgradeRecommendations.length === 0 ? (
        <Empty>{t(result.vessels.some((v) => v.unlocked && !v.gem) ? 'upgrades.fillFirst' : 'upgrades.none')}</Empty>
      ) : (
        <ol className="divide-y divide-ink-700 rounded-lg border border-ink-700">
          {result.upgradeRecommendations.map((u) => (
            <li key={`${u.kind}-${u.modId}`} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate text-parchment-200">
                {u.name}
                <span className="text-parchment-400"> · {t('upgrades.gems', { n: u.gems })}</span>
              </span>
              <span className="shrink-0 tabular-nums text-gold-300">
                {ROMAN[u.fromGrade]} → {ROMAN[u.toGrade]}
              </span>
              <span className="w-16 shrink-0 text-right text-xs tabular-nums text-weak">{t('upgrades.gain', { gain: gain(u.gain) })}</span>
              {u.gainToMax !== undefined && u.toGrade < 4 && (
                <span className="hidden w-24 shrink-0 text-right text-[11px] tabular-nums text-parchment-400 sm:inline">
                  {t('upgrades.toMax', { gain: gain(u.gainToMax) })}
                </span>
              )}
              {onUpgrade && (
                <button type="button" onClick={() => onUpgrade(u)} className="rounded-md border border-gold-600 bg-gold-700/30 px-2 py-0.5 text-xs font-medium text-gold-300 hover:bg-gold-700/50 shrink-0">
                  {t('upgrades.apply')}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      <SubHeading
        aside={
          result.spells.length > 0 && (
            <button
              type="button"
              aria-expanded={spellsOpen}
              aria-controls={spellsId}
              onClick={() => setSpellsOpen((o) => !o)}
              className="text-xs text-gold-400 hover:underline"
            >
              {spellsOpen ? t('common.hide') : `${t('common.show')} (${result.spells.length})`}
            </button>
          )
        }
      >
        {t('spells.title')}
      </SubHeading>
      {result.spells.length === 0 ? (
        <Empty>{t('spells.none')}</Empty>
      ) : (
        <ul id={spellsId} hidden={!spellsOpen} className="divide-y divide-ink-700 rounded-lg border border-ink-700">
          {result.spells.map((s) => (
            <li key={s.name} className="px-3 py-1.5 text-sm">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className={s.useful ? 'text-weak' : 'text-resist'}>
                  {s.useful ? '✓' : '✗'}
                </span>
                <span className="sr-only">{s.useful ? t('spells.useful') : t('spells.notUseful')}:</span>
                <span className="min-w-0 flex-1 truncate text-parchment-100">{s.name}</span>
                {s.share !== undefined && s.share > 0 && (
                  <span className="shrink-0 text-xs tabular-nums text-gold-300">{t('spells.share', { share: formatNumber(Math.round(s.share)) })}</span>
                )}
                <span className="shrink-0 text-xs tabular-nums text-parchment-300">
                  {t('spells.targets', { n: formatNumber(Math.round(s.expectedTargets * 10) / 10) })}
                </span>
              </div>
              {s.reason && <p className="mt-0.5 pl-5 text-xs text-parchment-400">{engineText(t, s.reasonMsg, s.reason)}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
