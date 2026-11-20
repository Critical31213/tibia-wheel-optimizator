/** D47: owned weapons (proficiency) — storage, editing helpers and perk labels. No React here. */
import type { OwnedWeapon, ShapedSlot, Vocation } from '../types';
import { getShapingOption, getWeapon, type Perk, type ShapingOption, type Weapon } from '../data/proficiency';
import { maxTier, WEAPON_IMBUE_SLOTS, weaponImbuements } from '../data/equipment';
import { sanitizeImbues } from './gear';
import type { MessageKey, TFunction } from '../i18n';

/** In the game a weapon has at most two reshaped slots. */
export const MAX_SHAPED = 2;

export interface WeaponPrefs {
  weapons: OwnedWeapon[];
  /** Also look for better weapons the player does not own. */
  suggest: boolean;
}

export const EMPTY_WEAPON_PREFS: WeaponPrefs = { weapons: [], suggest: false };

export const weaponsStorageKey = (vocation: Vocation): string => `wheel-optimizer:weapons:v1:${vocation}`;

const int = (x: unknown, min: number, max: number): number | null =>
  typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max ? x : null;

/** Drops unknown weapons, other vocations' weapons, out-of-range levels / perks and invalid reshapes. */
export function sanitizeWeapon(raw: unknown, vocation: Vocation): OwnedWeapon | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<OwnedWeapon>;
  const w = typeof r.weaponId === 'string' ? getWeapon(r.weaponId) : undefined;
  if (!w || !w.vocations.includes(vocation)) return null;
  const level = int(r.level, 0, w.levels.length) ?? 0;
  const perks = Array.isArray(r.perks) ? w.levels.map((l, i) => int(r.perks![i], 0, l.length - 1)) : [];
  const shaped: ShapedSlot[] = [];
  for (const s of Array.isArray(r.shaped) ? r.shaped : []) {
    const L = int(s?.level, 1, w.levels.length);
    if (L === null || shaped.length >= MAX_SHAPED || shaped.some((x) => x.level === L)) continue;
    const replaces = int(s.replaces, 0, w.levels[L - 1].length - 1);
    if (replaces !== null && typeof s.option === 'string' && getShapingOption(s.option)) shaped.push({ level: L, replaces, option: s.option });
  }
  const g = r.gear && typeof r.gear === 'object' ? r.gear : null;
  const gear = g
    ? { tier: int(g.tier, 0, weaponMaxTier(w)) ?? 0, imbues: sanitizeImbues(g.imbues, 'weapon', vocation, weaponImbueSlots(w), undefined, weaponImbuements(w, vocation)) }
    : null;
  return {
    weaponId: w.id,
    level,
    ...(perks.some((p) => p !== null) ? { perks } : {}),
    ...(shaped.length ? { shaped } : {}),
    ...(gear ? { gear } : {}),
  };
}

/** D81: forge tier limit and imbuement slots of a weapon. */
export const weaponMaxTier = (w: Weapon): number => maxTier(w.class);
export const weaponImbueSlots = (w: Weapon): number => w.imbuementSlots ?? WEAPON_IMBUE_SLOTS;

export function parseWeaponPrefs(json: string | null, vocation: Vocation): WeaponPrefs {
  if (!json) return EMPTY_WEAPON_PREFS;
  try {
    const raw = JSON.parse(json) as Partial<WeaponPrefs>;
    const seen = new Set<string>();
    const weapons: OwnedWeapon[] = [];
    for (const x of Array.isArray(raw.weapons) ? raw.weapons : []) {
      const w = sanitizeWeapon(x, vocation);
      if (!w || seen.has(w.weaponId)) continue;
      seen.add(w.weaponId);
      weapons.push(w);
    }
    return { weapons, suggest: raw.suggest === true };
  } catch {
    return EMPTY_WEAPON_PREFS;
  }
}

export const serializeWeaponPrefs = (p: WeaponPrefs): string => JSON.stringify(p);

/** New owned weapon: all proficiency levels reached, perks picked by the engine. */
export const ownWeapon = (w: Weapon): OwnedWeapon => ({ weaponId: w.id, level: w.levels.length });

export function setPerk(o: OwnedWeapon, level: number, choice: number | null): OwnedWeapon {
  const w = getWeapon(o.weaponId);
  if (!w) return o;
  const perks = w.levels.map((_, i) => (i === level ? choice : o.perks?.[i] ?? null));
  const { perks: _old, ...rest } = o;
  return perks.some((p) => p !== null) ? { ...rest, perks } : rest;
}

/** Sets (or with `option` null removes) the reshape of a level (1-based). */
export function setShaped(o: OwnedWeapon, level: number, option: string | null, replaces = 0): OwnedWeapon {
  const others = (o.shaped ?? []).filter((s) => s.level !== level);
  const shaped = option ? [...others, { level, replaces, option }].sort((a, b) => a.level - b.level) : others;
  const { shaped: _old, ...rest } = o;
  return shaped.length ? { ...rest, shaped } : rest;
}

// ---------------------------------------------------------------------------
// Labels

const PERCENT_KINDS = new Set<Perk['kind']>([
  'bestiary', 'boss', 'critChance', 'elementCritChance', 'runeCritChance', 'autoCritChance', 'critDamage', 'elementCritDamage',
  'runeCritDamage', 'autoCritDamage', 'manaLeech', 'lifeLeech', 'hitChance', 'autoSkillScaling', 'spellSkillScaling',
  'healSkillScaling', 'alphaStrike', 'omegaStrike', 'armorPenetration', 'pierce', 'homingMissile',
]);

const num = (x: number) => String(Math.round(x * 100) / 100);

/** Value as shown: percent kinds ×100, augment cooldown as positive seconds. */
function shownValue(p: Pick<Perk, 'kind' | 'augment'>, value: number): string {
  if (p.kind === 'augment') return num(p.augment === 'cooldown' ? -value : value * 100);
  return num(PERCENT_KINDS.has(p.kind) ? value * 100 : value);
}

function vars(t: TFunction, p: Omit<Perk, 'value'>, v: string) {
  const skill = p.skill ? t(`skill.${p.skill}` as MessageKey) : t('skill.highest');
  const element = p.element ? t(`element.${p.element}` as MessageKey).toLowerCase() : '';
  return { v, skill, element, class: p.bestiary ?? '', spell: p.spell ?? '', range: p.range ?? 0, mult: p.levelMultiplier ?? 0 };
}

export function perkLabel(t: TFunction, p: Perk): string {
  const v = shownValue(p, p.value);
  if (p.kind === 'augment') return `${p.spell}: ${t(`perk.aug.${p.augment}` as MessageKey, { v })}`;
  return t(`perk.${p.kind}` as MessageKey, vars(t, p, v));
}

/** Shaping option label with its rank 0 → 10 range. */
export function shapingLabel(t: TFunction, o: ShapingOption, rank?: number): string {
  const value = rank === undefined ? null : o.rank0 + ((o.rank10 - o.rank0) * rank) / 10;
  const v = value === null ? `${shownValue(o, o.rank0)}–${shownValue(o, o.rank10)}` : shownValue(o, value);
  if (o.kind === 'augment') return `${o.spell}: ${t(`perk.aug.${o.augment}` as MessageKey, { v })}`;
  return t(`perk.${o.kind}` as MessageKey, vars(t, o, v));
}
