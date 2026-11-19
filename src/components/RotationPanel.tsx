import { useId } from 'react';
import { GREEDY_ROTATION_ID, type RotationPreset, type RotationUsage } from '../types';
import { useT } from '../i18n';
import { MAX_FORCED_SPELLS, stanceNames } from '../lib/spellPrefs';
import { cx, formatNumber, ROMAN } from '../lib/labels';
import type { RevelationOption, RevelationReach } from '../types';

const STAGE = ['', 'I', 'II', 'III'];
import type { SpellPrefs } from '../lib/spellPrefs';

interface RotationPanelProps {
  presets: RotationPreset[];
  /** Spells whose augment can be forced. */
  spells: string[];
  /** Selectable stance set keys (D32). */
  stanceOptions: string[];
  /** D35: revelations and how reachable each stage is. */
  revelations: RevelationOption[];
  value: SpellPrefs;
  onChange: (patch: Partial<SpellPrefs>) => void;
  /** Rotation used by the viewed build. */
  usage?: RotationUsage;
  /** Stances the viewed build assumes (D24). */
  stances?: string[];
}

/** Select value of the automatic stance (stance keys are '' or names). */
const AUTO = '*';

/** Rotation choice (auto / preset), the rotation the viewed build is based on, and forced spell augments. */
export function RotationPanel({ presets, spells, stanceOptions, revelations, value, onChange, usage, stances }: RotationPanelProps) {
  const t = useT();
  const id = useId();
  const selected = presets.find((p) => p.id === value.rotationId);
  const used = usage && presets.find((p) => p.id === usage.presetId);
  const requires = (p: RotationPreset) =>
    [
      p.requires?.revelation && t('rotation.needsRevelation', { name: p.requires.revelation }),
      p.requires?.shield && t('rotation.needsShield'),
    ].filter(Boolean) as string[];
  const reachNote = (r: RevelationReach) =>
    r.status === 'ok' ? '' : r.status === 'impossible' ? t('rotation.revImpossible') : t(r.status === 'gem' ? 'rotation.revGem' : 'rotation.revUpgrade', { grade: ROMAN[r.grade] });
  const stanceLabel = (k: string) => (k ? stanceNames(k).join(' + ') : t('rotation.noStance'));
  const addable = spells.filter((s) => !value.forcedSpells.includes(s));

  return (
    <div className="text-sm">
      <label htmlFor={`${id}-rot`} className="text-xs text-parchment-300">
        {t('rotation.select')}
      </label>
      <select
        id={`${id}-rot`}
        value={value.rotationId ?? ''}
        onChange={(e) => onChange({ rotationId: e.target.value || null })}
        className="field mt-1 w-full py-1.5 text-sm"
      >
        <option value="">{t('rotation.auto')}</option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {selected && (selected.note || selected.requires) && (
        <p className="mt-1 text-xs text-parchment-400">{[selected.note, ...requires(selected)].filter(Boolean).join(' · ')}</p>
      )}

      {stanceOptions.length > 1 && (
        <>
          <label htmlFor={`${id}-st`} className="mt-3 block text-xs text-parchment-300">
            {t('rotation.stance')}
          </label>
          <select
            id={`${id}-st`}
            value={value.stance ?? AUTO}
            onChange={(e) => onChange({ stance: e.target.value === AUTO ? null : e.target.value })}
            className="field mt-1 w-full py-1.5 text-sm"
          >
            <option value={AUTO}>{t('rotation.auto')}</option>
            {stanceOptions.map((k) => (
              <option key={k} value={k}>
                {stanceLabel(k)}
              </option>
            ))}
          </select>
        </>
      )}

      {usage && (
        <div className="mt-3" aria-live="polite">
          <p className="text-xs text-parchment-300">
            {t('rotation.used')}: <span className="text-parchment-100">{used?.name ?? (usage.presetId === GREEDY_ROTATION_ID ? t('rotation.boss') : usage.presetId)}</span>
            {usage.auto && <span className="text-parchment-400"> ({t('rotation.autoPicked')})</span>}
          </p>
          {stances && (
            <p className="mt-0.5 text-xs text-parchment-300">
              {t('rotation.stance')}: <span className="text-parchment-100">{stances.length ? stances.join(' + ') : t('rotation.noStance')}</span>
              {value.stance === null && <span className="text-parchment-400"> ({t('rotation.autoPicked')})</span>}
            </p>
          )}
          <ul className="mt-1 space-y-0.5">
            {usage.autoAttack !== undefined && (
              <li className="flex justify-between gap-2 text-xs">
                <span className="italic text-parchment-200">{t('rotation.autoAttack')}</span>
                <span className="tabular-nums text-parchment-300">{Math.round(usage.autoAttack)}%</span>
              </li>
            )}
            {usage.spells.map((s) => (
              <li key={s.name} className="flex justify-between gap-2 text-xs">
                <span className="text-parchment-200">
                  {s.name}
                  {s.fromRevelation && (
                    <span className="ml-1 text-gold-300" title={t('rotation.fromRevelation')}>
                      ★<span className="sr-only">{t('rotation.fromRevelation')}</span>
                    </span>
                  )}
                </span>
                <span className="tabular-nums text-parchment-300">{Math.round(s.share)}%</span>
              </li>
            ))}
          </ul>
          {usage.spells.some((s) => s.fromRevelation) && (
            <p className="mt-1 text-[11px] text-parchment-400">★ {t('rotation.fromRevelation')}</p>
          )}
          {usage.window && <RotationDamage usage={usage} window={usage.window} />}
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2 sm:divide-x sm:divide-ink-700">
        <div>
          <label htmlFor={`${id}-fs`} className="block text-xs text-parchment-300">
            {t('rotation.forced')}
          </label>
          <select
            id={`${id}-fs`}
            value=""
            disabled={addable.length === 0 || value.forcedSpells.length >= MAX_FORCED_SPELLS}
            onChange={(e) => e.target.value && onChange({ forcedSpells: [...value.forcedSpells, e.target.value] })}
            className="field mt-1 w-full py-1.5 text-sm"
          >
            <option value="">{t('rotation.forcedAdd')}</option>
            {addable.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {value.forcedSpells.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {value.forcedSpells.map((s) => {
                const two = value.forcedStage2.includes(s);
                return (
                  <li key={s} className="flex items-center gap-2 rounded-md border border-ink-600 px-2 py-1 text-xs text-parchment-200">
                    <span className="min-w-0 flex-1 truncate">{s}</span>
                    <span role="group" aria-label={t('rotation.forcedStage', { name: s })} className="flex shrink-0 overflow-hidden rounded border border-ink-600">
                      {[1, 2].map((n) => (
                        <button
                          key={n}
                          type="button"
                          aria-pressed={two === (n === 2)}
                          onClick={() => onChange({ forcedStage2: n === 2 ? [...value.forcedStage2.filter((x) => x !== s), s] : value.forcedStage2.filter((x) => x !== s) })}
                          className={cx('px-1.5 py-0.5', two === (n === 2) ? 'bg-gold-700/50 text-gold-200' : 'text-parchment-400 hover:text-parchment-100')}
                        >
                          {STAGE[n]}
                        </button>
                      ))}
                    </span>
                    <button
                      type="button"
                      aria-label={t('rotation.forcedRemove', { name: s })}
                      onClick={() => onChange({ forcedSpells: value.forcedSpells.filter((x) => x !== s), forcedStage2: value.forcedStage2.filter((x) => x !== s) })}
                      className="text-parchment-400 hover:text-parchment-50"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-1 text-[11px] text-parchment-400">{t('rotation.forcedHint')}</p>
        </div>

        <div className="sm:pl-4">
          <p className="text-xs text-parchment-300">{t('rotation.forcedRev')}</p>
          <ul className="mt-1 flex flex-col gap-1.5">
            {revelations.map((r) => {
              const cur = value.forcedRevelations.find((f) => f.name === r.name)?.stage ?? 0;
              const note = cur ? reachNote(r.stages[cur - 1]) : '';
              return (
                <li key={r.name} className="text-xs">
                  <label className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-parchment-200">{r.name}</span>
                    <select
                      value={cur}
                      onChange={(e) => {
                        const stage = Number(e.target.value) as 0 | 1 | 2 | 3;
                        const rest = value.forcedRevelations.filter((f) => f.name !== r.name);
                        onChange({ forcedRevelations: stage ? [...rest, { name: r.name, stage }] : rest });
                      }}
                      className="field w-40 shrink-0 py-1 text-xs"
                    >
                      <option value={0}>{t('rotation.forcedRevNone')}</option>
                      {r.stages.map((reach, i) => (
                        <option key={i} value={i + 1} disabled={reach.status !== 'ok' && cur !== i + 1}>
                          {STAGE[i + 1]}
                          {reach.status !== 'ok' ? ` — ${reachNote(reach)}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  {note && <p className="mt-0.5 text-[11px] text-amber-300">{STAGE[cur]}: {note}</p>}
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-[11px] text-parchment-400">{t('rotation.forcedRevHint')}</p>
        </div>
      </div>
    </div>
  );
}

/** D67: average damage of the whole rotation over the engine's window (test view). */
function RotationDamage({ usage, window: w }: { usage: RotationUsage; window: NonNullable<RotationUsage['window']> }) {
  const t = useT();
  const rows = usage.spells.filter((s) => s.damage);
  const num = (n: number) => formatNumber(Math.round(n));
  const cell = 'px-1.5 py-0.5 text-right tabular-nums';
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-parchment-300">{t('rotation.damageTitle', { seconds: w.seconds })}</summary>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full text-parchment-200">
          <thead className="text-parchment-400">
            <tr>
              <th className="px-1.5 py-0.5 text-left font-normal">{t('rotation.damageSpell')}</th>
              <th className={cx(cell, 'font-normal')}>{t('rotation.damageCasts')}</th>
              <th className={cx(cell, 'font-normal')}>{t('rotation.damageTargets')}</th>
              <th className={cx(cell, 'font-normal')}>{t('rotation.damagePerCast')}</th>
              <th className={cx(cell, 'font-normal')}>{t('rotation.damageTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.name} className="border-t border-ink-700">
                <td className="px-1.5 py-0.5">{s.name}</td>
                <td className={cell}>{s.damage!.casts.toFixed(1)}</td>
                <td className={cell}>{s.damage!.targets.toFixed(1)}</td>
                <td className={cell}>{num(s.damage!.perCast)}</td>
                <td className={cell}>{num(s.damage!.total)}</td>
              </tr>
            ))}
            {w.autoAttack > 0 && (
              <tr className="border-t border-ink-700">
                <td className="px-1.5 py-0.5 italic">{t('rotation.autoAttack')}</td>
                <td className={cell} colSpan={3} />
                <td className={cell}>{num(w.autoAttack)}</td>
              </tr>
            )}
            <tr className="border-t border-ink-600 font-semibold text-parchment-100">
              <td className="px-1.5 py-0.5">{t('rotation.damageSum')}</td>
              <td className={cell} colSpan={3}>
                <span className="font-normal text-parchment-300">{t('rotation.damagePerSecond', { dps: num(w.total / w.seconds) })}</span>
              </td>
              <td className={cell}>{num(w.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-parchment-400">{t('rotation.damageNote')}</p>
    </details>
  );
}
