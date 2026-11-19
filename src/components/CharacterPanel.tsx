import { useId, useState } from 'react';
import { MELEE_SKILLS } from '../types';
import type { Vocation } from '../types';
import { MAX_SCROLL_POINTS, pointsForLevel } from '../lib/api';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { MAX_LEVEL, MAX_SKILL, VOCATION_SKILLS } from '../lib/inputState';
import type { InputState, SkillField } from '../lib/inputState';
import { clamp, formatNumber } from '../lib/labels';
import { cx } from '../lib/labels';
import { Panel } from './Panel';
import { PerkIcon } from './PerkIcon';

type CharacterFields = Pick<InputState, 'points' | 'level' | 'scrolls' | 'meleeSkill' | SkillField>;

interface CharacterPanelProps {
  vocation: Vocation;
  value: CharacterFields;
  /** Total wheel capacity (upper bound). */
  max: number;
  onChange: (patch: Partial<CharacterFields>) => void;
}

const skillLabel = (vocation: Vocation, field: SkillField): MessageKey =>
  field === 'mainSkill' ? (`character.mainSkill.${vocation}` as MessageKey) : `character.${field}`;

/** "" → null, else a rounded number clamped to [min, max]; NaN → undefined (ignore). */
function parseOptional(raw: string, min: number, max: number): number | null | undefined {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? clamp(Math.round(n), min, max) : undefined;
}

/** Character level (drives promotion points), scroll points, manual points override and per-vocation skills. */
export function CharacterPanel({ vocation, value, max, onChange }: CharacterPanelProps) {
  const t = useT();
  const skillId = useId();
  const [text, setText] = useState(String(value.points));
  const [synced, setSynced] = useState(value.points);

  // Keep the points field in sync when the value changes from outside (level, clamp, URL).
  if (synced !== value.points) {
    setSynced(value.points);
    if (!(Number(text) === value.points && text !== '')) setText(String(value.points));
  }

  const levelPoints = value.level !== null ? pointsForLevel(value.level, value.scrolls) : null;

  const commitPoints = (raw: string) => {
    setText(raw);
    if (raw.trim() === '') return;
    const n = Number(raw);
    if (Number.isFinite(n)) onChange({ points: clamp(Math.round(n), 0, max) });
  };

  const onLevel = (raw: string) => {
    const level = parseOptional(raw, 1, MAX_LEVEL);
    if (level === undefined) return;
    onChange(level === null ? { level } : { level, points: clamp(pointsForLevel(level, value.scrolls), 0, max) });
  };

  const onScrolls = (raw: string) => {
    const scrolls = clamp(Math.round(Number(raw) || 0), 0, MAX_SCROLL_POINTS);
    onChange(
      value.level === null ? { scrolls } : { scrolls, points: clamp(pointsForLevel(value.level, scrolls), 0, max) },
    );
  };

  return (
    <Panel title={t('character.title')} step={2} headingId="character-heading">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-parchment-300">
          {t('points.level')}
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_LEVEL}
            step={1}
            placeholder={t('points.levelPlaceholder')}
            value={value.level ?? ''}
            onChange={(e) => onLevel(e.target.value)}
            className="field text-lg tabular-nums"
          />
        </label>
        <span className="pb-2.5 text-xs text-parchment-400">→</span>
        <label className="flex flex-col gap-1 text-xs text-parchment-300">
          {t('points.points')}
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={max}
            step={1}
            value={text}
            onChange={(e) => commitPoints(e.target.value)}
            onBlur={() => setText(String(value.points))}
            className="field text-lg tabular-nums"
            aria-describedby="points-help"
          />
        </label>
      </div>
      <label className="mt-2 flex items-center justify-between gap-2 text-xs text-parchment-300">
        {t('points.scrolls', { max: MAX_SCROLL_POINTS })}
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_SCROLL_POINTS}
          step={1}
          value={value.scrolls}
          onChange={(e) => onScrolls(e.target.value)}
          className="field w-20 tabular-nums"
        />
      </label>
      <p id="points-help" className="mt-2 text-xs text-parchment-400">
        {levelPoints !== null && value.level !== null && (
          <>
            {t('points.levelEquals', { level: formatNumber(value.level), points: formatNumber(levelPoints) })}
            {levelPoints > max && t('points.capped')}
            {Math.min(levelPoints, max) !== value.points && t('character.override')}.{' '}
          </>
        )}
        {t('points.capacity', { points: formatNumber(max) })}
      </p>

      <fieldset className="mt-3">
        <legend className="mb-1 text-xs text-parchment-300">{t('character.skills')}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {VOCATION_SKILLS[vocation].map((field) => (
            <div key={field} className="flex flex-col gap-1 text-xs text-parchment-300">
              <div className="flex items-center justify-between gap-1">
                <label htmlFor={`${skillId}-${field}`}>{t(skillLabel(vocation, field))}</label>
                {vocation === 'knight' && field === 'mainSkill' && (
                  <div role="group" aria-label={t('character.meleeSkill')} className="flex gap-0.5">
                    {MELEE_SKILLS.map((s) => {
                      const on = value.meleeSkill === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          aria-pressed={on}
                          title={`${t('character.meleeSkill')}: ${t(`skill.${s}`)}`}
                          aria-label={t(`skill.${s}`)}
                          onClick={() => onChange({ meleeSkill: on ? null : s })}
                          className={cx('rounded border', on ? 'border-gold-400 bg-gold-700/30' : 'border-transparent opacity-60 hover:opacity-100')}
                        >
                          <PerkIcon perk={{ kind: 'skill', skill: s }} size={16} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <input
                id={`${skillId}-${field}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_SKILL}
                step={1}
                placeholder={t('character.auto')}
                value={value[field] ?? ''}
                onChange={(e) => {
                  const v = parseOptional(e.target.value, 0, MAX_SKILL);
                  if (v !== undefined) onChange({ [field]: v });
                }}
                className="field tabular-nums"
              />
            </div>
          ))}
        </div>
        <p className="mt-1 text-xs text-parchment-400">
          {t('character.autoHint')}
          {vocation === 'knight' && ` ${t('character.meleeSkillHint')}`}
        </p>
      </fieldset>
    </Panel>
  );
}
