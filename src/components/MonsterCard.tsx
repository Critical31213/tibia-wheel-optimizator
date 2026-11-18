import { ATTACK_ELEMENTS } from '../types';
import type { Element, Monster } from '../types';
import { useT } from '../i18n';
import { cx, ELEMENT_COLORS, formatNumber, modifierKind } from '../lib/labels';
import type { ModifierKind } from '../lib/labels';

const CHIP: Record<ModifierKind, string> = {
  weakness: 'border-weak/50 bg-weak/10 text-weak',
  resistance: 'border-resist/50 bg-resist/10 text-resist',
  immune: 'border-immune/50 bg-immune/10 text-immune line-through',
  neutral: 'border-ink-600 bg-ink-950/50 text-parchment-300',
};

function ElementChip({ element, kind, percent }: { element: Element; kind: ModifierKind; percent?: number }) {
  const t = useT();
  const name = t(`element.${element}`);
  return (
    <li
      className={cx('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs', CHIP[kind])}
      title={percent !== undefined ? t('card.chipTitle', { element: name, percent, kind: t(`modifier.${kind}`) }) : undefined}
    >
      <span aria-hidden="true" className="size-2 rounded-full" style={{ background: ELEMENT_COLORS[element] }} />
      {name}
      {percent !== undefined && <span className="tabular-nums opacity-80">{percent}%</span>}
    </li>
  );
}

/** Summary of the selected monster: stats, element modifiers, damage types. */
export function MonsterCard({ monster }: { monster: Monster }) {
  const t = useT();
  const mods = ATTACK_ELEMENTS.map((element) => {
    const percent = monster.elementModifiers[element] ?? 100;
    return { element, percent, kind: modifierKind(percent) };
  })
    .filter((m) => m.kind !== 'neutral')
    .sort((a, b) => b.percent - a.percent);

  return (
    <div className="rounded-xl border border-ink-600 bg-ink-950/50 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-base text-parchment-50">{monster.name}</h3>
        {monster.sourceUrl && (
          <a href={monster.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-gold-400 hover:underline">
            {t('card.source')}
          </a>
        )}
      </div>
      <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-parchment-300">
        {monster.hitpoints !== undefined && (
          <div>
            <dt className="inline">{t('card.hp')} </dt>
            <dd className="inline tabular-nums text-parchment-100">{formatNumber(monster.hitpoints)}</dd>
          </div>
        )}
        {monster.experience !== undefined && (
          <div>
            <dt className="inline">{t('card.exp')} </dt>
            <dd className="inline tabular-nums text-parchment-100">{formatNumber(monster.experience)}</dd>
          </div>
        )}
        {monster.maxDamage !== undefined && (
          <div>
            <dt className="inline">{t('card.maxDmg')} </dt>
            <dd className="inline tabular-nums text-parchment-100">{formatNumber(monster.maxDamage)}</dd>
          </div>
        )}
      </dl>

      <p className="mt-3 mb-1 text-xs text-parchment-400">{t('card.takes')}</p>
      {mods.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('card.modifiers')}>
          {mods.map((m) => (
            <ElementChip key={m.element} element={m.element} kind={m.kind} percent={m.percent} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-parchment-300">{t('card.neutral')}</p>
      )}

      {monster.damageTypes.length > 0 && (
        <>
          <p className="mt-3 mb-1 text-xs text-parchment-400">{t('card.deals')}</p>
          <ul className="flex flex-wrap gap-1.5" aria-label={t('card.dealsList')}>
            {monster.damageTypes.map((el) => (
              <ElementChip key={el} element={el} kind="neutral" />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
