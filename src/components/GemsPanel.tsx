import { useId, useState } from 'react';
import type { GemModRef, GemQuality, ModDefinition, ModGrade, OwnedGem, Vocation } from '../types';
import { useT } from '../i18n';
import { createGem, GEM_QUALITIES, MOD_GRADES, modsForSlot, normalizeGem, slotKind, slotsForQuality, updateGem } from '../lib/gems';
import type { GemSlot } from '../lib/gems';
import { cx, gemName, ROMAN } from '../lib/labels';
import { GemIcon } from './GemIcon';
import { Panel } from './Panel';
import { SegmentedControl } from './SegmentedControl';

const GRADE_OPTIONS = MOD_GRADES.map((g) => ({ value: g, label: ROMAN[g] }));

interface SlotEditorProps {
  slot: GemSlot;
  value: GemModRef | null;
  options: ModDefinition[];
  onChange: (ref: GemModRef | null) => void;
}

function SlotEditor({ slot, value, options, onChange }: SlotEditorProps) {
  const t = useT();
  const id = useId();
  const mod = value ? options.find((m) => m.id === value.modId) : undefined;
  const slotLabel = t(`slot.${slot}`);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-2 gap-y-1">
      <label htmlFor={id} className="col-span-2 text-[11px] text-parchment-400">
        {slotLabel}
        {mod && value && mod.gradeValues[value.grade - 1] && (
          <span className="ml-1 text-parchment-200">· {mod.gradeValues[value.grade - 1]}</span>
        )}
      </label>
      <select
        id={id}
        value={value ? String(value.modId) : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : { modId: Number(e.target.value), grade: value?.grade ?? 1 })}
        className="field min-w-0 py-1.5 text-sm"
      >
        <option value="">{t('gems.noMod')}</option>
        {value && !mod && <option value={value.modId}>#{value.modId}</option>}
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <SegmentedControl<ModGrade>
        size="sm"
        label={t('gems.gradeOf', { slot: slotLabel })}
        value={value?.grade ?? 1}
        onChange={(grade) => value && onChange({ ...value, grade })}
        options={GRADE_OPTIONS}
        disabled={!value}
        className="w-28"
      />
    </div>
  );
}

interface GemCardProps {
  gem: OwnedGem;
  index: number;
  vocation: Vocation;
  mods: ModDefinition[];
  onChange: (gem: OwnedGem) => void;
  onRemove: () => void;
}

function GemCard({ gem, index, vocation, mods, onChange, onRemove }: GemCardProps) {
  const t = useT();
  const id = useId();
  const n = index + 1;
  return (
    <li className="rounded-xl border border-ink-600 bg-ink-950/50 p-3">
      <div className="mb-2 flex items-center gap-2">
        <GemIcon quality={gem.quality} />
        <label htmlFor={id} className="sr-only">
          {t('gems.gemN', { n })} — {t('gems.quality')}
        </label>
        <select
          id={id}
          value={gem.quality}
          onChange={(e) => onChange(normalizeGem({ ...gem, quality: e.target.value as GemQuality }))}
          className="field min-w-0 flex-1 py-1 text-sm font-medium"
        >
          {GEM_QUALITIES.map((q) => (
            <option key={q} value={q}>
              {gemName(vocation, q)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('gems.removeAria', { n })}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-resist hover:bg-resist/10"
        >
          {t('gems.remove')}
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {slotsForQuality(gem.quality).map((slot) => {
          const other = slot === 'basic1' ? gem.basic2 : slot === 'basic2' ? gem.basic1 : null;
          const options = modsForSlot(mods, slot).filter((m) => slotKind(slot) === 'supreme' || m.id !== other?.modId);
          return (
            <SlotEditor
              key={slot}
              slot={slot}
              value={gem[slot]}
              options={options}
              onChange={(ref) => onChange({ ...gem, [slot]: ref })}
            />
          );
        })}
      </div>
    </li>
  );
}

interface GemsPanelProps {
  vocation: Vocation;
  gems: OwnedGem[];
  mods: ModDefinition[];
  /** Unlocked vessels without an owned gem in the shown build, per quality. */
  emptyVessels?: Record<GemQuality, number> | null;
  onChange: (update: (gems: OwnedGem[]) => OwnedGem[]) => void;
}

/** Collapsible inventory of owned gems, split into Lesser / Regular / Greater subsections. */
export function GemsPanel({ vocation, gems, mods, emptyVessels, onChange }: GemsPanelProps) {
  const t = useT();
  const bodyId = useId();
  const [open, setOpen] = useState(() => gems.length > 0);
  const totalEmpty = emptyVessels ? GEM_QUALITIES.reduce((n, q) => n + emptyVessels[q], 0) : 0;

  return (
    <Panel
      title={t('gems.title')}
      step={6}
      headingId="gems-heading"
      aside={
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-xs text-gold-400 hover:underline"
        >
          {!open && totalEmpty > 0 && <span className="text-amber-400">{t('gems.emptyTotal', { n: totalEmpty })}</span>}
          {gems.length > 0 && <span className="text-parchment-400">{t('gems.count', { n: gems.length })}</span>}
          {open ? t('common.hide') : t('common.show')}
        </button>
      }
    >
      <div id={bodyId} hidden={!open}>
        {mods.length === 0 && <p className="mb-2 text-xs text-parchment-400">{t('gems.noModData')}</p>}
        {gems.length === 0 && <p className="mb-3 text-sm text-parchment-300">{t('gems.empty')}</p>}
        <div className="flex flex-col gap-3">
          {GEM_QUALITIES.map((q) => {
            const empty = emptyVessels?.[q] ?? 0;
            const name = gemName(vocation, q);
            const list = gems.flatMap((gem, index) => (gem.quality === q ? [{ gem, index }] : []));
            return (
              <section
                key={q}
                aria-label={name}
                className={cx('rounded-xl border p-2.5', empty > 0 ? 'border-amber-500/80 bg-amber-500/5' : 'border-ink-700')}
              >
                <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-parchment-100">
                  <GemIcon quality={q} />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  {list.length > 0 && <span className="text-xs font-normal text-parchment-400">{list.length}</span>}
                </h3>
                {empty > 0 && (
                  <p className="mb-2 text-xs text-amber-300">
                    {t(empty === 1 ? 'gems.emptyVessels.one' : 'gems.emptyVessels.other', {
                      n: empty,
                      quality: t(`quality.${q}`).toLowerCase(),
                    })}
                  </p>
                )}
                {list.length === 0 ? (
                  <p className="mb-2 text-xs text-parchment-400">{t('gems.sectionEmpty')}</p>
                ) : (
                  <ul className="mb-2 flex flex-col gap-2">
                    {list.map(({ gem, index }) => (
                      <GemCard
                        key={gem.id}
                        gem={gem}
                        index={index}
                        vocation={vocation}
                        mods={mods}
                        onChange={(next) => onChange((all) => updateGem(all, next))}
                        onRemove={() => onChange((all) => all.filter((g) => g.id !== gem.id))}
                      />
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => onChange((all) => [...all, createGem(q)])}
                  aria-label={t('gems.addOf', { name })}
                  className="rounded-lg border border-gold-600 bg-gold-700/30 px-3 py-1 text-sm font-medium text-gold-300 hover:bg-gold-700/50"
                >
                  + {t('gems.add')}
                </button>
              </section>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-parchment-400">{t('gems.storedLocally')}</p>
      </div>
    </Panel>
  );
}
