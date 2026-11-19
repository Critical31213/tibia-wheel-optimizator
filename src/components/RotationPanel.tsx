import { useId } from 'react';
import { GREEDY_ROTATION_ID, type RotationPreset, type RotationUsage } from '../types';
import { useT } from '../i18n';
import { MAX_FORCED_SPELLS, stanceNames } from '../lib/spellPrefs';
import type { SpellPrefs } from '../lib/spellPrefs';

interface RotationPanelProps {
  presets: RotationPreset[];
  /** Spells whose augment can be forced. */
  spells: string[];
  /** Selectable stance set keys (D32). */
  stanceOptions: string[];
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
export function RotationPanel({ presets, spells, stanceOptions, value, onChange, usage, stances }: RotationPanelProps) {
  const t = useT();
  const id = useId();
  const selected = presets.find((p) => p.id === value.rotationId);
  const used = usage && presets.find((p) => p.id === usage.presetId);
  const requires = (p: RotationPreset) =>
    [
      p.requires?.revelation && t('rotation.needsRevelation', { name: p.requires.revelation }),
      p.requires?.shield && t('rotation.needsShield'),
    ].filter(Boolean) as string[];
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
        </div>
      )}

      <label htmlFor={`${id}-fs`} className="mt-4 block text-xs text-parchment-300">
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
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {value.forcedSpells.map((s) => (
            <li key={s} className="flex items-center gap-1 rounded-full border border-ink-600 px-2 py-0.5 text-xs text-parchment-200">
              {s}
              <button
                type="button"
                aria-label={t('rotation.forcedRemove', { name: s })}
                onClick={() => onChange({ forcedSpells: value.forcedSpells.filter((x) => x !== s) })}
                className="text-parchment-400 hover:text-parchment-50"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[11px] text-parchment-400">{t('rotation.forcedHint')}</p>
    </div>
  );
}
