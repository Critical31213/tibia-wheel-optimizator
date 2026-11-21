import { useId } from 'react';
import { useT } from '../i18n';
import { PRIORITY_STEPS, priorityKey, snapPriority } from '../lib/labels';
import { SegmentedControl } from './SegmentedControl';

interface PrioritySliderProps {
  value: number;
  onChange: (v: number) => void;
}

/** D91: five fixed steps, 0 = Max DPS … 100 = Max Survivability (DPS–survival weights 100–0 … 0–100). */
export function PrioritySlider({ value, onChange }: PrioritySliderProps) {
  const t = useT();
  const id = useId();
  const step = snapPriority(value);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span id={`${id}-label`} className="text-parchment-300">{t('priority.title')}</span>
        <span className="font-semibold text-gold-300">{t(priorityKey(step))}</span>
      </div>
      <SegmentedControl
        labelledBy={`${id}-label`}
        options={PRIORITY_STEPS.map((p) => ({
          value: p,
          label: `${100 - p}–${p}`,
          title: t('priority.stepTitle', { label: t(priorityKey(p)), dps: 100 - p, defense: p }),
        }))}
        value={step}
        onChange={onChange}
      />
      <div className="mt-1 flex justify-between text-[11px]">
        <span className="text-offense">{t('priority.maxDps')}</span>
        <span className="text-parchment-400">{t('priority.weights')}</span>
        <span className="text-defense">{t('priority.maxSurvival')}</span>
      </div>
    </div>
  );
}
