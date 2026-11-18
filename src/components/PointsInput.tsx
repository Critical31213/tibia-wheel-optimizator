import { useEffect, useState } from 'react';
import { pointsForLevel } from '../lib/api';
import { clamp, formatNumber } from '../lib/labels';
import { Panel } from './Panel';

interface PointsInputProps {
  value: number;
  /** Total wheel capacity (upper bound). */
  max: number;
  onChange: (points: number) => void;
}

/** Promotion points, with an optional "enter level instead" helper. */
export function PointsInput({ value, max, onChange }: PointsInputProps) {
  const [text, setText] = useState(String(value));
  const [level, setLevel] = useState('');

  // Keep the field in sync when the value changes from outside (level helper, clamp, URL).
  useEffect(() => {
    setText((t) => (Number(t) === value && t !== '' ? t : String(value)));
  }, [value]);

  const commit = (raw: string) => {
    setText(raw);
    if (raw.trim() === '') return;
    const n = Number(raw);
    if (Number.isFinite(n)) onChange(clamp(Math.round(n), 0, max));
  };

  const onLevel = (raw: string) => {
    setLevel(raw);
    const lv = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(lv)) onChange(clamp(pointsForLevel(Math.round(lv)), 0, max));
  };

  const levelPoints = level.trim() !== '' && Number.isFinite(Number(level)) ? pointsForLevel(Math.round(Number(level))) : null;

  return (
    <Panel title="Promotion points" step={2} headingId="points-heading">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-parchment-300">
          Points
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={max}
            step={1}
            value={text}
            onChange={(e) => commit(e.target.value)}
            onBlur={() => setText(String(value))}
            className="field text-lg tabular-nums"
            aria-describedby="points-help"
          />
        </label>
        <span className="pb-2.5 text-xs text-parchment-400">or</span>
        <label className="flex flex-col gap-1 text-xs text-parchment-300">
          Character level
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            placeholder="e.g. 400"
            value={level}
            onChange={(e) => onLevel(e.target.value)}
            className="field text-lg tabular-nums"
          />
        </label>
      </div>
      <p id="points-help" className="mt-2 text-xs text-parchment-400">
        {levelPoints !== null && (
          <>
            Level {formatNumber(Math.round(Number(level)))} ≈ {formatNumber(levelPoints)} points
            {levelPoints > max && ' (capped)'}.{' '}
          </>
        )}
        Wheel capacity: <span className="text-parchment-200 tabular-nums">{formatNumber(max)}</span> points.
      </p>
    </Panel>
  );
}
