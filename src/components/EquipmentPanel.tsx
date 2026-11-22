import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CharmResult, GearEffects, GearResult, MeleeSkill, OwnedWeapon, Vocation } from '../types';
import { CharmIcon, CharmsEditor } from './CharmsEditor';
import { useT, type TFunction } from '../i18n';
import {
  getImbuement,
  getItem,
  IMBUE_LEVELS,
  imbuementsFor,
  imbueLevelFor,
  itemsFor,
  itemAugments,
  maxTier,
  MAX_TIER,
  SLOT_ITEMS,
  TIER_EFFECT,
  tierChance,
  WEAPON_IMBUE_SLOTS,
  weaponImbuements,
  type EquipmentItem,
  type GearSlot,
  type ImbueDef,
  type ImbueLevel,
  type ImbueSlot,
} from '../data/equipment';
import { addPiece, isGearSet, MAX_PIECES, removePiece, updatePiece, type GearPrefs, type ImbueChoice } from '../lib/gear';
import { weaponImbueSlots, weaponMaxTier, type WeaponPrefs } from '../lib/weapons';
import type { Weapon } from '../lib/api';
import { cx } from '../lib/labels';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { OwnedWeapons } from './OwnedWeapons';
import { Panel } from './Panel';

type Slot = ImbueSlot;

/** Tibia paper doll; null cells (backpack, ammunition) are not modelled. */
const DOLL: readonly (Slot | null)[] = ['amulet', 'helmet', null, 'weapon', 'armor', 'offhand', 'ring', 'legs', null, null, 'boots', null];

const NOT_MODELLED = new Set(['momentum', 'transcendence']);

/** D93: paper-doll cell of the charms button (bottom left). */
const CHARM_CELL = 9;

// ---------------------------------------------------------------------------
// Labels

function imbueValueText(t: TFunction, d: ImbueDef, level: ImbueLevel): string {
  const v = d.values[level - 1];
  switch (d.group) {
    case 'skill':
      return `+${v} ${t(`skill.${d.skill!}`)}`;
    case 'protection':
      return `${v}% ${t(`element.${d.element!}`).toLowerCase()}`;
    case 'crit':
      return t('gear.critValue', { chance: v, extra: d.extra![level - 1] });
    case 'damage':
      return t('gear.conversionValue', { v, element: t(`element.${d.element!}`).toLowerCase() });
    default:
      return `${v}%`;
  }
}

function itemBonusText(t: TFunction, i: EquipmentItem): string {
  const b = i.bonus;
  const parts: string[] = [];
  for (const [s, v] of Object.entries(b?.skills ?? {})) parts.push(`${v > 0 ? '+' : ''}${v} ${t(`skill.${s}` as 'skill.magic')}`);
  for (const [e, v] of Object.entries(b?.elementMl ?? {})) parts.push(`+${v} ML ${t(`element.${e}` as 'element.fire').toLowerCase()}`);
  for (const [e, v] of Object.entries(b?.resist ?? {})) parts.push(`${t(`element.${e}` as 'element.fire').toLowerCase()} ${v > 0 ? '+' : ''}${v}%`);
  if (b?.lifeLeech) parts.push(t('gear.lifeLeech', { v: b.lifeLeech }));
  if (i.defense) parts.push(t('gear.defense', { v: i.defense }));
  // D97: augments (bonuses to one spell).
  for (const a of itemAugments(i.id)) parts.push(t(`gear.augment.${a.kind}`, { spell: a.spell, v: a.kind === 'cooldown' ? a.value : Math.round(a.value * 1000) / 10 }));
  return parts.join(', ');
}

const slotName = (t: TFunction, s: Slot) => t(`gear.slot.${s}`);

// ---------------------------------------------------------------------------
// Editors

function ItemPicker({ slot, vocation, onPick }: { slot: GearSlot; vocation: Vocation; onPick: (i: EquipmentItem) => void }) {
  const t = useT();
  const id = useId();
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query, 100).trim().toLowerCase();
  const all = useMemo(() => itemsFor(SLOT_ITEMS[slot], vocation), [slot, vocation]);
  const list = useMemo(() => (q ? all.filter((i) => i.name.toLowerCase().includes(q)) : all).slice(0, 60), [all, q]);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-q`} className="sr-only">{t('gear.search')}</label>
      <input id={`${id}-q`} type="search" autoComplete="off" spellCheck={false} placeholder={t('gear.search')} value={query} onChange={(e) => setQuery(e.target.value)} className="field py-1.5 text-sm" />
      <ul className="max-h-64 overflow-auto rounded-lg border border-ink-600 bg-ink-950/60 py-1" aria-label={t('gear.pick')}>
        {list.length === 0 && <li className="px-3 py-2 text-sm text-parchment-400">{t('gear.noItems')}</li>}
        {list.map((i) => {
          const bonus = itemBonusText(t, i);
          return (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => onPick(i)}
                className="flex w-full flex-col px-3 py-1 text-left text-sm text-parchment-200 hover:bg-gold-700/25"
              >
                <span className="flex w-full items-baseline justify-between gap-2">
                  <span className="truncate">{i.name}</span>
                  <span className="shrink-0 text-xs text-parchment-400">{t('weapons.minLevel', { n: i.minLevel })}</span>
                </span>
                {bonus && <span className="truncate text-xs text-parchment-400">{bonus}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TierSelect({ slot, max, value, onChange }: { slot: Slot; max: number; value: number; onChange: (n: number) => void }) {
  const t = useT();
  const id = useId();
  const effect = TIER_EFFECT[slot];
  if (!effect || max === 0) return null;
  return (
    <div className="flex items-center gap-2 text-xs">
      <label htmlFor={id} className="text-parchment-300">{t('gear.tier')}</label>
      <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))} className="field w-auto py-0.5 pr-7 text-xs">
        {Array.from({ length: max + 1 }, (_, n) => (
          <option key={n} value={n}>
            {n === 0 ? t('gear.tierNone') : `${n} · ${t(`gear.effect.${effect}`)} ${tierChance(effect, n)}%`}
          </option>
        ))}
      </select>
      {NOT_MODELLED.has(effect) && <span className="text-parchment-500">{t('gear.notModelled')}</span>}
    </div>
  );
}

function ImbueEditor({ slot, vocation, item, weapon, count, value, onChange }: { slot: Slot; vocation: Vocation; item?: EquipmentItem; weapon?: Weapon; count: number; value: readonly ImbueChoice[]; onChange: (v: ImbueChoice[]) => void }) {
  const t = useT();
  const id = useId();
  const options = useMemo(() => (weapon ? weaponImbuements(weapon, vocation) : imbuementsFor(slot, vocation, item)), [slot, vocation, item, weapon]);
  if (count === 0 || options.length === 0) return <p className="text-xs text-parchment-400">{t('gear.noImbueSlots')}</p>;
  const set = (k: number, c: ImbueChoice | null) => {
    const next = [...value];
    if (c) next[k] = c;
    else next.splice(k, 1);
    onChange(next.filter(Boolean));
  };
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-xs text-parchment-300">{t('gear.imbues')}</legend>
      {Array.from({ length: Math.min(count, value.length + 1) }, (_, k) => {
        const c = value[k];
        const d = c && (options.find((o) => o.id === c.id) ?? getImbuement(c.id));
        const taken = new Set(value.filter((_, j) => j !== k).map((x) => x.id));
        return (
          <div key={k} className="flex items-center gap-1.5">
            <label htmlFor={`${id}-${k}`} className="sr-only">{t('gear.imbueN', { n: k + 1 })}</label>
            <select
              id={`${id}-${k}`}
              value={c?.id ?? ''}
              onChange={(e) => {
                const o = options.find((x) => x.id === e.target.value);
                set(k, o ? { id: o.id, level: imbueLevelFor(o, c?.level ?? 3) } : null);
              }}
              className="field min-w-0 flex-1 py-0.5 text-xs"
            >
              <option value="">{t('gear.imbueNone')}</option>
              {options.filter((o) => !taken.has(o.id)).map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            {c && d && (
              <>
                <label htmlFor={`${id}-${k}-l`} className="sr-only">{t('gear.imbueLevel')}</label>
                <select id={`${id}-${k}-l`} value={c.level} onChange={(e) => set(k, { ...c, level: Number(e.target.value) as ImbueLevel })} className="field w-auto py-0.5 pr-7 text-xs">
                  {(d.levels ?? IMBUE_LEVELS).map((l) => (
                    <option key={l} value={l}>{`${t(`gear.level.${l}`)} (${imbueValueText(t, d, l)})`}</option>
                  ))}
                </select>
              </>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

/** D81: forge tier and imbuements of one owned weapon (its own limits); unset = the default below. */
function WeaponGearEditor({ owned, weapon, vocation, onChange }: { owned: OwnedWeapon; weapon: Weapon; vocation: Vocation; onChange: (o: OwnedWeapon) => void }) {
  const t = useT();
  const g = owned.gear ?? { tier: 0, imbues: [] };
  const set = (patch: Partial<typeof g>) => onChange({ ...owned, gear: { ...g, ...patch } });
  const max = weaponMaxTier(weapon);
  return (
    <div className="mt-2 flex flex-col gap-1.5 border-t border-ink-700 pt-2">
      <p className="text-xs text-parchment-400">{owned.gear ? t('gear.weaponOwnSet') : t('gear.weaponOwnDefault')}</p>
      {max > 0 ? <TierSelect slot="weapon" max={max} value={g.tier} onChange={(tier) => set({ tier })} /> : <p className="text-xs text-parchment-500">{t('gear.noTier')}</p>}
      <ImbueEditor slot="weapon" vocation={vocation} weapon={weapon} count={weaponImbueSlots(weapon)} value={g.imbues} onChange={(imbues) => set({ imbues })} />
      {owned.gear && (
        <button type="button" onClick={() => onChange({ ...owned, gear: undefined })} className="self-start text-xs text-gold-400 hover:underline">
          {t('gear.weaponReset')}
        </button>
      )}
    </div>
  );
}

interface EditorProps {
  slot: Slot;
  vocation: Vocation;
  gear: GearPrefs;
  weaponName: string | null;
  /** Index of the item the engine wears in this slot. */
  wornIndex: number | undefined;
  onGear: (f: (g: GearPrefs) => GearPrefs) => void;
  meleeSkill: MeleeSkill | null;
  weapons: WeaponPrefs;
  onWeapons: (f: (p: WeaponPrefs) => WeaponPrefs) => void;
  /** D78: taken off for a two-handed weapon. */
  off: boolean;
}

function SlotEditor({ slot, vocation, gear, weaponName, wornIndex, onGear, meleeSkill, weapons, onWeapons, off }: EditorProps) {
  const t = useT();
  if (slot === 'weapon') {
    const w = gear.weapon ?? { tier: 0, imbues: [] };
    const set = (patch: Partial<typeof w>) => onGear((g) => ({ ...g, weapon: { ...w, ...patch } }));
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-parchment-200">{weaponName ?? t('gear.weaponAuto')}</p>
        <OwnedWeapons vocation={vocation} meleeSkill={meleeSkill} prefs={weapons} onChange={onWeapons} gearEditor={(o, wp, change) => <WeaponGearEditor owned={o} weapon={wp} vocation={vocation} onChange={change} />} />
        <details className="rounded-lg border border-ink-600 p-2" open={weapons.weapons.length === 0}>
          <summary className="cursor-pointer text-xs text-parchment-300">{t('gear.weaponDefaultTitle')}</summary>
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-xs text-parchment-400">{gear.weapon ? t('gear.weaponSet') : t('gear.weaponDefault')}</p>
            <TierSelect slot="weapon" max={MAX_TIER} value={w.tier} onChange={(tier) => set({ tier })} />
            <ImbueEditor slot="weapon" vocation={vocation} count={WEAPON_IMBUE_SLOTS} value={w.imbues} onChange={(imbues) => set({ imbues })} />
            {gear.weapon && (
              <button type="button" onClick={() => onGear((g) => ({ ...g, weapon: null }))} className="self-start text-xs text-gold-400 hover:underline">
                {t('gear.weaponReset')}
              </button>
            )}
          </div>
        </details>
      </div>
    );
  }
  return (
    <>
      {off && <p className="mb-3 text-xs text-amber-300">{t('gear.offhandOff')}</p>}
      <OwnedPieces slot={slot} vocation={vocation} gear={gear} wornIndex={wornIndex} onGear={onGear} />
    </>
  );
}

function OwnedPieces({ slot, vocation, gear, wornIndex, onGear }: { slot: GearSlot; vocation: Vocation; gear: GearPrefs; wornIndex: number | undefined; onGear: EditorProps['onGear'] }) {
  const t = useT();
  const list = gear.pieces[slot] ?? [];
  const [adding, setAdding] = useState(list.length === 0);
  return (
    <div className="flex flex-col gap-3">
      {list.length > 1 && <p className="text-xs text-parchment-400">{t('gear.multiHint')}</p>}
      {list.length > 0 && (
        <ul className="flex flex-col gap-2">
          {list.map((piece, i) => {
            const item = getItem(piece.itemId);
            if (!item) return null;
            const bonus = itemBonusText(t, item);
            const worn = list.length > 1 && i === wornIndex;
            return (
              <li key={i} className={cx('flex flex-col gap-2 rounded-xl border p-2.5', worn ? 'border-gold-600 bg-gold-700/10' : 'border-ink-600 bg-ink-950/50')}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-parchment-100">
                      {item.name}
                      {worn && <span className="ml-2 rounded bg-gold-700/50 px-1 text-[10px] font-normal text-parchment-50 uppercase">{t('gear.worn')}</span>}
                    </p>
                    <p className="text-xs text-parchment-400">{[t('weapons.minLevel', { n: item.minLevel }), bonus].filter(Boolean).join(' · ')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onGear((g) => removePiece(g, slot, i))}
                    aria-label={t('gear.removeAria', { name: item.name })}
                    className="shrink-0 rounded-md px-1.5 py-0.5 text-sm text-resist hover:bg-resist/10"
                  >
                    ×
                  </button>
                </div>
                <TierSelect slot={slot} max={maxTier(item.class)} value={piece.tier ?? 0} onChange={(tier) => onGear((g) => updatePiece(g, slot, i, { tier }))} />
                <ImbueEditor slot={slot} vocation={vocation} item={item} count={item.imbuementSlots ?? 0} value={piece.imbues ?? []} onChange={(imbues) => onGear((g) => updatePiece(g, slot, i, { imbues }))} />
              </li>
            );
          })}
        </ul>
      )}
      {adding ? (
        <ItemPicker
          slot={slot}
          vocation={vocation}
          onPick={(item) => {
            onGear((g) => addPiece(g, slot, item));
            setAdding(false);
          }}
        />
      ) : (
        list.length < MAX_PIECES && (
          <button type="button" onClick={() => setAdding(true)} className="self-start rounded-md border border-dashed border-ink-500 px-2 py-1 text-xs text-gold-400 hover:border-gold-600">
            + {t('gear.add')}
          </button>
        )
      )}
    </div>
  );
}

/** Native modal dialog (focus trap, Esc, backdrop) around the slot editor. */
function Modal({ title, wide, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  // Removing the element on unmount closes it without a close event (no cleanup: StrictMode would close it).
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        'm-auto rounded-2xl border border-ink-600 bg-ink-900 p-0 text-parchment-100 shadow-xl shadow-black/60 backdrop:bg-black/60',
        wide ? 'w-[min(40rem,calc(100vw-2rem))]' : 'w-[min(28rem,calc(100vw-2rem))]',
      )}
    >
      <div className="p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 id={id} className="section-title">{title}</h3>
        <button type="button" onClick={onClose} aria-label={t('gear.close')} className="rounded px-2 text-parchment-400 hover:text-parchment-100">×</button>
      </div>
      {children}
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Paper doll

interface SlotButtonProps {
  slot: Slot;
  gear: GearPrefs;
  weaponName: string | null;
  wornIndex: number | undefined;
  /** Owned weapons (weapon slot). */
  weaponCount: number;
  off: boolean;
  active: boolean;
  onClick: () => void;
}

function SlotButton({ slot, gear, weaponName, wornIndex, weaponCount, off, active, onClick }: SlotButtonProps) {
  const t = useT();
  const list = slot === 'weapon' ? [] : (gear.pieces[slot] ?? []);
  const piece = slot === 'weapon' ? gear.weapon : list[wornIndex ?? 0];
  const name = slot === 'weapon' ? weaponName : piece && 'itemId' in piece ? (getItem(piece.itemId)?.name ?? null) : null;
  const set = slot === 'weapon' ? gear.weapon !== null || weaponCount > 0 : list.length > 0;
  const count = slot === 'weapon' ? weaponCount : list.length;
  const tier = piece?.tier ?? 0;
  const imbues = piece?.imbues?.length ?? 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      aria-label={`${slotName(t, slot)}: ${name ?? t('gear.empty')}${off ? ` (${t('gear.offhandOffShort')})` : ''}`}
      title={off ? t('gear.offhandOff') : undefined}
      className={cx(
        'relative flex aspect-square min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg border p-1 text-center',
        active
          ? 'border-gold-400 bg-gold-700/25'
          : off
            ? 'border-dashed border-resist/80 bg-resist/10 hover:border-resist'
            : set
              ? 'border-gold-700/70 bg-ink-950/70 hover:border-gold-500'
              : 'border-dashed border-ink-500 bg-ink-950/40 hover:border-gold-600',
      )}
    >
      {/* D78: a two-handed weapon takes the off-hand off — crossed out, dimmed and labelled. */}
      {off && (
        <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full text-resist/70">
          <line x1="8" y1="8" x2="92" y2="92" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" />
          <line x1="92" y1="8" x2="8" y2="92" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <span className="text-[10px] uppercase tracking-wide text-parchment-400">{slotName(t, slot)}</span>
      <span className={cx('line-clamp-2 text-[11px] leading-tight', off ? 'text-parchment-400 line-through opacity-70' : name ? 'text-parchment-100' : 'text-parchment-500')}>
        {name ?? (slot === 'weapon' ? t('gear.weaponAutoShort') : '—')}
      </span>
      {off && (
        <span className="absolute inset-x-1 bottom-1 rounded bg-resist px-1 text-[9px] font-semibold tracking-wide text-ink-950 uppercase">
          {t('gear.offhandOffShort')}
        </span>
      )}
      {tier > 0 && <span className="absolute right-1 top-1 rounded bg-gold-700/60 px-1 text-[10px] text-parchment-50">T{tier}</span>}
      {count > 1 && <span className="absolute left-1 top-1 rounded bg-ink-700 px-1 text-[10px] text-parchment-200" title={t('gear.ownedCount', { n: count })}>{count}</span>}
      {imbues > 0 && !off && (
        <span className="absolute bottom-1 flex gap-0.5" aria-hidden="true">
          {Array.from({ length: imbues }, (_, k) => <span key={k} className="size-1.5 rounded-full bg-gold-400" />)}
        </span>
      )}
    </button>
  );
}

function Totals({ fx, set }: { fx: GearEffects | undefined; set: boolean }) {
  const t = useT();
  if (!set) return <p className="text-xs text-parchment-400">{t('gear.hint')}</p>;
  if (!fx) return null;
  const chips: string[] = [];
  const s = fx.skills;
  if (s.main) chips.push(`+${s.main} ${t('gear.mainSkill')}`);
  if (s.magic) chips.push(`+${s.magic} ${t('skill.magic')}`);
  if (s.shielding) chips.push(`+${s.shielding} ${t('skill.shielding')}`);
  for (const [e, v] of Object.entries(fx.elementMl)) if (v) chips.push(`+${v} ML ${t(`element.${e}` as 'element.fire').toLowerCase()}`);
  for (const [e, v] of Object.entries(fx.resist)) if (v) chips.push(`${t(`element.${e}` as 'element.fire').toLowerCase()} ${v > 0 ? '+' : ''}${+v.toFixed(1)}%`);
  if (fx.onslaught) chips.push(`${t('gear.effect.onslaught')} ${fx.onslaught.toFixed(2)}%`);
  if (fx.ruse) chips.push(`${t('gear.effect.ruse')} ${fx.ruse.toFixed(2)}%`);
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-parchment-300">{t('gear.totals')}</p>
      {chips.length ? (
        <ul className="flex flex-wrap gap-1">
          {chips.map((c) => <li key={c} className="rounded-md border border-ink-600 bg-ink-950/60 px-1.5 py-0.5 text-xs text-parchment-200">{c}</li>)}
        </ul>
      ) : (
        <p className="text-xs text-parchment-400">{t('gear.totalsNone')}</p>
      )}
      <p className="text-[11px] text-parchment-500">{t('gear.baseSkills')}</p>
    </div>
  );
}

export interface EquipmentPanelProps {
  vocation: Vocation;
  meleeSkill: MeleeSkill | null;
  gear: GearPrefs;
  onGear: (f: (g: GearPrefs) => GearPrefs) => void;
  /** Equipment the engine wore for the shown build. */
  worn: GearResult | undefined;
  /** The weapon the optimizer picked, if any. */
  weaponName: string | null;
  weapons: WeaponPrefs;
  onWeapons: (f: (p: WeaponPrefs) => WeaponPrefs) => void;
  /** D93: charms the engine assigned for the shown build. */
  charmPicks?: CharmResult[];
}

/** D74: equipment as a Tibia paper doll; a slot opens its editor in a window (the weapon slot: owned weapons with proficiency). */
export function EquipmentPanel({ vocation, meleeSkill, gear, onGear, worn, weaponName, weapons, onWeapons, charmPicks }: EquipmentPanelProps) {
  const t = useT();
  const [editing, setEditing] = useState<Slot | 'charms' | null>(null);
  const close = () => setEditing(null);
  // The shown build may lag behind edits: a worn index past the list falls back to the first item.
  const wornIndex = (s: Slot) => {
    const i = s === 'weapon' ? undefined : worn?.worn[s];
    return i !== undefined && s !== 'weapon' && i < (gear.pieces[s]?.length ?? 0) ? i : undefined;
  };
  return (
    <Panel title={t('gear.title')} step={6} headingId="gear-heading">
      <div className="flex flex-col gap-3">
        <div className="mx-auto grid w-full max-w-64 grid-cols-3 gap-1.5">
          {DOLL.map((s, k) =>
            s ? (
              <SlotButton key={s} slot={s} gear={gear} weaponName={weaponName} wornIndex={wornIndex(s)} weaponCount={weapons.weapons.length} off={s === 'offhand' && !!worn?.offhandOff} active={editing === s} onClick={() => setEditing(editing === s ? null : s)} />
            ) : k === CHARM_CELL ? (
              <button
                key="charms"
                type="button"
                onClick={() => setEditing(editing === 'charms' ? null : 'charms')}
                aria-expanded={editing === 'charms'}
                aria-label={t('charm.button', { n: gear.charms.length })}
                title={t('charm.title')}
                className={cx(
                  'relative flex aspect-square min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg border p-1',
                  editing === 'charms' ? 'border-gold-400 bg-gold-700/25' : gear.charms.length ? 'border-gold-700/70 bg-ink-950/70 hover:border-gold-500' : 'border-dashed border-ink-500 bg-ink-950/40 hover:border-gold-600',
                )}
              >
                <CharmIcon className={cx('size-6', gear.charms.length ? 'text-gold-300' : 'text-parchment-500')} />
                <span className="text-[10px] uppercase tracking-wide text-parchment-400">{t('charm.title')}</span>
                {gear.charms.length > 0 && <span className="absolute left-1 top-1 rounded bg-ink-700 px-1 text-[10px] text-parchment-200">{gear.charms.length}</span>}
              </button>
            ) : (
              <span key={k} aria-hidden="true" className={cx('aspect-square rounded-lg', k !== 11 && 'border border-ink-700/60 bg-ink-950/20')} />
            ),
          )}
        </div>
        {editing === 'charms' && (
          <Modal title={t('charm.title')} onClose={close}>
            <CharmsEditor value={gear.charms} onChange={(charms) => onGear((g) => ({ ...g, charms }))} picks={charmPicks} />
          </Modal>
        )}
        {editing && editing !== 'charms' && (
          <Modal title={slotName(t, editing)} wide={editing === 'weapon'} onClose={close}>
            <SlotEditor
              key={editing}
              slot={editing}
              vocation={vocation}
              gear={gear}
              weaponName={weaponName}
              wornIndex={wornIndex(editing)}
              onGear={onGear}
              meleeSkill={meleeSkill}
              weapons={weapons}
              onWeapons={onWeapons}
              off={editing === 'offhand' && !!worn?.offhandOff}
            />
          </Modal>
        )}
        <Totals fx={worn?.effects} set={isGearSet(gear)} />
      </div>
    </Panel>
  );
}
