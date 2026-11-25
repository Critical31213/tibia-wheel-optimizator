import { useId, useState } from 'react';
import { CUSTOM_ROTATION_ID, GREEDY_ROTATION_ID, type RotationPreset, type RotationSpell, type RotationUsage } from '../types';
import { useT } from '../i18n';
import { MAX_CUSTOM_RATIO, MAX_CUSTOM_SPELLS, MAX_FORCED_SPELLS, MAX_SPELL_TARGETS, stanceNames } from '../lib/spellPrefs';
import { cx, formatNumber, ROMAN } from '../lib/labels';
import type { RevelationOption, RevelationReach } from '../types';

const STAGE = ['', 'I', 'II', 'III'];
import type { SpellPrefs } from '../lib/spellPrefs';

interface RotationPanelProps {
  presets: RotationPreset[];
  /** D70: spells selectable in a custom rotation. */
  customSpells: string[];
  /** Spells whose augment can be forced. */
  spells: string[];
  /** D92: spells that can be excluded. */
  excludable: string[];
  /** D107: area spells with editable average targets (hunt; empty = hidden). */
  targetSpells: { name: string; avg: number; max: number }[];
  /** Selectable stance set keys (D32). */
  stanceOptions: string[];
  /** D35: revelations and how reachable each stage is. */
  revelations: RevelationOption[];
  /** D116: gem vessels of the wheel; unlocked in the shown build. */
  maxVessels: number;
  /** D122: default share of turns with an auto-attack (%). */
  autoAttackDefault: number;
  shownVessels?: number;
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
export function RotationPanel({ presets, customSpells, spells, excludable, targetSpells, stanceOptions, revelations, maxVessels, shownVessels, autoAttackDefault, value, onChange, usage, stances }: RotationPanelProps) {
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
  const excluded = value.excludedSpells;
  const addable = spells.filter((s) => !value.forcedSpells.includes(s) && !excluded.includes(s));
  const excludeAddable = excludable.filter((s) => !excluded.includes(s));
  // D92: an excluded spell leaves the forced list and the custom rotation.
  const exclude = (s: string) =>
    onChange({
      excludedSpells: [...excluded, s],
      forcedSpells: value.forcedSpells.filter((x) => x !== s),
      forcedStage2: value.forcedStage2.filter((x) => x !== s),
      customRotation: value.customRotation.filter((x) => x.name !== s),
    });

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
        <option value={CUSTOM_ROTATION_ID}>{t('rotation.custom')}</option>
      </select>
      {value.rotationId === CUSTOM_ROTATION_ID && <CustomRotationEditor spells={customSpells.filter((s) => !excluded.includes(s))} value={value.customRotation} onChange={(customRotation) => onChange({ customRotation })} />}
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

      <div className="mt-3">
        <label htmlFor={`${id}-xs`} className="block text-xs text-parchment-300">
          {t('rotation.excluded')}
        </label>
        <select
          id={`${id}-xs`}
          value=""
          disabled={excludeAddable.length === 0}
          onChange={(e) => e.target.value && exclude(e.target.value)}
          className="field mt-1 w-full py-1.5 text-sm"
        >
          <option value="">{t('rotation.excludedAdd')}</option>
          {excludeAddable.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {excluded.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {excluded.map((s) => (
              <li key={s} className="flex items-center gap-1.5 rounded-md border border-ink-600 px-2 py-0.5 text-xs text-parchment-200">
                <span className="line-through decoration-parchment-400">{s}</span>
                <button
                  type="button"
                  aria-label={t('rotation.excludedRemove', { name: s })}
                  onClick={() => onChange({ excludedSpells: excluded.filter((x) => x !== s) })}
                  className="text-parchment-400 hover:text-parchment-50"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-[11px] text-parchment-400">{t('rotation.excludedHint')}</p>
      </div>

      <div className="mt-3 text-xs">
        <label className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-parchment-300">{t('rotation.autoAttackShare')}</span>
          <PercentInput value={value.autoAttack} placeholder={autoAttackDefault} onChange={(autoAttack) => onChange({ autoAttack })} />
          <button
            type="button"
            aria-label={t('rotation.autoAttackReset')}
            title={t('rotation.autoAttackReset')}
            disabled={value.autoAttack === null}
            onClick={() => onChange({ autoAttack: null })}
            className="w-3 text-parchment-400 hover:text-parchment-50 disabled:invisible"
          >
            ↺
          </button>
        </label>
        <p className="mt-1 text-[11px] text-parchment-400">{t('rotation.autoAttackHint', { n: autoAttackDefault })}</p>
      </div>

      {usage && (
        <div className="mt-3" aria-live="polite">
          <p className="text-xs text-parchment-300">
            {t('rotation.used')}: <span className="text-parchment-100">{used?.name ?? (usage.presetId === GREEDY_ROTATION_ID ? t('rotation.boss') : usage.presetId === CUSTOM_ROTATION_ID ? t('rotation.custom') : usage.presetId)}</span>
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
          {usage.window && (
            <RotationDamage
              usage={usage}
              window={usage.window}
              targets={targetSpells.length ? { spells: targetSpells, value: value.targets, onChange: (targets) => onChange({ targets }) } : undefined}
            />
          )}
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
          <label className="mt-3 flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-parchment-300">{t('rotation.minVessels')}</span>
            <select
              value={Math.min(value.minVessels, maxVessels)}
              onChange={(e) => onChange({ minVessels: Number(e.target.value) })}
              className="field w-40 shrink-0 py-1 text-xs"
            >
              <option value={0}>{t('rotation.forcedRevNone')}</option>
              {Array.from({ length: maxVessels }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          {value.minVessels > 0 && shownVessels !== undefined && shownVessels < Math.min(value.minVessels, maxVessels) && (
            <p className="mt-0.5 text-[11px] text-amber-300">{t('rotation.minVesselsShort', { n: shownVessels })}</p>
          )}
          <p className="mt-1 text-[11px] text-parchment-400">{t('rotation.minVesselsHint')}</p>
        </div>
      </div>
    </div>
  );
}

interface TargetEdit {
  spells: { name: string; avg: number; max: number }[];
  value: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
}

/**
 * D67: average damage of the whole rotation over the engine's window (test view). D121: in hunts the Targets column
 * holds the player's average targets per cast (D107; empty = community average).
 */
function RotationDamage({ usage, window: w, targets }: { usage: RotationUsage; window: NonNullable<RotationUsage['window']>; targets?: TargetEdit }) {
  const t = useT();
  const id = useId();
  const rows = usage.spells.filter((s) => s.damage);
  const num = (n: number) => formatNumber(Math.round(n));
  const cell = 'px-1.5 py-0.5 text-right tabular-nums';
  const custom = targets ? Object.keys(targets.value).length : 0;
  const editable = targets && rows.some((s) => targets.spells.some((x) => x.name === s.name));
  const reset = (name: string) => targets?.onChange(Object.fromEntries(Object.entries(targets.value).filter(([n]) => n !== name)));
  const targetCell = (name: string, shown: number) => {
    const spec = targets?.spells.find((x) => x.name === name);
    if (!targets || !spec) return shown.toFixed(1);
    return (
      <span className="inline-flex items-center justify-end gap-0.5">
        <TargetInput
          id={`${id}-${name}`}
          label={t('rotation.targetsOf', { name })}
          avg={spec.avg}
          max={Math.min(spec.max, MAX_SPELL_TARGETS)}
          value={targets.value[name]}
          onChange={(v) => (v === undefined ? reset(name) : targets.onChange({ ...targets.value, [name]: v }))}
        />
        <button
          type="button"
          aria-label={t('rotation.targetsReset', { name })}
          title={t('rotation.targetsReset', { name })}
          disabled={targets.value[name] === undefined}
          onClick={() => reset(name)}
          className="w-3 text-parchment-400 hover:text-parchment-50 disabled:invisible"
        >
          ↺
        </button>
      </span>
    );
  };
  return (
    <details className="mt-2 text-xs" open={custom > 0 || undefined}>
      <summary className="cursor-pointer text-parchment-300">
        {t('rotation.damageTitle', { seconds: w.seconds })}
        {custom > 0 && <span className="text-gold-300"> ({t('rotation.targetsCustom', { n: custom })})</span>}
      </summary>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full text-parchment-200">
          <thead className="text-parchment-400">
            <tr>
              <th className="px-1.5 py-0.5 text-left font-normal">{t('rotation.damageSpell')}</th>
              <th className={cx(cell, 'font-normal')}>{t('rotation.damageCasts')}</th>
              <th className={cx(cell, 'font-normal')}>{t('rotation.damageTargets')}</th>
              <th className={cx(cell, 'font-normal')}>Min</th>
              <th className={cx(cell, 'font-normal')}>Max</th>
              <th className={cx(cell, 'font-normal')}>Avg</th>
              <th className={cx(cell, 'font-normal')}>{t('rotation.damagePerCast')}</th>
              <th className={cx(cell, 'font-normal')}>{t('rotation.damageTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.name} className="border-t border-ink-700">
                <td className="px-1.5 py-0.5">{s.name}</td>
                <td className={cell}>{s.damage!.casts.toFixed(1)}</td>
                <td className={cell}>{targetCell(s.name, s.damage!.targets)}</td>
                <td className={cell}>{s.damage!.minHit !== undefined ? num(s.damage!.minHit) : '—'}</td>
                <td className={cell}>{s.damage!.maxHit !== undefined ? num(s.damage!.maxHit) : '—'}</td>
                <td className={cell}>{s.damage!.avgHit !== undefined ? num(s.damage!.avgHit) : '—'}</td>
                <td className={cell}>{num(s.damage!.perCast)}</td>
                <td className={cell}>{num(s.damage!.total)}</td>
              </tr>
            ))}
            {w.autoAttack > 0 && (
              <tr className="border-t border-ink-700">
                <td className="px-1.5 py-0.5 italic">{t('rotation.autoAttack')}</td>
                <td className={cell} colSpan={6} />
                <td className={cell}>{num(w.autoAttack)}</td>
              </tr>
            )}
            {(w.charms ?? 0) > 0 && (
              <tr className="border-t border-ink-700">
                <td className="px-1.5 py-0.5 italic">{t('rotation.charms')}</td>
                <td className={cell} colSpan={6} />
                <td className={cell}>{num(w.charms!)}</td>
              </tr>
            )}
            <tr className="border-t border-ink-600 font-semibold text-parchment-100">
              <td className="px-1.5 py-0.5">{t('rotation.damageSum')}</td>
              <td className={cell} colSpan={6}>
                <span className="font-normal text-parchment-300">{t('rotation.damagePerSecond', { dps: num(w.total / w.seconds) })}</span>
              </td>
              <td className={cell}>{num(w.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-parchment-400">{t('rotation.damageNote')}</p>
      {editable && <p className="mt-1 text-[11px] text-parchment-400">{t('rotation.targetsHint')}</p>}
      {custom > 0 && (
        <button type="button" onClick={() => targets!.onChange({})} className="mt-1 text-[11px] text-gold-300 hover:text-gold-200">
          {t('rotation.targetsResetAll')}
        </button>
      )}
    </details>
  );
}

/** D122: whole percent 0–100; empty = default (placeholder). */
function PercentInput({ value, placeholder, onChange }: { value: number | null; placeholder: number; onChange: (v: number | null) => void }) {
  const [draft, setDraft] = useState<{ text: string; value: number | null } | null>(null);
  const text = draft && draft.value === value ? draft.text : (value?.toString() ?? '');
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={100}
        step={5}
        placeholder={String(placeholder)}
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          const n = Number(raw);
          const next = raw.trim() === '' ? null : Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : value;
          setDraft({ text: raw, value: next });
          if (next !== value) onChange(next);
        }}
        onBlur={() => setDraft(null)}
        className="field w-14 py-0.5 text-right text-xs tabular-nums placeholder:text-parchment-500"
      />
      <span className="text-parchment-400">%</span>
    </span>
  );
}

/** Number field that keeps the typed text and commits valid values (empty = default). */
function TargetInput({ id, label, avg, max, value, onChange }: { id: string; label: string; avg: number; max: number; value: number | undefined; onChange: (v: number | undefined) => void }) {
  const [draft, setDraft] = useState<{ text: string; value: number | undefined } | null>(null);
  const text = draft && draft.value === value ? draft.text : (value?.toString() ?? '');
  return (
    <input
      id={id}
      aria-label={label}
      type="number"
      inputMode="decimal"
      min={1}
      max={max}
      step={0.1}
      placeholder={avg.toFixed(1)}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        const n = Number(raw);
        const next = raw.trim() === '' ? undefined : Number.isFinite(n) && n >= 1 ? Math.min(max, Math.round(n * 10) / 10) : value;
        setDraft({ text: raw, value: next });
        if (next !== value) onChange(next);
      }}
      onBlur={() => setDraft(null)}
      className="field w-14 shrink-0 py-0 text-right text-xs tabular-nums placeholder:text-parchment-500"
    />
  );
}

/** D70: spells and casts per full cycle of the user's rotation. */
function CustomRotationEditor({ spells, value, onChange }: { spells: string[]; value: RotationSpell[]; onChange: (v: RotationSpell[]) => void }) {
  const t = useT();
  const id = useId();
  const addable = spells.filter((s) => !value.some((x) => x.name === s));
  const setRatio = (name: string, ratio: number) =>
    onChange(value.map((x) => (x.name === name ? { ...x, ratio: Math.max(1, Math.min(MAX_CUSTOM_RATIO, Math.round(ratio) || 1)) } : x)));
  return (
    <div className="mt-2 rounded border border-ink-700 p-2">
      <p className="text-[11px] text-parchment-400">{t('rotation.customHint')}</p>
      {value.length > 0 && (
        <ul className="mt-1 space-y-1">
          {value.map((x) => (
            <li key={x.name} className="flex items-center gap-2 text-xs">
              <span className="flex-1 text-parchment-200">{x.name}</span>
              <label className="sr-only" htmlFor={`${id}-${x.name}`}>
                {t('rotation.customRatio', { name: x.name })}
              </label>
              <input
                id={`${id}-${x.name}`}
                type="number"
                min={1}
                max={MAX_CUSTOM_RATIO}
                value={x.ratio}
                onChange={(e) => setRatio(x.name, Number(e.target.value))}
                className="field w-14 py-0.5 text-right text-xs tabular-nums"
              />
              <button type="button" onClick={() => onChange(value.filter((y) => y.name !== x.name))} className="text-parchment-400 hover:text-parchment-100" aria-label={t('rotation.forcedRemove', { name: x.name })}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <select
        aria-label={t('rotation.customAdd')}
        value=""
        disabled={!addable.length || value.length >= MAX_CUSTOM_SPELLS}
        onChange={(e) => e.target.value && onChange([...value, { name: e.target.value, ratio: 1 }])}
        className="field mt-2 w-full py-1 text-xs"
      >
        <option value="">{t('rotation.customAdd')}</option>
        {addable.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      {!value.length && <p className="mt-1 text-[11px] text-parchment-400">{t('rotation.customEmpty')}</p>}
    </div>
  );
}
