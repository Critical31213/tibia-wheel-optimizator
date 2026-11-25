import type { GemQuality, ModDefinition, ModGrade, VesselAssignment, Vocation } from '../types';
import { useT } from '../i18n';
import { findMod, slotKind, slotsForQuality } from '../lib/gems';
import { cx, gemName, ROMAN } from '../lib/labels';

/** D106: gem sprite index of the planner (vocation × quality); bezels share it, empty sockets use 15 + quality. */
const VOC_ROW: Record<Vocation, number> = { knight: 0, paladin: 1, sorcerer: 2, druid: 3, monk: 4 };
const Q: Record<GemQuality, number> = { lesser: 0, regular: 1, greater: 2 };
const img = (f: string) => `${import.meta.env.BASE_URL}wheel/${f}.png`;

function Sprite({ file, frame, w, h, x, y, sheet }: { file: string; frame: number; w: number; h: number; x: number; y: number; sheet: number }) {
  return (
    <span
      aria-hidden="true"
      className="absolute bg-no-repeat [image-rendering:pixelated]"
      style={{ left: x, top: y, width: w, height: h, backgroundImage: `url("${img(file)}")`, backgroundPosition: `${-frame * w}px 0`, backgroundSize: `${sheet}px ${h}px` }}
    />
  );
}

function Socket({ vocation, v }: { vocation: Vocation; v: VesselAssignment }) {
  const gem = v.gem && v.source === 'owned' ? v.gem : null;
  const id = gem ? VOC_ROW[vocation] * 3 + Q[gem.quality] : 15 + Q[v.quality];
  return (
    <span className={cx('relative block size-11 shrink-0', !v.unlocked && 'opacity-45 grayscale')}>
      <Sprite file="backdrop-skillwheelsocket" frame={0} w={34} h={34} x={5} y={5} sheet={34} />
      <Sprite file="icons-skillwheel-sockets" frame={id} w={34} h={39} x={5} y={2.5} sheet={612} />
      {gem && <Sprite file="icons_socketgems" frame={VOC_ROW[vocation] * 3 + Q[gem.quality]} w={32} h={32} x={6} y={6} sheet={480} />}
    </span>
  );
}

/** Gems of the build's vessels as planner sockets; details on hover / focus. */
export function VesselGems({ vocation, vessels, mods }: { vocation: Vocation; vessels: VesselAssignment[]; mods: ModDefinition[] }) {
  const t = useT();
  return (
    <ul className="mt-2 flex flex-wrap justify-center gap-1" aria-label={t('wheel.gems')}>
      {vessels.map((v, i) => {
        const gem = v.gem && v.source === 'owned' ? v.gem : null;
        const title = v.domain ? t('vessels.domainVessel', { domain: t(`domain.${v.domain}`) }) : t('vessels.vesselN', { n: v.vesselId + 1 });
        const lines = gem
          ? slotsForQuality(gem.quality).flatMap((slot) => {
              const ref = gem[slot];
              if (!ref) return [];
              const name = findMod(mods, slotKind(slot), ref.modId)?.name ?? `#${ref.modId}`;
              const idle = v.idle?.some((x) => x.slot === slot);
              return [{ slot, text: `${name} ${ROMAN[ref.grade as ModGrade]}`, idle }];
            })
          : [];
        const status = !v.unlocked ? t('vessels.locked') : gem ? null : t('vessels.emptyAdd');
        return (
          <li key={v.vesselId} className="group/gem relative">
            <span tabIndex={0} aria-label={`${title}: ${gem ? `${gemName(vocation, gem.quality)} — ${lines.map((l) => l.text).join(', ')}` : status}`} className="block rounded outline-none focus-visible:ring-1 focus-visible:ring-gold-400">
              <Socket vocation={vocation} v={v} />
            </span>
            <span
              aria-hidden="true"
              className={cx(
                'pointer-events-none absolute bottom-full z-30 mb-1 hidden w-max max-w-60 rounded-md border border-gold-700 bg-ink-850/95 px-2 py-1.5 text-[11px] leading-snug shadow-lg shadow-black/60 group-focus-within/gem:block group-hover/gem:block',
                i < 2 ? 'left-0' : i >= vessels.length - 2 ? 'right-0' : 'left-1/2 -translate-x-1/2',
              )}
            >
              <span className="block font-semibold text-parchment-50">{gem ? gemName(vocation, gem.quality) : title}</span>
              {gem && <span className="block text-parchment-400">{title}</span>}
              {lines.map((l) => (
                <span key={l.slot} className={cx('block', l.idle ? 'text-amber-300' : 'text-parchment-200')}>
                  {l.text}
                  {l.idle && ` · ${t('vessels.idle')}`}
                </span>
              ))}
              {status && <span className={cx('block', v.unlocked ? 'text-amber-300' : 'text-parchment-400')}>{status}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
