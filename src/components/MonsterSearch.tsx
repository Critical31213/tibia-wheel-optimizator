import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ATTACK_ELEMENTS } from '../types';
import type { Monster, WeightedMonster } from '../types';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useT } from '../i18n';
import { searchMonsters } from '../lib/api';
import { MAX_MONSTERS, MAX_WEIGHT, MIN_WEIGHT, normalizeWeight } from '../lib/inputState';
import type { MonsterEntry } from '../lib/inputState';
import { cx, formatNumber, modifierKind } from '../lib/labels';
import { combinedDamageTypes, combinedModifiers } from '../lib/monsters';
import { ElementChip, MonsterCard } from './MonsterCard';
import { Panel } from './Panel';

interface MonsterSearchProps {
  /** Monsters of the hunting spot (resolved from the dataset). */
  value: WeightedMonster[];
  /** False while the monster dataset chunk is still loading. */
  ready: boolean;
  onChange: (entries: MonsterEntry[]) => void;
}

function WeightInput({ name, value, onChange }: { name: string; value: number; onChange: (w: number) => void }) {
  const t = useT();
  const [text, setText] = useState(String(value));
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setText(String(value));
  }
  return (
    <label className="flex items-center gap-1 text-xs text-parchment-300">
      <span className="sr-only">{t('monster.weightOf', { name })}</span>
      <span aria-hidden="true">×</span>
      <input
        type="number"
        inputMode="decimal"
        min={MIN_WEIGHT}
        max={MAX_WEIGHT}
        step={1}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const w = normalizeWeight(e.target.value);
          if (w !== undefined) onChange(w);
        }}
        onBlur={() => setText(String(value))}
        className="field w-24 py-1 tabular-nums"
      />
    </label>
  );
}

/** Weighted-average element modifiers and damage types of the whole spot. */
function CombinedCard({ list }: { list: WeightedMonster[] }) {
  const t = useT();
  const avg = combinedModifiers(list);
  const mods = ATTACK_ELEMENTS.map((element) => ({ element, percent: avg[element], kind: modifierKind(avg[element]) }))
    .filter((m) => m.kind !== 'neutral')
    .sort((a, b) => b.percent - a.percent);
  const deals = combinedDamageTypes(list);
  return (
    <div className="rounded-xl border border-ink-600 bg-ink-950/50 p-3">
      <h3 className="text-sm text-parchment-50">{t('monster.combined')}</h3>
      <p className="mt-2 mb-1 text-xs text-parchment-400">{t('card.takes')}</p>
      {mods.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('card.modifiers')}>
          {mods.map((m) => (
            <ElementChip key={m.element} element={m.element} kind={m.kind} percent={m.percent} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-parchment-300">{t('card.neutral')}</p>
      )}
      {deals.length > 0 && (
        <>
          <p className="mt-3 mb-1 text-xs text-parchment-400">{t('card.deals')}</p>
          <ul className="flex flex-wrap gap-1.5" aria-label={t('card.dealsList')}>
            {deals.map((el) => (
              <ElementChip key={el} element={el} kind="neutral" />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Hunting spot: ARIA 1.2 combobox (list autocomplete) adding monsters, each with a weight. */
export function MonsterSearch({ value, ready, onChange }: MonsterSearchProps) {
  const t = useT();
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounced = useDebouncedValue(query, 150);
  const chosen = useMemo(() => new Set(value.map((w) => w.monster.id)), [value]);
  const results = useMemo(
    () => (ready ? searchMonsters(debounced, 12 + chosen.size).filter((m) => !chosen.has(m.id)).slice(0, 12) : []),
    [debounced, ready, chosen],
  );
  const expanded = open && query.trim() !== '' && debounced === query;
  const full = value.length >= MAX_MONSTERS;
  const entries = (): MonsterEntry[] => value.map((w) => ({ id: w.monster.id, weight: w.weight }));

  const select = (m: Monster | null) => {
    onChange(m === null ? [] : full ? entries() : [...entries(), { id: m.id, weight: 1 }]);
    setQuery('');
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      if (results.length) setActive((a) => (a + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (results.length) setActive((a) => (a <= 0 ? results.length - 1 : a - 1));
    } else if (e.key === 'Enter') {
      if (expanded && results.length) {
        e.preventDefault();
        select(results[Math.max(0, active)]);
      }
    } else if (e.key === 'Escape') {
      if (expanded) setOpen(false);
      else setQuery('');
      setActive(-1);
    }
  };

  return (
    <Panel
      title={t('monster.title')}
      step={3}
      headingId="monster-heading"
      aside={
        value.length > 0 && (
          <button type="button" onClick={() => select(null)} className="text-xs text-gold-400 hover:underline">
            {t('monster.clear')}
          </button>
        )
      }
    >
      <div className="relative">
        <label htmlFor={`${id}-input`} className="sr-only">
          {t('monster.searchLabel')}
        </label>
        <input
          id={`${id}-input`}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          placeholder={full ? t('monster.full', { max: MAX_MONSTERS }) : t('monster.placeholder')}
          disabled={full}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 ? `${id}-opt-${active}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          className="field"
        />
        <ul
          id={listId}
          role="listbox"
          aria-label={t('monster.list')}
          hidden={!expanded}
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-ink-600 bg-ink-850 py-1 shadow-xl shadow-black/60"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-parchment-400" role="presentation">
              {ready ? t('monster.notFound') : t('monster.loading')}
            </li>
          ) : (
            results.map((m, i) => (
              <li
                key={m.id}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(m)}
                onMouseEnter={() => setActive(i)}
                className={cx(
                  'flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm',
                  i === active ? 'bg-gold-700/35 text-parchment-50' : 'text-parchment-200',
                )}
              >
                <span className="truncate">{m.name}</span>
                {m.hitpoints !== undefined && (
                  <span className="shrink-0 text-xs tabular-nums text-parchment-400">{t('monster.hp', { hp: formatNumber(m.hitpoints) })}</span>
                )}
              </li>
            ))
          )}
        </ul>
      </div>
      <div className="mt-3 flex flex-col gap-3" aria-live="polite">
        {value.length > 0 ? (
          <>
            <ul className="flex flex-col gap-1.5" aria-label={t('monster.spot')}>
              {value.map((w) => (
                <li key={w.monster.id} className="flex items-center gap-2 rounded-lg border border-ink-600 px-2 py-1">
                  <span className="min-w-0 flex-1 truncate text-sm text-parchment-100">{w.monster.name}</span>
                  <WeightInput
                    name={w.monster.name}
                    value={w.weight}
                    onChange={(weight) =>
                      onChange(entries().map((e) => (e.id === w.monster.id ? { ...e, weight } : e)))
                    }
                  />
                  <button
                    type="button"
                    onClick={() => onChange(entries().filter((e) => e.id !== w.monster.id))}
                    aria-label={t('monster.removeAria', { name: w.monster.name })}
                    className="px-1 text-xs text-gold-400 hover:underline"
                  >
                    {t('gems.remove')}
                  </button>
                </li>
              ))}
            </ul>
            {value.length === 1 ? <MonsterCard monster={value[0].monster} /> : <CombinedCard list={value} />}
          </>
        ) : (
          <p className="rounded-xl border border-dashed border-ink-600 px-3 py-2.5 text-sm text-parchment-300">
            {t('monster.generic')}
          </p>
        )}
      </div>
    </Panel>
  );
}
