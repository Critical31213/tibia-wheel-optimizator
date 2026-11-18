/** Display labels and colours shared by UI components (no React here). */
import type { Domain, Element, GemQuality, ModGrade, PerkCategory, Vocation } from '../types';
import { en } from '../i18n/en';
import type { MessageKey } from '../i18n/en';

export const VOCATION_LABELS: Record<Vocation, string> = {
  knight: 'Knight',
  paladin: 'Paladin',
  sorcerer: 'Sorcerer',
  druid: 'Druid',
  monk: 'Monk',
};

export const VOCATION_BLURBS: Record<Vocation, string> = {
  knight: 'Melee tank',
  paladin: 'Ranged hybrid',
  sorcerer: 'Elemental mage',
  druid: 'Healer mage',
  monk: 'Martial artist',
};

/** Ordered clockwise starting at 12 o'clock, like the in-game wheel. */
export const DOMAINS: readonly Domain[] = ['topRight', 'bottomRight', 'bottomLeft', 'topLeft'];

export const DOMAIN_LABELS: Record<Domain, string> = {
  topLeft: 'Top-left',
  topRight: 'Top-right',
  bottomLeft: 'Bottom-left',
  bottomRight: 'Bottom-right',
};

/** Tibia-like domain tints. `base` fills allocated points, `dim` is the empty slot. */
export const DOMAIN_COLORS: Record<Domain, { base: string; dim: string; text: string }> = {
  topLeft: { base: '#4fa65a', dim: '#1f3322', text: '#8fd89a' },
  topRight: { base: '#c2483d', dim: '#3a1d1a', text: '#f2958c' },
  bottomLeft: { base: '#8e5bc4', dim: '#2b2038', text: '#c9a6ef' },
  bottomRight: { base: '#3f7fc8', dim: '#1a2738', text: '#94bff0' },
};

export const ELEMENT_LABELS: Record<Element, string> = {
  physical: 'Physical',
  fire: 'Fire',
  earth: 'Earth',
  energy: 'Energy',
  ice: 'Ice',
  holy: 'Holy',
  death: 'Death',
  lifeDrain: 'Life drain',
  manaDrain: 'Mana drain',
  drown: 'Drown',
  healing: 'Healing',
};

/** Swatch colour per element (used as a small dot next to the label). */
export const ELEMENT_COLORS: Record<Element, string> = {
  physical: '#b8a58a',
  fire: '#f07a2a',
  earth: '#7cbf4a',
  energy: '#b07cf2',
  ice: '#6fd3f0',
  holy: '#f3d36b',
  death: '#8c7aa8',
  lifeDrain: '#e05a7a',
  manaDrain: '#5a8ae0',
  drown: '#3fb5a6',
  healing: '#b7e070',
};

export const CATEGORY_LABELS: Record<PerkCategory, string> = {
  offense: 'Offense',
  defense: 'Defense',
  utility: 'Utility',
};

export type ModifierKind = 'weakness' | 'resistance' | 'immune' | 'neutral';

/** Classify a monster element modifier (percentage of damage taken). */
export function modifierKind(percent: number): ModifierKind {
  if (percent <= 0) return 'immune';
  if (percent > 100) return 'weakness';
  if (percent < 100) return 'resistance';
  return 'neutral';
}

/** Dictionary key for the priority slider value (0 = DPS, 100 = survivability). */
export function priorityKey(value: number): MessageKey {
  if (value <= 10) return 'priority.maxDps';
  if (value < 40) return 'priority.dps';
  if (value <= 60) return 'priority.balanced';
  if (value < 90) return 'priority.defense';
  return 'priority.maxSurvival';
}

/** English label for the priority slider value. */
export function priorityLabel(value: number): string {
  return en[priorityKey(value)];
}

/** Vocation-specific gem item names (game terms, English). */
const GEM_BASE_NAMES: Record<Vocation, string> = {
  knight: 'Guardian Gem',
  paladin: 'Marksman Gem',
  sorcerer: 'Mage Gem',
  druid: 'Sage Gem',
  monk: 'Spiritualist Gem',
};

export function gemName(vocation: Vocation, quality: GemQuality): string {
  const base = GEM_BASE_NAMES[vocation];
  return quality === 'lesser' ? `Lesser ${base}` : quality === 'greater' ? `Greater ${base}` : base;
}

export const QUALITY_COLORS: Record<GemQuality, string> = {
  lesser: '#8fc7a0',
  regular: '#6fb7e8',
  greater: '#c58ef0',
};

export const ROMAN: Record<ModGrade, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/** Tiny `clsx` replacement. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}
