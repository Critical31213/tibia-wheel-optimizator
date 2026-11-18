import type { FightContext, FightMode, HuntStyle } from '../types';
import { useT } from '../i18n';
import { Panel } from './Panel';
import { SegmentedControl } from './SegmentedControl';

interface FightContextPanelProps {
  value: FightContext;
  onChange: (patch: Partial<FightContext>) => void;
}

/** Hunt / Boss toggle and, for hunts, the expected pull size. */
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
      {value.mode === 'hunt' && (
        <>
          <p id="hunt-style-label" className="mt-3 mb-1 text-xs text-parchment-300">
            {t('context.huntStyle')}
          </p>
          <SegmentedControl<HuntStyle>
            labelledBy="hunt-style-label"
            value={value.huntStyle}
            onChange={(huntStyle) => onChange({ huntStyle })}
            className="flex-col sm:flex-row"
            options={[
              { value: 'solo', label: t('context.solo') },
              { value: 'teamLure', label: t('context.teamLure') },
              { value: 'teamBox', label: t('context.teamBox') },
            ]}
          />
        </>
      )}
      <p className="mt-2 text-xs text-parchment-400">{t('context.hint')}</p>
    </Panel>
  );
}
