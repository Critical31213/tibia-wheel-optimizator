import type { CharmResult, OwnedCharm } from '../types';
import { useT, type TFunction } from '../i18n';
import { CHARMS, getCharm, type CharmDef, type CharmStage } from '../data/charms';
import { cx } from '../lib/labels';

const STAGES: readonly CharmStage[] = [1, 2, 3];
const ROMAN = ['', 'I', 'II', 'III'];

/** Effect of a charm at a stage, from its data. */
function effectText(t: TFunction, c: CharmDef, stage: CharmStage): string {
  const v = c.values[stage - 1];
  switch (c.kind) {
    case 'element':
      return t('charm.effect.element', { chance: v, pct: c.pct!, element: t(`element.${c.element!}` as 'element.fire').toLowerCase(), cap: c.levelCap! });
    case 'player':
      return t(c.resource === 'mana' ? 'charm.effect.mana' : 'charm.effect.hp', { chance: v, pct: c.pct!, cap: c.creatureCap! });
    case 'kill':
      return t('charm.effect.kill', { chance: v, pct: c.pct!, cap: c.levelCap! });
    default:
      return t(c.crit === 'chance' ? 'charm.effect.critChance' : 'charm.effect.critExtra', { v });
  }
}

/** D93: small charm badge (own drawing). */
export function CharmIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 4.5l2.1 4.6 5 .5-3.8 3.3 1.1 4.9L12 15.3l-4.4 2.5 1.1-4.9L4.9 9.6l5-.5z" fill="currentColor" opacity="0.85" />
    </svg>
  );
}

interface CharmsEditorProps {
  value: readonly OwnedCharm[];
  onChange: (v: OwnedCharm[]) => void;
  /** Charms the engine assigned for the shown build. */
  picks: readonly CharmResult[] | undefined;
}

/** D93: unlocked offensive charms and their stage; the engine assigns them to the spot's creatures. */
export function CharmsEditor({ value, onChange, picks }: CharmsEditorProps) {
  const t = useT();
  const stageOf = (id: string) => value.find((c) => c.id === id)?.stage ?? 0;
  const set = (c: CharmDef, stage: CharmStage | 0) => {
    const rest = value.filter((x) => x.id !== c.id);
    onChange(stage ? [...rest, { id: c.id, stage }] : rest);
  };
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs text-parchment-300">{t('charm.hint')}</p>
      {value.length > 0 && (
        <div className="rounded-lg border border-gold-700/60 bg-ink-950/60 p-2" aria-live="polite">
          <p className="text-xs text-parchment-300">{t('charm.picked')}</p>
          {picks?.length ? (
            <ul className="mt-1 space-y-0.5">
              {picks.map((p) => (
                <li key={p.id} className="flex justify-between gap-2 text-xs">
                  <span className="text-parchment-100">
                    {p.monsterName} → <span className="text-gold-300">{getCharm(p.id)?.name} {ROMAN[p.stage]}</span>
                  </span>
                  <span className="tabular-nums text-offense">+{p.gain.toFixed(1)}%</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-parchment-400">{t('charm.pickedNone')}</p>
          )}
        </div>
      )}
      <ul className="flex flex-col gap-1.5">
        {CHARMS.map((c) => {
          const cur = stageOf(c.id);
          return (
            <li key={c.id} className={cx('flex items-center gap-2 rounded-md border px-2 py-1.5', cur ? 'border-gold-700/70 bg-ink-950/60' : 'border-ink-700')}>
              <div className="min-w-0 flex-1">
                <p className={cx('text-xs', cur ? 'text-parchment-50' : 'text-parchment-300')}>{c.name}</p>
                <p className="text-[11px] leading-snug text-parchment-400">{effectText(t, c, (cur || 3) as CharmStage)}</p>
              </div>
              <span role="group" aria-label={t('charm.stage', { name: c.name })} className="flex shrink-0 overflow-hidden rounded border border-ink-600 text-xs">
                {([0, ...STAGES] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={cur === s}
                    onClick={() => set(c, s)}
                    className={cx('min-w-7 px-1.5 py-0.5', cur === s ? 'bg-gold-700/50 text-gold-200' : 'text-parchment-400 hover:text-parchment-100')}
                  >
                    {s ? ROMAN[s] : '—'}
                  </button>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-parchment-400">{t('charm.note')}</p>
    </div>
  );
}
