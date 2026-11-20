import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { GearEffects, GearResult, MeleeSkill, Vocation } from '../types';
import { useT, type TFunction } from '../i18n';
import {
  getImbuement,
  getItem,
  IMBUE_LEVELS,
  imbuementsFor,
  itemsFor,
  maxTier,
  MAX_TIER,
  SLOT_ITEMS,
  TIER_EFFECT,
  tierChance,
  WEAPON_IMBUE_SLOTS,
  type EquipmentItem,
  type GearSlot,
  type ImbueDef,
  type ImbueLevel,
  type ImbueSlot,
} from '../data/equipment';
import { addPiece, isGearSet, MAX_PIECES, removePiece, updatePiece, type GearPrefs, type ImbueChoice } from '../lib/gear';
import type { WeaponPrefs } from '../lib/weapons';
import type { DesignVariants } from '../hooks/useDesignVariants';
import { cx } from '../lib/labels';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { OwnedWeapons } from './OwnedWeapons';
import { Panel } from './Panel';
import { SegmentedControl } from './SegmentedControl';

type Slot = ImbueSlot;

/** Tibia paper doll; null cells (backpack, ammunition) are not modelled. */
const DOLL: readonly (Slot | null)[] = ['amulet', 'helmet', null, 'weapon', 'armor', 'offhand', 'ring', 'legs', null, null, 'boots', null];

const NOT_MODELLED = new Set(['momentum', 'transcendence']);

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

function ImbueEditor({ slot, vocation, count, value, onChange }: { slot: Slot; vocation: Vocation; count: number; value: readonly ImbueChoice[]; onChange: (v: ImbueChoice[]) => void }) {
  const t = useT();
  const id = useId();
  const options = useMemo(() => imbuementsFor(slot, vocation), [slot, vocation]);
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
        const d = c && getImbuement(c.id);
        const taken = new Set(value.filter((_, j) => j !== k).map((x) => x.id));
        return (
          <div key={k} className="flex items-center gap-1.5">
            <label htmlFor={`${id}-${k}`} className="sr-only">{t('gear.imbueN', { n: k + 1 })}</label>
            <select
              id={`${id}-${k}`}
              value={c?.id ?? ''}
              onChange={(e) => set(k, e.target.value ? { id: e.target.value, level: c?.level ?? 3 } : null)}
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
                  {IMBUE_LEVELS.map((l) => (
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

interface EditorProps {
  slot: Slot;
  vocation: Vocation;
  gear: GearPrefs;
  weaponName: string | null;
  /** Index of the item the engine wears in this slot. */
  wornIndex: number | undefined;
  onGear: (f: (g: GearPrefs) => GearPrefs) => void;
}

function SlotEditor({ slot, vocation, gear, weaponName, wornIndex, onGear }: EditorProps) {
  const t = useT();
  if (slot === 'weapon') {
    const w = gear.weapon ?? { tier: 0, imbues: [] };
    const set = (patch: Partial<typeof w>) => onGear((g) => ({ ...g, weapon: { ...w, ...patch } }));
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-parchment-200">{weaponName ?? t('gear.weaponAuto')}</p>
        <p className="text-xs text-parchment-400">{gear.weapon ? t('gear.weaponSet') : t('gear.weaponDefault')}</p>
        <TierSelect slot="weapon" max={MAX_TIER} value={w.tier} onChange={(tier) => set({ tier })} />
        <ImbueEditor slot="weapon" vocation={vocation} count={WEAPON_IMBUE_SLOTS} value={w.imbues} onChange={(imbues) => set({ imbues })} />
        {gear.weapon && (
          <button type="button" onClick={() => onGear((g) => ({ ...g, weapon: null }))} className="self-start text-xs text-gold-400 hover:underline">
            {t('gear.weaponReset')}
          </button>
        )}
      </div>
    );
  }
  return <OwnedPieces slot={slot} vocation={vocation} gear={gear} wornIndex={wornIndex} onGear={onGear} />;
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
                <ImbueEditor slot={slot} vocation={vocation} count={item.imbuementSlots ?? 0} value={piece.imbues ?? []} onChange={(imbues) => onGear((g) => updatePiece(g, slot, i, { imbues }))} />
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
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
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
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-ink-600 bg-ink-900 p-0 text-parchment-100 shadow-xl shadow-black/60 backdrop:bg-black/60"
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
  active: boolean;
  onClick: () => void;
}

function SlotButton({ slot, gear, weaponName, wornIndex, active, onClick }: SlotButtonProps) {
  const t = useT();
  const list = slot === 'weapon' ? [] : (gear.pieces[slot] ?? []);
  const piece = slot === 'weapon' ? gear.weapon : list[wornIndex ?? 0];
  const name = slot === 'weapon' ? weaponName : piece && 'itemId' in piece ? (getItem(piece.itemId)?.name ?? null) : null;
  const set = slot === 'weapon' ? gear.weapon !== null : list.length > 0;
  const tier = piece?.tier ?? 0;
  const imbues = piece?.imbues?.length ?? 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      aria-label={`${slotName(t, slot)}: ${name ?? t('gear.empty')}`}
      className={cx(
        'relative flex aspect-square min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg border p-1 text-center',
        active ? 'border-gold-400 bg-gold-700/25' : set ? 'border-gold-700/70 bg-ink-950/70 hover:border-gold-500' : 'border-dashed border-ink-500 bg-ink-950/40 hover:border-gold-600',
      )}
    >
      <span className="text-[10px] uppercase tracking-wide text-parchment-400">{slotName(t, slot)}</span>
      <span className={cx('line-clamp-2 text-[11px] leading-tight', name ? 'text-parchment-100' : 'text-parchment-500')}>
        {name ?? (slot === 'weapon' ? t('gear.weaponAutoShort') : '—')}
      </span>
      {tier > 0 && <span className="absolute right-1 top-1 rounded bg-gold-700/60 px-1 text-[10px] text-parchment-50">T{tier}</span>}
      {list.length > 1 && <span className="absolute left-1 top-1 rounded bg-ink-700 px-1 text-[10px] text-parchment-200" title={t('gear.ownedCount', { n: list.length })}>{list.length}</span>}
      {imbues > 0 && (
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
  for (const [e, v] of Object.entries(fx.resist)) if (v) chips.push(`${t(`element.${e}` as 'element.fire').toLowerCase()} ${v > 0 ? '+' : ''}${v}%`);
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

/** D74 (temporary): switch between the design variants under review. */
function VariantSwitch({ value, onChange }: { value: DesignVariants; onChange: (p: Partial<DesignVariants>) => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-gold-700/60 p-2 text-xs">
      <p className="text-gold-400">{t('gear.variants')}</p>
      <div className="flex items-center justify-between gap-2">
        <span className="text-parchment-300">{t('gear.variant.fallback')}</span>
        <SegmentedControl size="sm" label={t('gear.variant.fallback')} value={value.fallback} onChange={(fallback) => onChange({ fallback })}
          options={[{ value: 'slot', label: t('gear.variant.slot') }, { value: 'all', label: t('gear.variant.all') }]} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-parchment-300">{t('gear.variant.picker')}</span>
        <SegmentedControl size="sm" label={t('gear.variant.picker')} value={value.picker} onChange={(picker) => onChange({ picker })}
          options={[{ value: 'modal', label: t('gear.variant.modal') }, { value: 'inline', label: t('gear.variant.inline') }]} />
      </div>
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
  variants: DesignVariants;
  onVariants: (p: Partial<DesignVariants>) => void;
}

/** D74: equipment as a Tibia paper doll; a slot opens its item, tier and imbuement editor. Owned weapons below. */
export function EquipmentPanel({ vocation, meleeSkill, gear, onGear, worn, weaponName, weapons, onWeapons, variants, onVariants }: EquipmentPanelProps) {
  const t = useT();
  const [editing, setEditing] = useState<Slot | null>(null);
  const close = () => setEditing(null);
  // The shown build may lag behind edits: a worn index past the list falls back to the first item.
  const wornIndex = (s: Slot) => {
    const i = s === 'weapon' ? undefined : worn?.worn[s];
    return i !== undefined && s !== 'weapon' && i < (gear.pieces[s]?.length ?? 0) ? i : undefined;
  };
  const editor = editing && <SlotEditor key={editing} slot={editing} vocation={vocation} gear={gear} weaponName={weaponName} wornIndex={wornIndex(editing)} onGear={onGear} />;
  return (
    <Panel title={t('gear.title')} step={6} headingId="gear-heading">
      <div className="flex flex-col gap-3">
        <div className="mx-auto grid w-full max-w-64 grid-cols-3 gap-1.5">
          {DOLL.map((s, k) =>
            s ? (
              <SlotButton key={s} slot={s} gear={gear} weaponName={weaponName} wornIndex={wornIndex(s)} active={editing === s} onClick={() => setEditing(editing === s ? null : s)} />
            ) : (
              <span key={k} aria-hidden="true" className={cx('aspect-square rounded-lg', k !== 9 && k !== 11 && 'border border-ink-700/60 bg-ink-950/20')} />
            ),
          )}
        </div>
        {editing && variants.picker === 'modal' && <Modal title={slotName(t, editing)} onClose={close}>{editor}</Modal>}
        {editing && variants.picker === 'inline' && (
          <section aria-label={slotName(t, editing)} className="rounded-xl border border-gold-700/50 bg-ink-950/50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="section-title">{slotName(t, editing)}</h3>
              <button type="button" onClick={close} aria-label={t('gear.close')} className="rounded px-2 text-parchment-400 hover:text-parchment-100">×</button>
            </div>
            {editor}
          </section>
        )}
        <Totals fx={worn?.effects} set={isGearSet(gear)} />
        <VariantSwitch value={variants} onChange={onVariants} />
        <OwnedWeapons key={vocation} vocation={vocation} meleeSkill={meleeSkill} prefs={weapons} onChange={onWeapons} />
      </div>
    </Panel>
  );
}
