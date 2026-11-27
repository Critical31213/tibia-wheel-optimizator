import type { MeleeSkill, Vocation } from '../types';
import { useT, type TFunction } from '../i18n';
import { consumableBonus, consumablesFor, getConsumable, type ConsumableDef } from '../data/consumables';
import { cx } from '../lib/labels';

/** D136: small flask (own drawing). */
export function FlaskIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path d="M9.5 3h5M10.5 3v5.2L5.6 17.4A2.4 2.4 0 0 0 7.7 21h8.6a2.4 2.4 0 0 0 2.1-3.6l-4.9-9.2V3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7.6 15h8.8l1.2 2.4a1.2 1.2 0 0 1-1 1.8H7.4a1.2 1.2 0 0 1-1-1.8z" fill="currentColor" opacity="0.85" />
    </svg>
  );
}

const MELEE = ['sword', 'axe', 'club', 'fist'] as const;

function effectText(t: TFunction, c: ConsumableDef): string {
  const entries = Object.entries(c.skills) as [string, number][];
  const melee = MELEE.every((s) => c.skills[s] !== undefined) ? c.skills.sword! : null;
  return entries
    .filter(([s]) => melee === null || !MELEE.includes(s as (typeof MELEE)[number]))
    .map(([s, v]) => `${v > 0 ? '+' : ''}${v} ${t(`skill.${s}` as 'skill.magic')}`)
    .concat(melee === null ? [] : [t('food.melee', { v: melee })])
    .join(', ');
}

interface Props {
  vocation: Vocation;
  meleeSkill: MeleeSkill | null;
  value: readonly string[];
  /** Potion pick, or null = clear the kind. */
  onChange: (kind: 'food' | 'potion', id: string | null) => void;
  /** D141: add / remove one food. */
  onToggleFood: (id: string) => void;
}

/** D136 / D141: skill foods (one per skill) and one potion; their skills are added to the character's. */
export function ConsumablesEditor({ vocation, meleeSkill, value, onChange, onToggleFood }: Props) {
  const t = useT();
  const list = consumablesFor(vocation);
  const b = consumableBonus(value, vocation, meleeSkill);
  const parts = [
    b.main && `${b.main > 0 ? '+' : ''}${b.main} ${t('food.main')}`,
    b.magic && `+${b.magic} ${t('skill.magic')}`,
    b.shielding && `${b.shielding > 0 ? '+' : ''}${b.shielding} ${t('skill.shielding')}`,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs text-parchment-300">{t('food.hint')}</p>
      {(['food', 'potion'] as const).map((kind) => {
        const chosen = value.filter((id) => getConsumable(id)?.kind === kind);
        const opts = list.filter((c) => c.kind === kind);
        if (!opts.length) return null;
        return (
          <fieldset key={kind} className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs uppercase tracking-wide text-parchment-400">{t(`food.${kind}`)}</legend>
            {kind === 'food' && <p className="-mt-1 text-[11px] text-parchment-500">{t('food.foodHint')}</p>}
            {[null, ...opts].map((c) => {
              const on = c ? chosen.includes(c.id) : !chosen.length;
              return (
                <button
                  key={c?.id ?? 'none'}
                  type="button"
                  aria-pressed={on}
                  onClick={() => (c && kind === 'food' ? onToggleFood(c.id) : onChange(kind, c?.id ?? null))}
                  className={cx('flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left', on ? 'border-gold-500 bg-gold-700/25' : 'border-ink-700 hover:border-gold-700')}
                >
                  <span className={cx('text-xs', on ? 'text-parchment-50' : 'text-parchment-300')}>{c ? c.name : t('food.none')}</span>
                  {c && <span className="text-[11px] text-parchment-400">{effectText(t, c)}</span>}
                </button>
              );
            })}
          </fieldset>
        );
      })}
      <p className="text-xs text-parchment-200" aria-live="polite">{parts.length ? t('food.total', { v: parts.join(', ') }) : t('food.totalNone')}</p>
      <p className="text-[11px] text-parchment-400">{t('food.note')}</p>
    </div>
  );
}
