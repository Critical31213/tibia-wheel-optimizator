import { perkIcon, type PerkIcon as Icon, type WeaponPerk } from '../lib/api';

const url = (file: string) => `${import.meta.env.BASE_URL}proficiency/${file}`;

function Sprite({ icon, size }: { icon: Icon; size: number }) {
  return (
    <span
      aria-hidden="true"
      className="block bg-no-repeat [image-rendering:pixelated]"
      style={{
        width: size,
        height: size,
        backgroundImage: `url("${url(icon.file)}")`,
        backgroundSize: `${icon.frames * size}px ${size}px`,
        backgroundPosition: `${-icon.frame * size}px 0`,
      }}
    />
  );
}

/** D50: official perk icon (CipSoft graphics); spell augments get the augment mark in the corner. Decorative. */
export function PerkIcon({ perk, size = 32 }: { perk: Omit<WeaponPerk, 'value'>; size?: number }) {
  const { base, overlay } = perkIcon(perk);
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {base && <Sprite icon={base} size={size} />}
      {overlay && (
        <span className="absolute -bottom-0.5 -right-0.5">
          <Sprite icon={overlay} size={Math.round(size / 2)} />
        </span>
      )}
    </span>
  );
}
