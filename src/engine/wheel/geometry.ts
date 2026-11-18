/**
 * Wheel of Destiny geometry, shared by all vocations.
 *
 * Layout follows the 36 slots of the canary server (WheelSlots_t). Each domain
 * holds 9 slices: 50 | 75 75 | 100 100 100 | 150 150 | 200 (= 1000 points),
 * arranged in 5 concentric rings of 4 / 8 / 12 / 8 / 4 slices.
 */
import type { Domain } from '../../types';

export type Color = 'green' | 'red' | 'purple' | 'blue';
export type DedicationKind = 'hp' | 'mana' | 'capacity' | 'mitigation' | 'hpMana';
/** Conviction slot kind; spell groups A–E map to one spell per vocation, each in 2 slots. */
export type ConvictionKind =
  | 'vessel'
  | 'lifeLeech'
  | 'manaLeech'
  | 'skill'
  | 'spellA'
  | 'spellB'
  | 'spellC'
  | 'spellD'
  | 'spellE'
  | 'passiveGreen'
  | 'passivePurple';

export const COLOR_DOMAIN: Record<Color, Domain> = {
  green: 'topLeft',
  red: 'topRight',
  purple: 'bottomRight',
  blue: 'bottomLeft',
};

export const DOMAIN_COLOR: Record<Domain, Color> = {
  topLeft: 'green',
  topRight: 'red',
  bottomRight: 'purple',
  bottomLeft: 'blue',
};

/** Clockwise from 12 o'clock. */
export const DOMAIN_ORDER: readonly Domain[] = ['topRight', 'bottomRight', 'bottomLeft', 'topLeft'];

export const RING_SIZES: readonly number[] = [4, 8, 12, 8, 4];
export const RING_CAPACITY: readonly number[] = [50, 75, 100, 150, 200];
/** Rings whose same-ring neighbours across a domain border touch (canary cross-colour links). */
const CROSS_DOMAIN_LATERAL_RINGS = new Set([2, 3]);

export interface SlotDef {
  /** Stable id, e.g. "green-top-75". */
  id: string;
  color: Color;
  domain: Domain;
  ring: number;
  /** Position inside the domain, clockwise (0-based). */
  posInDomain: number;
  capacity: number;
  dedication: DedicationKind;
  conviction: ConvictionKind;
}

type Row = [name: string, ded: DedicationKind, conv: ConvictionKind];

/**
 * Per colour, per ring: slots in CLOCKWISE order.
 * Red/purple are traversed TOP→BOTTOM, blue/green BOTTOM→TOP (canary naming
 * refers to its 6×6 grid; TOP of green/red is the 12 o'clock border, etc.).
 */
const SLOTS: Record<Color, Row[][]> = {
  red: [
    [['50', 'mitigation', 'spellA']],
    [['top-75', 'capacity', 'vessel'], ['bottom-75', 'capacity', 'lifeLeech']],
    [['top-100', 'mana', 'skill'], ['middle-100', 'mana', 'spellE'], ['bottom-100', 'mana', 'vessel']],
    [['top-150', 'hp', 'vessel'], ['bottom-150', 'hp', 'manaLeech']],
    [['200', 'hpMana', 'spellB']],
  ],
  purple: [
    [['50', 'hp', 'vessel']],
    [['top-75', 'mitigation', 'skill'], ['bottom-75', 'mitigation', 'manaLeech']],
    [['top-100', 'capacity', 'spellC'], ['middle-100', 'capacity', 'spellD'], ['bottom-100', 'capacity', 'vessel']],
    [['top-150', 'mana', 'vessel'], ['bottom-150', 'mana', 'lifeLeech']],
    [['200', 'hpMana', 'passivePurple']],
  ],
  blue: [
    [['50', 'mana', 'spellB']],
    [['bottom-75', 'hp', 'vessel'], ['top-75', 'hp', 'manaLeech']],
    [['bottom-100', 'mitigation', 'skill'], ['middle-100', 'mitigation', 'spellE'], ['top-100', 'mitigation', 'vessel']],
    [['bottom-150', 'capacity', 'vessel'], ['top-150', 'capacity', 'lifeLeech']],
    [['200', 'hpMana', 'spellA']],
  ],
  green: [
    [['50', 'capacity', 'vessel']],
    [['bottom-75', 'mana', 'skill'], ['top-75', 'mana', 'lifeLeech']],
    [['bottom-100', 'hp', 'spellD'], ['middle-100', 'hp', 'spellC'], ['top-100', 'hp', 'vessel']],
    [['bottom-150', 'mitigation', 'vessel'], ['top-150', 'mitigation', 'manaLeech']],
    [['200', 'hpMana', 'passiveGreen']],
  ],
};

export interface GeoSlice extends SlotDef {
  indexInRing: number;
  slicesInRing: number;
  /** Angular span in degrees, clockwise from 12 o'clock. */
  start: number;
  end: number;
  adjacent: string[];
}

function overlaps(a: GeoSlice, b: GeoSlice): boolean {
  return Math.min(a.end, b.end) - Math.max(a.start, b.start) > 1e-9;
}

/** Builds the 36 slices with angles and symmetric adjacency. */
export function buildGeometry(): GeoSlice[] {
  const slices: GeoSlice[] = [];
  RING_SIZES.forEach((size, r) => {
    const ring = r + 1;
    const perDomain = size / 4;
    const step = 360 / size;
    DOMAIN_ORDER.forEach((domain, d) => {
      const color = DOMAIN_COLOR[domain];
      SLOTS[color][r].forEach(([name, dedication, conviction], pos) => {
        const indexInRing = d * perDomain + pos;
        slices.push({
          id: `${color}-${name}`,
          color,
          domain,
          ring,
          posInDomain: pos,
          capacity: RING_CAPACITY[r],
          dedication,
          conviction,
          indexInRing,
          slicesInRing: size,
          start: indexInRing * step,
          end: (indexInRing + 1) * step,
          adjacent: [],
        });
      });
    });
  });

  const link = (a: GeoSlice, b: GeoSlice) => {
    if (!a.adjacent.includes(b.id)) a.adjacent.push(b.id);
    if (!b.adjacent.includes(a.id)) b.adjacent.push(a.id);
  };
  for (const a of slices) {
    for (const b of slices) {
      if (a === b) continue;
      if (b.ring === a.ring + 1 && overlaps(a, b)) link(a, b);
      if (b.ring === a.ring && a.ring > 1) {
        const n = a.slicesInRing;
        const neighbour = (a.indexInRing + 1) % n === b.indexInRing;
        if (neighbour && (a.domain === b.domain || CROSS_DOMAIN_LATERAL_RINGS.has(a.ring))) link(a, b);
      }
    }
  }
  for (const s of slices) s.adjacent.sort();
  return slices;
}
