import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Monster } from '../types';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useT } from '../i18n';
import { searchMonsters } from '../lib/api';
import { cx, formatNumber } from '../lib/labels';
import { MonsterCard } from './MonsterCard';
import { Panel } from './Panel';

interface MonsterSearchProps {
  value: Monster | null;
  /** False while the monster dataset chunk is still loading. */
  ready: boolean;
  onChange: (m: Monster | null) => void;
}

/** ARIA 1.2 combobox (list autocomplete) over the monster dataset. */
export function MonsterSearch({ value, ready, onChange }: MonsterSearchProps) {
  const t = useT();
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounced = useDebouncedValue(query, 150);
  const results = useMemo(() => (ready ? searchMonsters(debounced, 12) : []), [debounced, ready]);
  const expanded = open && query.trim() !== '' && debounced === query;

  const select = (m: Monster | null) => {
    onChange(m);
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
        value && (
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
          placeholder={t('monster.placeholder')}
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
      <div className="mt-3" aria-live="polite">
        {value ? (
          <MonsterCard monster={value} />
        ) : (
          <p className="rounded-xl border border-dashed border-ink-600 px-3 py-2.5 text-sm text-parchment-300">
            {t('monster.generic')}
          </p>
        )}
      </div>
    </Panel>
  );
}
