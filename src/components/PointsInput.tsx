import { useState } from 'react';
import { MAX_SCROLL_POINTS, pointsForLevel } from '../lib/api';
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
  const [scrolls, setScrolls] = useState(0);

  const [synced, setSynced] = useState(value);

  // Keep the field in sync when the value changes from outside (level helper, clamp, URL).
  if (synced !== value) {
    setSynced(value);
    if (!(Number(text) === value && text !== '')) setText(String(value));
  }

  const commit = (raw: string) => {
    setText(raw);
    if (raw.trim() === '') return;
    const n = Number(raw);
    if (Number.isFinite(n)) onChange(clamp(Math.round(n), 0, max));
  };

  const levelToPoints = (raw: string, sc: number) => {
    const lv = Number(raw);
    return raw.trim() !== '' && Number.isFinite(lv) ? pointsForLevel(Math.round(lv), sc) : null;
  };

  const onLevel = (raw: string, sc = scrolls) => {
    setLevel(raw);
    setScrolls(sc);
    const pts = levelToPoints(raw, sc);
    if (pts !== null) onChange(clamp(pts, 0, max));
  };

  const levelPoints = levelToPoints(level, scrolls);

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
      <label className="mt-2 flex items-center justify-between gap-2 text-xs text-parchment-300">
        Promotion scroll points (0–{MAX_SCROLL_POINTS}, added to level)
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_SCROLL_POINTS}
          step={1}
          value={scrolls}
          onChange={(e) => onLevel(level, clamp(Math.round(Number(e.target.value) || 0), 0, MAX_SCROLL_POINTS))}
          className="field w-20 tabular-nums"
        />
      </label>
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
