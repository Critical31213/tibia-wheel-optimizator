import { useT } from '../i18n';
import { priorityKey } from '../lib/labels';
import { Panel } from './Panel';

interface PrioritySliderProps {
  value: number;
  onChange: (v: number) => void;
}

/** 0 = Max DPS, 100 = Max Survivability. Results recompute live. */
export function PrioritySlider({ value, onChange }: PrioritySliderProps) {
  const t = useT();
  const label = t(priorityKey(value));
  return (
    <Panel
      title={t('priority.title')}
      step={5}
      headingId="priority-heading"
      aside={<span className="text-xs font-semibold text-gold-300">{label}</span>}
    >
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        list="priority-ticks"
        aria-labelledby="priority-heading"
        aria-valuetext={t('priority.valueText', { label, value })}
        className="priority-range w-full"
      />
      <datalist id="priority-ticks">
        <option value="50" />
      </datalist>
      <div className="relative mt-1 flex justify-between text-xs text-parchment-300">
        <span className="text-offense">{t('priority.maxDps')}</span>
        <button
          type="button"
          onClick={() => onChange(50)}
          className="absolute left-1/2 -translate-x-1/2 text-parchment-400 hover:text-gold-300"
        >
          {t('priority.balanced')}
        </button>
        <span className="text-defense">{t('priority.maxSurvival')}</span>
      </div>
    </Panel>
  );
}
