/** Assembles geometry + per-vocation data into an engine wheel (cached). */
import type { Domain, Slice, Vocation, WheelDefinition } from '../../types';
import { buildGeometry, DOMAIN_ORDER, type DedicationKind, type GeoSlice } from './geometry';
import {
  type EnginePerk,
  type EngineRevelation,
  lifeLeechPerk,
  manaLeechPerk,
  passivePerk,
  type PerkStats,
  type PerkValue,
  revelationPerk,
  skillPerk,
  spellPerk,
  vesselPerk,
} from './perks';
import { VOCATION_SPECS, type VocationSpec } from './vocations';

export interface EngineSlice {
  slice: Slice;
  geo: GeoSlice;
  /** Index into DOMAIN_ORDER. */
  domainIdx: number;
  /** Value of ONE dedication point. */
  ded: PerkValue;
  /** Raw stats of ONE dedication point. */
  dedStats: PerkStats;
  conv: EnginePerk;
  adj: number[];
}

export interface EngineWheel {
  vocation: Vocation;
  spec: VocationSpec;
  slices: EngineSlice[];
  /** Indexed like DOMAIN_ORDER. */
  revelations: EngineRevelation[];
  definition: WheelDefinition;
}

export const DOMAIN_LABEL: Record<Domain, string> = {
  topLeft: 'top-left',
  topRight: 'top-right',
  bottomLeft: 'bottom-left',
  bottomRight: 'bottom-right',
};

/** Value units per dedication point (vocation independent, see docs). */
const DED_VALUE: Record<DedicationKind, PerkValue> = {
  hp: { off: 0, def: 0.03, util: 0 },
  mana: { off: 0.015, def: 0.01, util: 0 },
  capacity: { off: 0, def: 0, util: 0.01 },
  mitigation: { off: 0, def: 0.03, util: 0 },
  hpMana: { off: 0.015, def: 0.04, util: 0 },
};

function dedication(kind: DedicationKind, spec: VocationSpec): { stats: PerkStats; label: string } {
  switch (kind) {
    case 'hp':
      return { stats: { hp: spec.hpPerPoint }, label: `+${spec.hpPerPoint} HP per point` };
    case 'mana':
      return { stats: { mana: spec.manaPerPoint }, label: `+${spec.manaPerPoint} mana per point` };
    case 'capacity':
      return { stats: { capacity: spec.capacityPerPoint }, label: `+${spec.capacityPerPoint} capacity per point` };
    case 'mitigation':
      return { stats: { mitigation: 0.03 }, label: '+0.03% mitigation per point' };
    case 'hpMana':
      return {
        stats: { hp: spec.hpPerPoint, mana: spec.manaPerPoint },
        label: `+${spec.hpPerPoint} HP and +${spec.manaPerPoint} mana per point`,
      };
  }
}

function conviction(geo: GeoSlice, spec: VocationSpec): EnginePerk {
  const id = `${spec.vocation}-${geo.id}`;
  switch (geo.conviction) {
    case 'vessel':
      return vesselPerk(id, DOMAIN_LABEL[geo.domain]);
    case 'lifeLeech':
      return lifeLeechPerk(id);
    case 'manaLeech':
      return manaLeechPerk(id);
    case 'skill':
      return skillPerk(id, spec.skillName, spec.skillValue);
    case 'passiveGreen':
      return passivePerk(id, spec.passiveGreen);
    case 'passivePurple':
      return passivePerk(id, spec.passivePurple);
    default: {
      const group = geo.conviction.slice(5) as keyof VocationSpec['spells'];
      return spellPerk(id, spec.spells[group]);
    }
  }
}

function build(vocation: Vocation): EngineWheel {
  const spec = VOCATION_SPECS[vocation];
  const geos = buildGeometry();
  const index = new Map(geos.map((g, i) => [g.id, i]));
  const slices: EngineSlice[] = geos.map((geo) => {
    const d = dedication(geo.dedication, spec);
    const conv = conviction(geo, spec);
    const { id, name, description, category } = conv;
    return {
      geo,
      domainIdx: DOMAIN_ORDER.indexOf(geo.domain),
      ded: DED_VALUE[geo.dedication],
      dedStats: d.stats,
      conv,
      adj: geo.adjacent.map((a) => index.get(a)!),
      slice: {
        id: geo.id,
        domain: geo.domain,
        ring: geo.ring,
        indexInRing: geo.indexInRing,
        slicesInRing: geo.slicesInRing,
        capacity: geo.capacity,
        adjacent: [...geo.adjacent],
        conviction: { id, name, description, category },
        dedicationLabel: d.label,
      },
    };
  });
  const colorOf: Record<Domain, keyof VocationSpec['revelations']> = {
    topLeft: 'green',
    topRight: 'red',
    bottomRight: 'purple',
    bottomLeft: 'blue',
  };
  const revelations = DOMAIN_ORDER.map((domain) =>
    revelationPerk(`${vocation}-revelation-${colorOf[domain]}`, domain, spec.revelations[colorOf[domain]]),
  );
  const definition: WheelDefinition = {
    vocation,
    vessels: [],
    mods: [],
    slices: slices.map((s) => s.slice),
    revelations: revelations.map(({ id, name, description, category, domain, thresholds }) => ({
      id,
      name,
      description,
      category,
      domain,
      thresholds: [...thresholds],
    })),
    totalCapacity: slices.reduce((sum, s) => sum + s.slice.capacity, 0),
  };
  return { vocation, spec, slices, revelations, definition };
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
