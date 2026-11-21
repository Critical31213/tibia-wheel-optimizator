import { useId } from 'react';
import { useT } from '../i18n';
import { PRIORITY_STEPS, priorityKey, snapPriority } from '../lib/labels';

interface PrioritySliderProps {
  value: number;
  onChange: (v: number) => void;
}

const STEP = PRIORITY_STEPS[1] - PRIORITY_STEPS[0];

/** D91: slider with five fixed positions, 0 = Max DPS … 100 = Max Survivability (DPS–survival 100–0 … 0–100). */
export function PrioritySlider({ value, onChange }: PrioritySliderProps) {
  const t = useT();
  const id = useId();
  const step = snapPriority(value);
  const label = t(priorityKey(step));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span id={`${id}-label`} className="text-parchment-300">{t('priority.title')}</span>
        <span className="font-semibold text-gold-300">
          {label} <span className="font-normal text-parchment-400">· {100 - step}–{step}</span>
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={STEP}
        value={step}
        onChange={(e) => onChange(snapPriority(Number(e.target.value)))}
        list={`${id}-ticks`}
        aria-labelledby={`${id}-label`}
        aria-valuetext={t('priority.stepTitle', { label, dps: 100 - step, defense: step })}
        className="priority-range w-full"
      />
      <datalist id={`${id}-ticks`}>
        {PRIORITY_STEPS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <div className="mt-0.5 flex justify-between px-1 text-[10px] text-parchment-400 tabular-nums" aria-hidden="true">
        {PRIORITY_STEPS.map((p) => (
          <span key={p} className={p === step ? 'text-gold-300' : undefined}>
            {100 - p}–{p}
          </span>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px]">
        <span className="text-offense">{t('priority.maxDps')}</span>
        <span className="text-defense">{t('priority.maxSurvival')}</span>
      </div>
    </div>
  );
}
