/**
 * D73: announced Wheel of Destiny / gem changes, applied on top of the extracted planner data
 * (which still describes the previous version).
 *
 * - Quadrants: Revelation Mastery moves to the ring 2 leech slot and the leech to the central ring 3 slot
 *   (where Revelation Mastery was); spell augments stay.
 * - Supreme mods: new grade IV values (lower grades keep the I:II:III:IV = 2/3 : 0.733 : 0.8 : 1 ratio).
 * - New chain augments (+1/1/1/2 chain targets, +0/1/2/2 range) replace three supreme mods.
 */
import type { Quarter, VocationWheelData, WheelDataFile, WheelSupremeMod } from './types';

/** Ring 3 central slot (Revelation Mastery) and ring 2 leech slot, per quarter (grid ids). */
const QUARTER_SLOTS: Record<Quarter, { central: number; leech: number }> = {
  TL: { central: 7, leech: 8 },
  TR: { central: 10, leech: 16 },
  BL: { central: 25, leech: 19 },
  BR: { central: 28, leech: 27 },
};

/** New grade IV values: [mod id, kind, value %]. */
const GRADE_IV: readonly [number, 'crit' | 'dmg', number][] = [
  // knight
  [19, 'crit', 36], // Annihilation
  [17, 'crit', 24], // Groundshaker
  [15, 'crit', 21], // Front Sweep
  [11, 'crit', 15], // Fierce Berserk
  [16, 'dmg', 12], // Groundshaker
  [14, 'dmg', 10.5], // Front Sweep
  [94, 'dmg', 15], // Shield Slam
  [95, 'crit', 22.5], // Shield Slam
  // paladin
  [31, 'crit', 24], // Divine Missile
  [29, 'crit', 15], // Divine Caldera
  [99, 'crit', 24], // Divine Barrage
  [33, 'crit', 30], // Ethereal Spear
  [98, 'dmg', 9], // Divine Barrage
  [101, 'crit', 15], // Ethereal Barrage
  // sorcerer
  [51, 'crit', 15], // Great Fire Wave
  [55, 'crit', 18], // Great Energy Beam
  [45, 'crit', 18], // Great Death Beam
  [103, 'crit', 15], // Death Echo
  [46, 'dmg', 9], // Hell's Core
  [54, 'dmg', 9], // Great Energy Beam
  [44, 'dmg', 9], // Great Death Beam
  // druid
  [62, 'crit', 21], // Terra Burst
  [64, 'crit', 21], // Ice Burst
  [106, 'dmg', 9], // Forked Glacier
  [108, 'dmg', 9], // Forked Thorns
  // monk
  [81, 'crit', 30], // Forceful Uppercut
  [83, 'crit', 21], // Flurry of Blows
  [85, 'crit', 15], // Greater Flurry of Blows
  [87, 'crit', 15], // Sweeping Takedown
  [79, 'crit', 15], // Spiritual Outburst
  [82, 'dmg', 10.5], // Flurry of Blows
];

const GRADE_RATIO = [2 / 3, 2.2 / 3, 2.4 / 3, 1];
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Chain augments: they keep the id of the mod they replace. */
const CHAIN_MODS: readonly [number, string][] = [
  [97, 'Chivalrous Challenge'], // was Intense Wound Cleansing cooldown
  [105, 'Lightning'], // was Lightning critical extra damage
  [25, 'Divine Dazzle'], // was Divine Dazzle cooldown
];
export const CHAIN_TARGETS = [1, 1, 1, 2];
export const CHAIN_RANGE = [0, 1, 2, 2];
/** Stacking limit of chain targets (chain range is capped at double the base, not modelled). */
export const MAX_CHAIN_TARGETS = 12;

function chainMod(id: number, spell: string): WheelSupremeMod {
  return {
    id,
    kind: 'supreme',
    name: `Augmented ${spell} (Chain)`,
    category: 'augChain',
    spell,
    revelation: null,
    gradeValues: CHAIN_TARGETS.map((t, i) => `+${t} Chain Target${t > 1 ? 's' : ''}, +${CHAIN_RANGE[i]} Range`),
    values: [...CHAIN_TARGETS],
    maxGradeValue: CHAIN_TARGETS[3],
  };
}

function updateMods(mods: WheelSupremeMod[]): WheelSupremeMod[] {
  return mods.map((m) => {
    const chain = CHAIN_MODS.find(([id]) => id === m.id);
    if (chain) return chainMod(...chain);
    const g = GRADE_IV.find(([id]) => id === m.id);
    if (!g) return m;
    const values = GRADE_RATIO.map((k) => r2(g[2] * k));
    const label = g[1] === 'crit' ? 'Critical Extra Damage' : 'Base Damage';
    return { ...m, values, gradeValues: values.map((x) => `+${x}% ${label}`), maxGradeValue: g[2] };
  });
}

function updateTiles(w: VocationWheelData): VocationWheelData['tiles'] {
  const conv = new Map(w.tiles.map((t) => [t.gridId, t.conviction]));
  const moved = new Map<number, VocationWheelData['tiles'][number]['conviction']>();
  for (const s of Object.values(QUARTER_SLOTS)) {
    // D90: data extracted after the update already has the new layout; swap only the old one.
    if (conv.get(s.central)?.category !== 'revelationMastery') continue;
    moved.set(s.leech, conv.get(s.central)!);
    moved.set(s.central, conv.get(s.leech)!);
  }
  return w.tiles.map((t) => (moved.has(t.gridId) ? { ...t, conviction: moved.get(t.gridId)! } : t));
}

export function applyWheelUpdate(data: WheelDataFile): WheelDataFile {
  const vocations = Object.fromEntries(
    Object.entries(data.vocations).map(([v, w]) => [v, { ...w, tiles: updateTiles(w), mods: { ...w.mods, supreme: updateMods(w.mods.supreme) } }]),
  ) as WheelDataFile['vocations'];
  return { ...data, vocations };
}
