import type { FightContext, FightMode } from '../types';
import { useT } from '../i18n';
import { Panel } from './Panel';
import { PrioritySlider } from './PrioritySlider';
import { SegmentedControl } from './SegmentedControl';

interface FightContextPanelProps {
  value: FightContext;
  onChange: (patch: Partial<FightContext>) => void;
  priority: number;
  onPriorityChange: (v: number) => void;
}

/** D54: hunt / boss toggle and the priority slider in one panel. */
export function FightContextPanel({ value, onChange, priority, onPriorityChange }: FightContextPanelProps) {
  const t = useT();
  return (
    <Panel title={t('context.title')} step={4} headingId="context-heading">
      <SegmentedControl<FightMode>
        label={t('context.mode')}
        value={value.mode}
        onChange={(mode) => onChange({ mode })}
        options={[
          { value: 'hunt', label: t('context.hunt') },
          { value: 'boss', label: t('context.boss') },
        ]}
      />
      <div className="mt-3">
        <PrioritySlider value={priority} onChange={onPriorityChange} />
      </div>
    </Panel>
  );
}
