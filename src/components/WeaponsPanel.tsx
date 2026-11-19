import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { MeleeSkill, OwnedWeapon, Vocation } from '../types';
import { useT } from '../i18n';
import { getShapingOption, getWeapon, levelOptions, searchWeapons, shapingId, shapingOptions, type Weapon } from '../lib/api';
import { cx } from '../lib/labels';
import { MAX_SHAPED, ownWeapon, perkLabel, setPerk, setShaped, shapingLabel, type WeaponPrefs } from '../lib/weapons';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { Panel } from './Panel';
import { PerkIcon } from './PerkIcon';
import { Tip } from './Tip';

interface WeaponSearchProps {
  vocation: Vocation;
  /** D53: knights with a trained melee skill only see weapons of that type. */
  meleeSkill: MeleeSkill | null;
  owned: ReadonlySet<string>;
  onAdd: (w: Weapon) => void;
}

/** ARIA 1.2 combobox adding a weapon of the vocation. */
function WeaponSearch({ vocation, meleeSkill, owned, onAdd }: WeaponSearchProps) {
  const t = useT();
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounced = useDebouncedValue(query, 120);
  const results = useMemo(
    () =>
      searchWeapons(debounced, vocation, Infinity)
        .filter((w) => !owned.has(w.id) && (vocation !== 'knight' || !meleeSkill || w.type === meleeSkill))
        .slice(0, 12),
    [debounced, vocation, meleeSkill, owned],
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

/** Tooltip alignment for item `i` of `n` in a row, so edge tooltips stay inside the card. */
const tipAlign = (i: number, n: number): 'start' | 'center' | 'end' => (i < 2 ? 'start' : i >= n - 2 ? 'end' : 'center');

interface PerkGridProps {
  owned: OwnedWeapon;
  weapon: Weapon;
  onChange: (o: OwnedWeapon) => void;
}

/**
 * D50/D52: compact proficiency tree — one column of perk icons per level, the effect in a tooltip; a click picks a
 * perk by hand (gold frame), a second click returns the level to Auto. Locked levels are dimmed.
 */
function PerkGrid({ owned, weapon, onChange }: PerkGridProps) {
  const t = useT();
  const all = levelOptions({ ...owned, level: weapon.levels.length }, weapon);
  const shaped = owned.shaped ?? [];
  return (
    <div>
      <ol className="flex gap-1" aria-label={t('weapons.tree')}>
        {all.map((level, i) => {
          const locked = i >= owned.level;
          const choice = owned.perks?.[i];
          const shape = shaped.find((x) => x.level === i + 1);
          return (
            <li key={i} className={cx('flex shrink-0 flex-col items-center gap-1', locked && 'opacity-35')}>
              <span className="text-[10px] tabular-nums text-parchment-400">{i + 1}</span>
              {level.map((p, k) => {
                const label = `${t('weapons.levelN', { n: i + 1 })}: ${perkLabel(t, p)}${shape?.replaces === k ? ' ✦' : ''}`;
                const picked = choice === k;
                const mark = shape?.replaces === k && (
                  <span aria-hidden="true" className="absolute -left-1 -top-1 text-[10px] leading-none text-gold-300">✦</span>
                );
                const fixed = level.length === 1 || locked;
                return (
                  <Tip key={k} text={label} align={tipAlign(i, all.length)}>
                    <button
                      type="button"
                      aria-label={label}
                      aria-pressed={fixed ? undefined : picked}
                      aria-disabled={fixed || undefined}
                      onClick={() => !fixed && onChange(setPerk(owned, i, picked ? null : k))}
                      className={cx(
                        'relative rounded-md border p-0.5',
                        picked && !fixed ? 'border-gold-400 bg-gold-700/30' : 'border-ink-600',
                        !fixed && !picked && 'hover:border-gold-600',
                        fixed && 'cursor-default',
                      )}
                    >
                      <PerkIcon perk={p} />
                      {mark}
                    </button>
                  </Tip>
                );
              })}
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-[11px] text-parchment-400">{t('weapons.gridHint')}</p>
    </div>
  );
}

/** D52: dust reshapes as chips plus one compact "add" row (level, option, replaced perk). */
function ShapeEditor({ owned, weapon, vocation, onChange }: { owned: OwnedWeapon; weapon: Weapon; vocation: Vocation; onChange: (o: OwnedWeapon) => void }) {
  const t = useT();
  const id = useId();
  const shapes = useMemo(() => shapingOptions(vocation), [vocation]);
  const original = levelOptions({ level: owned.level }, weapon);
  const shaped = owned.shaped ?? [];
  const free = original.map((_, i) => i + 1).filter((n) => !shaped.some((s) => s.level === n));
  const [adding, setAdding] = useState(false);
  const [level, setLevel] = useState(0);
  const [option, setOption] = useState('');
  const [replaces, setReplaces] = useState<number | null>(null);
  if (!original.length) return null;
  const L = free.includes(level) ? level : free[free.length - 1];
  const levelOpts = L ? original[L - 1] : [];
  const repl = replaces !== null && replaces < levelOpts.length ? replaces : levelOpts.length - 1;
  const add = () => {
    if (!L || !option) return;
    onChange(setShaped(owned, L, option, repl));
    setAdding(false);
    setOption('');
    setReplaces(null);
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-parchment-400">{t('weapons.shapes')}:</span>
      {shaped.map((s) => {
        const o = getShapingOption(s.option);
        const label = `${t('weapons.levelN', { n: s.level })}: ${o ? shapingLabel(t, o, 10) : s.option}`;
        return (
          <span key={s.level} className="flex items-center gap-1 rounded-md border border-gold-700/60 bg-ink-900 py-0.5 pl-1 pr-0.5">
            <Tip text={label} align="start">
              <span className="flex items-center gap-1" tabIndex={0} aria-label={label}>
                <span className="text-gold-300">✦{s.level}</span>
                {o && <PerkIcon perk={o} size={16} />}
              </span>
            </Tip>
            <button
              type="button"
              onClick={() => onChange(setShaped(owned, s.level, null))}
              aria-label={t('weapons.shapeRemove', { n: s.level })}
              className="rounded px-1 text-parchment-400 hover:text-resist"
            >
              ×
            </button>
          </span>
        );
      })}
      {shaped.length < MAX_SHAPED && free.length > 0 && !adding && (
        <button type="button" onClick={() => setAdding(true)} className="rounded-md border border-dashed border-ink-500 px-1.5 py-0.5 text-gold-400 hover:border-gold-600">
          + ✦
        </button>
      )}
      {shaped.length === 0 && !adding && <span className="text-parchment-500">{t('weapons.shapeNoneShort')}</span>}
      {adding && (
        <div className="flex w-full flex-wrap items-center gap-1.5">
          <label htmlFor={`${id}-lvl`} className="sr-only">{t('weapons.level')}</label>
          <select id={`${id}-lvl`} value={L} onChange={(e) => setLevel(Number(e.target.value))} className="field w-14 py-0.5 text-xs">
            {free.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <label htmlFor={`${id}-opt`} className="sr-only">{t('weapons.shapes')}</label>
          <select id={`${id}-opt`} value={option} onChange={(e) => setOption(e.target.value)} className="field min-w-0 flex-1 py-0.5 text-xs">
            <option value="">{t('weapons.shapePick')}</option>
            {shapes.map((o) => (
              <option key={shapingId(o)} value={shapingId(o)}>{shapingLabel(t, o, 10)}</option>
            ))}
          </select>
          {levelOpts.length > 1 && (
            <span role="group" aria-label={t('weapons.shapeReplaces')} className="flex items-center gap-0.5">
              <span className="text-parchment-400">{t('weapons.shapeReplaces')}:</span>
              {levelOpts.map((p, k) => (
                <Tip key={k} text={perkLabel(t, p)} align="end">
                  <button
                    type="button"
                    aria-pressed={repl === k}
                    aria-label={perkLabel(t, p)}
                    onClick={() => setReplaces(k)}
                    className={cx('rounded border p-px', repl === k ? 'border-gold-400' : 'border-transparent opacity-60 hover:opacity-100')}
                  >
                    <PerkIcon perk={p} size={16} />
                  </button>
                </Tip>
              ))}
            </span>
          )}
          <button type="button" disabled={!option} onClick={add} className="rounded-md bg-gold-700/40 px-2 py-0.5 text-parchment-50 disabled:opacity-40">
            {t('weapons.shapeAdd')}
          </button>
          <button type="button" onClick={() => setAdding(false)} aria-label={t('common.hide')} className="px-1 text-parchment-400 hover:text-parchment-100">
            ×
          </button>
        </div>
      )}
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
  if (!weapon) return null;
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
        <label htmlFor={`${id}-level`} className="sr-only">
          {t('weapons.level')}
        </label>
        <select
          id={`${id}-level`}
          value={owned.level}
          title={t('weapons.level')}
          onChange={(e) => onChange({ ...owned, level: Number(e.target.value) })}
          className="field w-16 shrink-0 py-0.5 text-xs"
        >
          {Array.from({ length: weapon.levels.length + 1 }, (_, n) => (
            <option key={n} value={n}>
              {t('weapons.levelShort', { n })}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('weapons.removeAria', { name: weapon.name })}
          title={t('weapons.remove')}
          className="shrink-0 rounded-md px-1.5 py-0.5 text-sm text-resist hover:bg-resist/10"
        >
          ×
        </button>
      </div>
      <PerkGrid owned={owned} weapon={weapon} onChange={onChange} />
      <ShapeEditor owned={owned} weapon={weapon} vocation={vocation} onChange={onChange} />
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
        <WeaponSearch vocation={vocation} meleeSkill={meleeSkill} owned={owned} onAdd={(w) => update((all) => [...all, ownWeapon(w)])} />
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
