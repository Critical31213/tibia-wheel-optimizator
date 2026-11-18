import type { FightContext, FightMode } from '../types';
import { useT } from '../i18n';
import { Panel } from './Panel';
import { SegmentedControl } from './SegmentedControl';

interface FightContextPanelProps {
  value: FightContext;
  onChange: (patch: Partial<FightContext>) => void;
}

/** Hunt / Boss toggle. */
export function FightContextPanel({ value, onChange }: FightContextPanelProps) {
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
      {value.mode === 'hunt' && <p className="mt-2 text-xs text-parchment-300">{t('context.singleTargetNote')}</p>}
      <p className="mt-2 text-xs text-parchment-400">{t('context.hint')}</p>
    </Panel>
  );
}
