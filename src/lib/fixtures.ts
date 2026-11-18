/**
 * UI-ONLY FIXTURES — fake wheel, fake optimizer and fake monsters.
 *
 * Used by `src/lib/api.ts` only while the real engine/data modules return
 * empty data (stubs). Once both real modules ship, delete this file and the
 * fallback branches in `api.ts` (see docs/modules/ui.md → "Fixture fallback").
 */
import type {
  ActivatedRevelation,
  Domain,
  Monster,
  OptimizerInput,
  OptimizerResult,
  Perk,
  PerkCategory,
  RevelationPerk,
  Slice,
  StatLine,
  Vocation,
  WheelDefinition,
} from '../types';

const RINGS = [
  { ring: 1, count: 4, capacity: 50 },
  { ring: 2, count: 8, capacity: 75 },
  { ring: 3, count: 12, capacity: 100 },
  { ring: 4, count: 12, capacity: 150 },
];

const QUADRANTS: Domain[] = ['topRight', 'bottomRight', 'bottomLeft', 'topLeft'];

const DOMAIN_CATEGORY: Record<Domain, PerkCategory> = {
  topLeft: 'defense',
  topRight: 'offense',
  bottomLeft: 'offense',
  bottomRight: 'defense',
};

const PERK_NAMES: Record<PerkCategory, string[]> = {
  offense: ['Critical Strike', 'Elemental Damage', 'Skill Boost', 'Spell Focus', 'Overpower'],
  defense: ['Max Hitpoints', 'Damage Mitigation', 'Life Leech', 'Elemental Resistance', 'Vitality'],
  utility: ['Mana Leech', 'Capacity', 'Movement Speed', 'Cooldown Reduction'],
};

const REVELATION_NAMES: Record<Domain, string> = {
  topLeft: 'Gift of Life',
  topRight: 'Executioner\'s Throw',
  bottomLeft: 'Avatar of Steel',
  bottomRight: 'Combat Mastery',
};

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.min(a1, b1) - Math.max(a0, b0) > 1e-9;
}

const wheelCache = new Map<Vocation, WheelDefinition>();

export function fixtureWheel(vocation: Vocation): WheelDefinition {
  const cached = wheelCache.get(vocation);
  if (cached) return cached;

  const slices: Slice[] = [];
  let n = 0;
  for (const { ring, count, capacity } of RINGS) {
    for (let i = 0; i < count; i++) {
      const domain = QUADRANTS[Math.floor((i * 4) / count)];
      const category: PerkCategory = ring === 3 && i % 3 === 1 ? 'utility' : DOMAIN_CATEGORY[domain];
      const names = PERK_NAMES[category];
      const conviction: Perk = {
        id: `fx-perk-${ring}-${i}`,
        name: names[n++ % names.length],
        description: `Demo ${category} perk (ring ${ring}).`,
        category,
      };
      slices.push({
        id: `fx-r${ring}-s${i}`,
        domain,
        ring,
        indexInRing: i,
        slicesInRing: count,
        capacity,
        adjacent: [],
        conviction,
        dedicationLabel: category === 'offense' ? '+ damage' : category === 'defense' ? '+ hitpoints' : '+ mana',
      });
    }
  }

  // Adjacency: neighbours in the same ring, plus angular overlap with rings ±1.
  for (const s of slices) {
    const a0 = (s.indexInRing * 360) / s.slicesInRing;
    const a1 = ((s.indexInRing + 1) * 360) / s.slicesInRing;
    for (const t of slices) {
      if (t === s) continue;
      const b0 = (t.indexInRing * 360) / t.slicesInRing;
      const b1 = ((t.indexInRing + 1) * 360) / t.slicesInRing;
      const sameRingNeighbour =
        t.ring === s.ring &&
        ((t.indexInRing - s.indexInRing + s.slicesInRing) % s.slicesInRing === 1 ||
          (s.indexInRing - t.indexInRing + s.slicesInRing) % s.slicesInRing === 1);
      const radialNeighbour = Math.abs(t.ring - s.ring) === 1 && overlaps(a0, a1, b0, b1);
      if (sameRingNeighbour || radialNeighbour) s.adjacent.push(t.id);
    }
  }

  const revelations: RevelationPerk[] = QUADRANTS.map((domain) => ({
    id: `fx-rev-${domain}`,
    name: REVELATION_NAMES[domain],
    description: `Demo revelation perk for the ${domain} domain.`,
    category: DOMAIN_CATEGORY[domain],
    domain,
    thresholds: [250, 500, 1000],
  }));

  const wheel: WheelDefinition = {
    vocation,
    slices,
    revelations,
    totalCapacity: slices.reduce((sum, s) => sum + s.capacity, 0),
  };
  wheelCache.set(vocation, wheel);
  return wheel;
}

/** Greedy demo optimizer: start from ring 1, always fill the best adjacent slice. */
export function fixtureOptimize(input: OptimizerInput): OptimizerResult {
  const wheel = fixtureWheel(input.vocation);
  const byId = new Map(wheel.slices.map((s) => [s.id, s]));
  const off = (100 - input.priority) / 100;
  const def = input.priority / 100;
  const weaknesses = input.monster
    ? Object.values(input.monster.elementModifiers).filter((v) => (v ?? 100) > 100).length
    : 0;
  const threats = input.monster?.damageTypes.length ?? 0;

  const weight = (s: Slice) => {
    const base =
      s.conviction.category === 'offense'
        ? off * (1 + weaknesses * 0.1)
        : s.conviction.category === 'defense'
          ? def * (1 + threats * 0.05)
          : 0.35;
    return base - s.ring * 0.01; // prefer inner rings slightly
  };

  const allocation: Record<string, number> = {};
  const path: string[] = [];
  const frontier = new Set(wheel.slices.filter((s) => s.ring === 1).map((s) => s.id));
  let remaining = Math.max(0, Math.floor(input.points));

  while (remaining > 0 && frontier.size > 0) {
    let best: Slice | undefined;
    for (const id of frontier) {
      const s = byId.get(id)!;
      if (!best || weight(s) > weight(best)) best = s;
    }
    if (!best) break;
    frontier.delete(best.id);
    const spend = Math.min(best.capacity, remaining);
    allocation[best.id] = spend;
    path.push(best.id);
    remaining -= spend;
    if (spend === best.capacity) {
      for (const adj of best.adjacent) if (!(adj in allocation)) frontier.add(adj);
    }
  }

  const domainPoints: Record<Domain, number> = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
  for (const [id, pts] of Object.entries(allocation)) domainPoints[byId.get(id)!.domain] += pts;

  const revelations: ActivatedRevelation[] = wheel.revelations.map((perk) => {
    const dp = domainPoints[perk.domain];
    return { perk, domainPoints: dp, stage: perk.thresholds.filter((t) => dp >= t).length };
  });

  const convictions = path
    .map((id) => byId.get(id)!)
    .filter((s) => allocation[s.id] === s.capacity)
    .map((s) => s.conviction);

  const sumBy = (cat: PerkCategory) =>
    path.reduce((sum, id) => (byId.get(id)!.conviction.category === cat ? sum + allocation[id] : sum), 0);
  const offPts = sumBy('offense');
  const defPts = sumBy('defense');
  const utilPts = sumBy('utility');
  const used = input.points - remaining;
  const cap = wheel.totalCapacity / 2;

  const stats: StatLine[] = [
    { label: 'Damage and healing', value: `+${Math.round(offPts / 25)}%`, category: 'offense' },
    { label: 'Critical hit chance', value: `+${(offPts / 400).toFixed(1)}%`, category: 'offense' },
    { label: 'Max hitpoints', value: `+${defPts * 3}`, category: 'defense' },
    { label: 'Mitigation', value: `+${(defPts / 300).toFixed(2)}%`, category: 'defense' },
    { label: 'Max mana', value: `+${utilPts * 2}`, category: 'utility' },
  ];

  const rationale = [
    'Demo data: the real optimizer is not connected yet.',
    input.priority < 40
      ? 'Priority leans to damage, so offensive domains were filled first.'
      : input.priority > 60
        ? 'Priority leans to survivability, so defensive domains were filled first.'
        : 'Balanced priority: offense and defense were weighed evenly.',
  ];
  if (input.monster) {
    rationale.push(
      weaknesses > 0
        ? `${input.monster.name} has ${weaknesses} elemental weakness(es), boosting offensive slices.`
        : `${input.monster.name} has no weaknesses, so no extra offense bonus.`,
    );
  }

  return {
    allocation,
    path,
    pointsUsed: used,
    pointsTotal: input.points,
    domainPoints,
    revelations,
    convictions,
    stats,
    offenseScore: Math.min(100, Math.round((offPts / cap) * 100)),
    defenseScore: Math.min(100, Math.round((defPts / cap) * 100)),
    rationale,
  };
}

export const FIXTURE_MONSTERS: Monster[] = [
  {
    id: 'dragon-lord',
    name: 'Dragon Lord',
    hitpoints: 1900,
    experience: 2100,
    elementModifiers: { fire: 0, ice: 110, earth: 20, energy: 80, holy: 100, death: 100, physical: 100 },
    damageTypes: ['physical', 'fire'],
  },
  {
    id: 'demon',
    name: 'Demon',
    hitpoints: 8200,
    experience: 6000,
    elementModifiers: { fire: 0, ice: 112, holy: 112, energy: 50, earth: 60, death: 80, physical: 75 },
    damageTypes: ['physical', 'fire', 'energy', 'manaDrain'],
  },
  {
    id: 'grim-reaper',
    name: 'Grim Reaper',
    hitpoints: 3900,
    experience: 5500,
    elementModifiers: { holy: 135, fire: 110, death: 0, ice: 65, physical: 80 },
    damageTypes: ['physical', 'death'],
  },
  {
    id: 'hydra',
    name: 'Hydra',
    hitpoints: 2350,
    experience: 2100,
    elementModifiers: { energy: 110, earth: 0, ice: 50, fire: 100 },
    damageTypes: ['physical', 'earth', 'ice'],
  },
  {
    id: 'rat',
    name: 'Rat',
    hitpoints: 20,
    experience: 5,
    elementModifiers: {},
    damageTypes: ['physical'],
  },
  {
    id: 'frost-dragon',
    name: 'Frost Dragon',
    hitpoints: 1800,
    experience: 2100,
    elementModifiers: { ice: 0, fire: 110, energy: 105, earth: 0 },
    damageTypes: ['physical', 'ice'],
  },
];
