import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { MeleeSkill, OwnedWeapon, Vocation } from '../types';
import { useT } from '../i18n';
import { getShapingOption, getWeapon, iconKeys, levelOptions, searchWeapons, shapingId, shapingOptions, type Weapon, type WeaponPerk } from '../lib/api';
import { cx } from '../lib/labels';
import { MAX_SHAPED, ownWeapon, perkLabel, setPerk, setShaped, shapingLabel, type WeaponPrefs } from '../lib/weapons';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { Panel } from './Panel';
import { PerkIcon } from './PerkIcon';

interface WeaponSearchProps {
  vocation: Vocation;
  owned: ReadonlySet<string>;
  onAdd: (w: Weapon) => void;
}

/** ARIA 1.2 combobox adding a weapon of the vocation. */
function WeaponSearch({ vocation, owned, onAdd }: WeaponSearchProps) {
  const t = useT();
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounced = useDebouncedValue(query, 120);
  const results = useMemo(
    () => searchWeapons(debounced, vocation, 12 + owned.size).filter((w) => !owned.has(w.id)).slice(0, 12),
    [debounced, vocation, owned],
  );
  const expanded = open && query.trim() !== '' && debounced === query;

  const select = (w: Weapon) => {
    onAdd(w);
    setQuery('');
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (results.length) setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % results.length : a <= 0 ? results.length - 1 : a - 1));
    } else if (e.key === 'Enter' && expanded && results.length) {
      e.preventDefault();
      select(results[Math.max(0, active)]);
    } else if (e.key === 'Escape') {
      if (expanded) setOpen(false);
      else setQuery('');
      setActive(-1);
    }
  };

  return (
    <div className="relative">
      <label htmlFor={`${id}-input`} className="sr-only">
        {t('weapons.search')}
      </label>
      <input
        id={`${id}-input`}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        placeholder={`${t('weapons.search')} (${t('weapons.searchPlaceholder')})`}
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
        aria-label={t('weapons.search')}
        hidden={!expanded}
        className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-ink-600 bg-ink-850 py-1 shadow-xl shadow-black/60"
      >
        {results.length === 0 ? (
          <li className="px-3 py-2 text-sm text-parchment-400" role="presentation">
            {t('weapons.noResults')}
          </li>
        ) : (
          results.map((w, i) => (
            <li
              key={w.id}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              aria-label={t('weapons.addAria', { name: w.name })}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(w)}
              onMouseEnter={() => setActive(i)}
              className={cx(
                'flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm',
                i === active ? 'bg-gold-700/35 text-parchment-50' : 'text-parchment-200',
              )}
            >
              <span className="truncate">{w.name}</span>
              <WeaponMeta weapon={w} />
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export function WeaponMeta({ weapon }: { weapon: Weapon }) {
  const t = useT();
  return (
    <span className="shrink-0 text-xs text-parchment-400">
      {t(`weapons.type.${weapon.type}`)} · {t('weapons.minLevel', { n: weapon.minLevel })}
      {weapon.hands === 2 && vocationUsesShield(weapon) ? ` · ${t('weapons.hands2')}` : ''}
    </span>
  );
}

/** Two-handedness only matters for weapons a shield could go with (knights). */
const vocationUsesShield = (w: Weapon) => w.vocations.includes('knight');

interface PerkGridProps {
  owned: OwnedWeapon;
  weapon: Weapon;
  onChange: (o: OwnedWeapon) => void;
}

/**
 * D50: compact proficiency tree — one column of perk icons per level; a click picks a perk by hand (gold frame),
 * a second click returns the level to Auto. Locked levels are dimmed. The legend below names every icon.
 */
function PerkGrid({ owned, weapon, onChange }: PerkGridProps) {
  const t = useT();
  const all = levelOptions({ ...owned, level: weapon.levels.length }, weapon);
  const shaped = owned.shaped ?? [];
  const legend = new Map<string, { perk: WeaponPerk; labels: string[] }>();
  all.forEach((level, i) =>
    level.forEach((p) => {
      const key = iconKeys(p).join('|');
      const entry = legend.get(key) ?? { perk: p, labels: [] };
      entry.labels.push(`${i + 1}: ${perkLabel(t, p)}`);
      legend.set(key, entry);
    }),
  );
  return (
    <div>
      <ol className="flex gap-1 overflow-x-auto pb-1" aria-label={t('weapons.tree')}>
        {all.map((level, i) => {
          const locked = i >= owned.level;
          const choice = owned.perks?.[i];
          const shape = shaped.find((x) => x.level === i + 1);
          return (
            <li key={i} className={cx('flex shrink-0 flex-col items-center gap-1', locked && 'opacity-35')}>
              <span className="text-[10px] tabular-nums text-parchment-400">{i + 1}</span>
              {level.map((p, k) => {
                const label = `${t('weapons.levelN', { n: i + 1 })}: ${perkLabel(t, p)}`;
                const picked = choice === k;
                const mark = shape?.replaces === k && (
                  <span aria-hidden="true" className="absolute -left-1 -top-1 text-[10px] leading-none text-gold-300">✦</span>
                );
                if (level.length === 1 || locked)
                  return (
                    <span key={k} title={label} className="relative rounded-md border border-ink-600 p-0.5">
                      <span className="sr-only">{label}</span>
                      <PerkIcon perk={p} />
                      {mark}
                    </span>
                  );
                return (
                  <button
                    key={k}
                    type="button"
                    title={label}
                    aria-label={label}
                    aria-pressed={picked}
                    onClick={() => onChange(setPerk(owned, i, picked ? null : k))}
                    className={cx(
                      'relative rounded-md border p-0.5',
                      picked ? 'border-gold-400 bg-gold-700/30' : 'border-ink-600 hover:border-gold-600',
                    )}
                  >
                    <PerkIcon perk={p} />
                    {mark}
                  </button>
                );
              })}
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-[11px] text-parchment-400">{t('weapons.gridHint')}</p>
      <ul className="mt-1.5 grid gap-1" aria-label={t('weapons.legend')}>
        {[...legend].map(([key, { perk, labels }]) => (
          <li key={key} className="flex items-center gap-2 text-[11px] text-parchment-200">
            <PerkIcon perk={perk} size={16} />
            <span className="min-w-0">{labels.join(' · ')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface WeaponCardProps {
  owned: OwnedWeapon;
  vocation: Vocation;
  meleeSkill: MeleeSkill | null;
  onChange: (o: OwnedWeapon) => void;
  onRemove: () => void;
}

function WeaponCard({ owned, vocation, meleeSkill, onChange, onRemove }: WeaponCardProps) {
  const t = useT();
  const id = useId();
  const weapon = getWeapon(owned.weaponId);
  const shapes = useMemo(() => shapingOptions(vocation), [vocation]);
  if (!weapon) return null;
  const options = levelOptions(owned, weapon);
  const original = levelOptions({ level: owned.level }, weapon);
  const shaped = owned.shaped ?? [];
  return (
    <li className="rounded-xl border border-ink-600 bg-ink-950/50 p-3">
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-parchment-100">{weapon.name}</p>
          <WeaponMeta weapon={weapon} />
          {vocation === 'knight' && meleeSkill && weapon.type !== meleeSkill && (
            <p className="text-[11px] text-resist">{t('weapons.otherSkill', { skill: t(`skill.${meleeSkill}`) })}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('weapons.removeAria', { name: weapon.name })}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-resist hover:bg-resist/10"
        >
          {t('weapons.remove')}
        </button>
      </div>
      <div className="mb-2 flex items-center gap-2">
        <label htmlFor={`${id}-level`} className="text-xs text-parchment-300">
          {t('weapons.level')}
        </label>
        <select
          id={`${id}-level`}
          value={owned.level}
          onChange={(e) => onChange({ ...owned, level: Number(e.target.value) })}
          className="field w-20 py-1 text-sm"
        >
          {Array.from({ length: weapon.levels.length + 1 }, (_, n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <PerkGrid owned={owned} weapon={weapon} onChange={onChange} />
      {options.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-gold-400 hover:underline">
            {t('weapons.shapes')} · {shaped.length}/{MAX_SHAPED}
          </summary>
          <p className="mt-1 text-[11px] text-parchment-400">{t('weapons.shapeLimit', { n: MAX_SHAPED })}</p>
          <div className="mt-1 flex flex-col gap-2">
            {original.map((level, i) => {
              const shape = shaped.find((s) => s.level === i + 1);
              const full = !shape && shaped.length >= MAX_SHAPED;
              return (
                <div key={i} className="grid gap-1">
                  <label htmlFor={`${id}-shape-${i}`} className="text-[11px] text-parchment-400">
                    {t('weapons.shape', { n: i + 1 })}
                  </label>
                  <select
                    id={`${id}-shape-${i}`}
                    value={shape?.option ?? ''}
                    disabled={full}
                    onChange={(e) => onChange(setShaped(owned, i + 1, e.target.value || null, shape?.replaces ?? level.length - 1))}
                    className="field min-w-0 py-1 text-sm"
                  >
                    <option value="">{t('weapons.shapeNone')}</option>
                    {shapes.map((o) => (
                      <option key={shapingId(o)} value={shapingId(o)}>
                        {shapingLabel(t, o, 10)}
                      </option>
                    ))}
                  </select>
                  {shape && level.length > 1 && (
                    <div className="flex items-center gap-2">
                      <label htmlFor={`${id}-repl-${i}`} className="shrink-0 text-[11px] text-parchment-400">
                        {t('weapons.shapeReplaces')}
                      </label>
                      <select
                        id={`${id}-repl-${i}`}
                        value={shape.replaces}
                        onChange={(e) => onChange(setShaped(owned, i + 1, shape.option, Number(e.target.value)))}
                        className="field min-w-0 flex-1 py-1 text-xs"
                      >
                        {level.map((p, k) => (
                          <option key={k} value={k}>
                            {perkLabel(t, p)}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {shape && !getShapingOption(shape.option) && <span className="text-[11px] text-resist">{shape.option}</span>}
                </div>
              );
            })}
          </div>
        </details>
      )}
    </li>
  );
}

interface WeaponsPanelProps {
  vocation: Vocation;
  meleeSkill: MeleeSkill | null;
  prefs: WeaponPrefs;
  onChange: (update: (prefs: WeaponPrefs) => WeaponPrefs) => void;
}

/** D47: collapsible list of owned weapons with proficiency level, perk choices and dust reshapes. */
export function WeaponsPanel({ vocation, meleeSkill, prefs, onChange }: WeaponsPanelProps) {
  const t = useT();
  const bodyId = useId();
  const [open, setOpen] = useState(() => prefs.weapons.length > 0);
  const owned = useMemo(() => new Set(prefs.weapons.map((w) => w.weaponId)), [prefs.weapons]);
  const update = (weapons: (all: OwnedWeapon[]) => OwnedWeapon[]) => onChange((p) => ({ ...p, weapons: weapons(p.weapons) }));

  return (
    <Panel
      title={t('weapons.title')}
      step={7}
      headingId="weapons-heading"
      aside={
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-xs text-gold-400 hover:underline"
        >
          {prefs.weapons.length > 0 && <span className="text-parchment-400">{t('weapons.count', { n: prefs.weapons.length })}</span>}
          {open ? t('common.hide') : t('common.show')}
        </button>
      }
    >
      <div id={bodyId} hidden={!open} className="flex flex-col gap-3">
        <WeaponSearch vocation={vocation} owned={owned} onAdd={(w) => update((all) => [...all, ownWeapon(w)])} />
        {prefs.weapons.length === 0 ? (
          <p className="text-sm text-parchment-300">{t('weapons.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {prefs.weapons.map((w) => (
              <WeaponCard
                key={w.weaponId}
                owned={w}
                vocation={vocation}
                meleeSkill={meleeSkill}
                onChange={(next) => update((all) => all.map((x) => (x.weaponId === w.weaponId ? next : x)))}
                onRemove={() => update((all) => all.filter((x) => x.weaponId !== w.weaponId))}
              />
            ))}
          </ul>
        )}
        <p className="text-[11px] text-parchment-400">
          {t('weapons.skillsNote')} {t('weapons.storedLocally')} {t('weapons.iconsCredit')}
        </p>
      </div>
    </Panel>
  );
}
