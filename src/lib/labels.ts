/** Display labels and colours shared by UI components (no React here). */
import type { Domain, Element, GemQuality, ModGrade, Vocation } from '../types';
import { WHEEL_DATA } from '../data/wheel';
import { en } from '../i18n/en';
import type { MessageKey } from '../i18n/en';

export const VOCATION_LABELS: Record<Vocation, string> = {
  knight: 'Knight',
  paladin: 'Paladin',
  sorcerer: 'Sorcerer',
  druid: 'Druid',
  monk: 'Monk',
};

/** Tibia-like domain tints. `base` fills allocated points, `dim` is the empty slot. */
export const DOMAIN_COLORS: Record<Domain, { base: string; dim: string; text: string }> = {
  topLeft: { base: '#4fa65a', dim: '#1f3322', text: '#8fd89a' },
  topRight: { base: '#c2483d', dim: '#3a1d1a', text: '#f2958c' },
  bottomLeft: { base: '#8e5bc4', dim: '#2b2038', text: '#c9a6ef' },
  bottomRight: { base: '#3f7fc8', dim: '#1a2738', text: '#94bff0' },
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

export type ModifierKind = 'weakness' | 'resistance' | 'immune' | 'neutral';

/** Classify a monster element modifier (percentage of damage taken). */
export function modifierKind(percent: number): ModifierKind {
  if (percent <= 0) return 'immune';
  if (percent > 100) return 'weakness';
  if (percent < 100) return 'resistance';
  return 'neutral';
}

/** Dictionary key for the priority slider value (0 = DPS, 100 = survivability). */
/** D91: the selectable priority steps (DPS–survival weights 100–0, 75–25, 50–50, 25–75, 0–100). */
export const PRIORITY_STEPS = [0, 25, 50, 75, 100] as const;

/** Nearest priority step (ties towards DPS); invalid → 50. */
export function snapPriority(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return PRIORITY_STEPS.reduce((best, s) => (Math.abs(s - value) < Math.abs(best - value) ? s : best), PRIORITY_STEPS[0]);
}

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

const QUALITY_LEVEL: Record<GemQuality, number> = { lesser: 0, regular: 1, greater: 2 };

/** Vocation-specific gem item name from the planner data (`VesselInfos.GemNames`), e.g. "Greater Sage Gem". */
export function gemName(vocation: Vocation, quality: GemQuality): string {
  return WHEEL_DATA.vessels.gemNames[QUALITY_LEVEL[quality]][vocation];
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
