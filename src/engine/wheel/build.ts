/**
 * Engine wheel model built from the official planner dataset (`getWheelData`).
 * Engine slice index === planner grid id (0..35, row-major 6×6).
 */
import type {
  Domain,
  ModDefinition,
  PerkCategory,
  RevelationPerk,
  Slice,
  VesselDefinition,
  Vocation,
  WheelDefinition,
} from '../../types';
import {
  getSpell,
  getWheelData,
  WHEEL_DATA,
  type WheelBasicMod,
  type WheelRevelation,
  type WheelSupremeMod,
  type WheelTile,
} from '../../data/wheel';

/** Clockwise from 12 o'clock. Engine domain index = position in this list. */
export const DOMAIN_ORDER: readonly Domain[] = ['topRight', 'bottomRight', 'bottomLeft', 'topLeft'];

export const REVELATION_THRESHOLDS: readonly number[] = WHEEL_DATA.revelation.thresholds;
/** Flat damage & healing per revelation stage (index = stage). */
export const REVELATION_FLAT_BONUS: readonly number[] = WHEEL_DATA.revelation.damageHealingBonusPerStage;
/** Revelation points added to its own domain by a filled Revelation Mastery slice. */
export const RM_SLICE_POINTS: number = WHEEL_DATA.revelationMastery.pointsPerConvictionSlice;
/** Momentum chance (%) per mod grade I..IV for supreme cooldown mods. */
export const MOMENTUM_PER_GRADE: readonly number[] = WHEEL_DATA.momentum.perGrade;

export type ConvictionKind = 'augment' | 'rm' | 'vessel' | 'lifeLeech' | 'manaLeech' | 'skill' | 'unique';

export interface EngineSlice {
  idx: number;
  tile: WheelTile;
  slice: Slice;
  domainIdx: number;
  capacity: number;
  initiallyUnlocked: boolean;
  /** Slices whose complete fill unlocks this one (directed graph, reversed). */
  unlockedBy: number[];
  kind: ConvictionKind;
  /** Augments: index of the other copy, else -1. */
  twin: number;
}

export interface EngineRevelation {
  data: WheelRevelation;
  perk: RevelationPerk;
  domainIdx: number;
}

export interface EngineWheel {
  vocation: Vocation;
  slices: EngineSlice[];
  /** Indexed like DOMAIN_ORDER. */
  revelations: EngineRevelation[];
  basicMods: WheelBasicMod[];
  supremeMods: WheelSupremeMod[];
  vesselTiles: number[];
  definition: WheelDefinition;
}

function angleOf(t: WheelTile): number {
  const x = t.col + 0.5 - 3;
  const y = 3 - (t.row + 0.5);
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

function convictionKind(t: WheelTile): ConvictionKind {
  switch (t.conviction.category) {
    case 'augmentation':
      return 'augment';
    case 'revelationMastery':
      return 'rm';
    case 'gemVessel':
      return 'vessel';
    case 'leech':
      return /mana/i.test(t.conviction.name) ? 'manaLeech' : 'lifeLeech';
    case 'skillBonus':
      return 'skill';
    default:
      return 'unique';
  }
}

const UNIQUE_CATEGORY: Record<string, PerkCategory> = {
  'Battle Healing': 'defense',
  'Healing Link': 'defense',
  'Guiding Presence': 'utility',
};

function convictionCategory(t: WheelTile, kind: ConvictionKind): PerkCategory {
  switch (kind) {
    case 'augment': {
      const spell = getSpell(t.conviction.augment?.spells[0] ?? '');
      return spell?.kind === 'healing' ? 'defense' : spell?.kind === 'support' ? 'utility' : 'offense';
    }
    case 'lifeLeech':
      return 'defense';
    case 'skill':
      return 'offense';
    case 'unique':
      return UNIQUE_CATEGORY[t.conviction.name] ?? 'offense';
    default:
      return 'utility';
  }
}

function convictionDescription(t: WheelTile, kind: ConvictionKind): string {
  const c = t.conviction;
  if (kind === 'augment' && c.augment) return `I: ${c.augment.stage1}\nII: ${c.augment.stage2}`;
  if (kind === 'vessel') return c.description || 'Unlocks the next gem vessel; +1 damage and healing.';
  if (kind === 'rm') return `+${RM_SLICE_POINTS} points towards the ${c.name.replace('Revelation Mastery ', '')} revelation.`;
  if (c.description) return c.description;
  return c.displayValue ? `${c.name} ${c.displayValue}` : c.name;
}

function dedicationLabel(t: WheelTile): string {
  return (
    t.dedication.perks.map((p) => `+${p.perPoint}${p.unit ?? ''} ${p.name}`).join(', ') + ' per point'
  );
}

const REVELATION_CATEGORY: Record<string, PerkCategory> = {
  'Gift of Life': 'defense',
  'Blessing of the Grove': 'defense',
};

function supremeCategory(m: WheelSupremeMod): PerkCategory {
  switch (m.category) {
    case 'augHealing':
      return 'defense';
    case 'revelationMastery':
      return 'utility';
    case 'effect':
      return /dodge|life leech/i.test(m.name) ? 'defense' : /mana/i.test(m.name) ? 'utility' : 'offense';
    case 'augCooldown': {
      const s = getSpell(m.spell ?? '');
      return s?.kind === 'healing' ? 'defense' : 'offense';
    }
    default:
      return 'offense';
  }
}

function basicCategory(m: WheelBasicMod): PerkCategory {
  return m.effects.every((e) => e.effectId === 11 || e.effectId === 12) ? 'utility' : 'defense';
}

function build(vocation: Vocation): EngineWheel {
  const data = getWheelData(vocation);
  const graph = WHEEL_DATA.unlockGraph;
  const tiles = [...data.tiles].sort((a, b) => a.gridId - b.gridId);
  const n = tiles.length;

  const unlockedBy: number[][] = tiles.map(() => []);
  const neighbours: Set<number>[] = tiles.map(() => new Set());
  for (const [from, tos] of Object.entries(graph.edges)) {
    for (const to of tos) {
      unlockedBy[to].push(Number(from));
      neighbours[to].add(Number(from));
      neighbours[Number(from)].add(to);
    }
  }

  // indexInRing: clockwise angle order within each ring.
  const indexInRing = new Array<number>(n);
  const ringSize = new Map<number, number>();
  for (const ring of new Set(tiles.map((t) => t.ring))) {
    const inRing = tiles.filter((t) => t.ring === ring).sort((a, b) => angleOf(a) - angleOf(b));
    inRing.forEach((t, k) => (indexInRing[t.gridId] = k));
    ringSize.set(ring, inRing.length);
  }

  const kinds = tiles.map(convictionKind);
  const twins = tiles.map((t, i) => {
    if (kinds[i] !== 'augment') return -1;
    return tiles.findIndex((o, j) => j !== i && o.conviction.id === t.conviction.id && kinds[j] === 'augment');
  });

  const sliceId = (i: number) => tiles[i].tileName;
  const slices: EngineSlice[] = tiles.map((t, i) => {
    const kind = kinds[i];
    const slice: Slice = {
      id: sliceId(i),
      domain: t.domain,
      ring: t.ring,
      indexInRing: indexInRing[i],
      slicesInRing: ringSize.get(t.ring)!,
      capacity: t.capacity,
      adjacent: [...neighbours[i]].sort((a, b) => a - b).map(sliceId),
      conviction: {
        id: `${vocation}-${t.tileName}`,
        name: t.conviction.name,
        description: convictionDescription(t, kind),
        category: convictionCategory(t, kind),
      },
      dedicationLabel: dedicationLabel(t),
    };
    return {
      idx: i,
      tile: t,
      slice,
      domainIdx: DOMAIN_ORDER.indexOf(t.domain),
      capacity: t.capacity,
      initiallyUnlocked: graph.initiallyUnlocked.includes(t.gridId),
      unlockedBy: unlockedBy[i].sort((a, b) => a - b),
      kind,
      twin: twins[i],
    };
  });

  const revelations: EngineRevelation[] = DOMAIN_ORDER.map((domain, d) => {
    const r = data.revelations.find((x) => x.domain === domain)!;
    return {
      data: r,
      domainIdx: d,
      perk: {
        id: `${vocation}-revelation-${domain}`,
        name: r.name,
        description: r.description,
        category: REVELATION_CATEGORY[r.name] ?? 'offense',
        domain,
        thresholds: [...REVELATION_THRESHOLDS],
      },
    };
  });

  const vessels: VesselDefinition[] = data.vessels.map((v) => ({
    id: v.id,
    quality: v.quality,
    unlockOrder: v.unlockOrder,
  }));

  const basicMods = data.mods.basic;
  const supremeMods = data.mods.supreme;
  const mods: ModDefinition[] = [
    ...basicMods.map(
      (m): ModDefinition => ({
        id: m.id,
        kind: 'basic',
        name: m.name,
        category: basicCategory(m),
        gradeValues: [...m.gradeValues],
        slots: [...m.slots],
      }),
    ),
    ...supremeMods.map((m): ModDefinition => {
      const def: ModDefinition = {
        id: m.id,
        kind: 'supreme',
        name: m.name,
        category: supremeCategory(m),
        gradeValues: [...m.gradeValues],
      };
      const target = m.category === 'revelationMastery' ? m.revelation : (m.spell ?? m.revelation);
      if (target) def.target = target;
      return def;
    }),
  ];

  const definition: WheelDefinition = {
    vocation,
    slices: slices.map((s) => s.slice),
    revelations: revelations.map((r) => r.perk),
    totalCapacity: slices.reduce((sum, s) => sum + s.capacity, 0),
    vessels,
    mods,
  };
  return {
    vocation,
    slices,
    revelations,
    basicMods,
    supremeMods,
    vesselTiles: slices.filter((s) => s.kind === 'vessel').map((s) => s.idx),
    definition,
  };
}

const cache = new Map<Vocation, EngineWheel>();

export function getEngineWheel(vocation: Vocation): EngineWheel {
  let w = cache.get(vocation);
  if (!w) {
    w = build(vocation);
    cache.set(vocation, w);
  }
  return w;
}

/** Directed unlock rule: initially unlocked, or a completely filled slice unlocks it. */
export function isAvailable(w: EngineWheel, alloc: ArrayLike<number>, i: number): boolean {
  const s = w.slices[i];
  if (alloc[i] >= s.capacity) return false;
  if (s.initiallyUnlocked) return true;
  for (const j of s.unlockedBy) if (alloc[j] >= w.slices[j].capacity) return true;
  return false;
}

export function stageFor(points: number, thresholds: readonly number[] = REVELATION_THRESHOLDS): number {
  let stage = 0;
  for (let k = 0; k < thresholds.length; k++) if (points >= thresholds[k]) stage = k + 1;
  return stage;
}
