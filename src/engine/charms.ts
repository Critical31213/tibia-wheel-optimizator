/**
 * D93: assignment of the player's offensive charms to the spot's creatures (one charm per creature, each charm once,
 * no slot limit). Value of a charm on a creature = gain in rotation damage per turn; the best total is found exactly.
 */
import type { CharmAssign, OwnedCharm } from '../types';
import { CHARM_IDS } from '../data/charms';
import { charmModel, critEV, NO_BONUS, rotationTotal, type SpellModel } from './spells';

/** Known charms, unique (the highest stage kept), stages 1..3. */
export function ownedCharms(raw: readonly OwnedCharm[] | undefined): OwnedCharm[] {
  const out = new Map<string, OwnedCharm>();
  for (const c of raw ?? []) {
    if (!CHARM_IDS.includes(c?.id) || ![1, 2, 3].includes(c.stage)) continue;
    if ((out.get(c.id)?.stage ?? 0) < c.stage) out.set(c.id, { id: c.id, stage: c.stage });
  }
  return [...out.values()];
}

/** The model with charms (crit shift on auto attacks, procs and Carnage in the rotation). */
export function withCharmPicks(model: SpellModel, picks: readonly CharmAssign[]): SpellModel {
  const charms = charmModel(model.vocation, model.character.level, model.context, model.monsters, picks);
  const g = model.gear;
  const before = model.charms;
  const crit = (c: SpellModel['charms']) => critEV((g?.critChance ?? 0) + (c?.critChance ?? 0), (g?.critExtra ?? 0) + (c?.critExtra ?? 0));
  const { charms: _old, ...rest } = model;
  return { ...rest, base: (model.base * crit(charms)) / crit(before), ...(charms ? { charms } : {}) };
}

export interface CharmAssignment {
  picks: CharmAssign[];
  /** Damage gain (%) of each pick alone, same order. */
  gains: number[];
}

/** Best assignment on a planned model (its rotation plan set). */
export function assignCharms(model: SpellModel, owned: readonly OwnedCharm[]): CharmAssignment {
  const monsters = model.monsters.map((m) => m.monster.id);
  if (!owned.length || !monsters.length) return { picks: [], gains: [] };
  const plain = withCharmPicks(model, []);
  const t0 = Math.max(1, rotationTotal(plain, NO_BONUS));
  const value = monsters.map((monsterId) =>
    owned.map((c) => Math.max(0, rotationTotal(withCharmPicks(plain, [{ ...c, monsterId }]), NO_BONUS) - t0)),
  );
  // Exact: DP over creatures with the set of charms used (12 charms at most).
  const n = owned.length;
  let best = new Map<number, { v: number; pick: number[] }>([[0, { v: 0, pick: [] }]]);
  for (let m = 0; m < monsters.length; m++) {
    const next = new Map<number, { v: number; pick: number[] }>();
    const put = (mask: number, v: number, pick: number[]) => {
      const cur = next.get(mask);
      if (!cur || v > cur.v + 1e-12) next.set(mask, { v, pick });
    };
    for (const [mask, s] of best) {
      put(mask, s.v, [...s.pick, -1]);
      for (let c = 0; c < n; c++) if (!(mask & (1 << c)) && value[m][c] > 0) put(mask | (1 << c), s.v + value[m][c], [...s.pick, c]);
    }
    best = next;
  }
  const top = [...best.values()].reduce((a, b) => (b.v > a.v ? b : a));
  const rows = top.pick
    .map((c, m) => (c < 0 ? null : { pick: { ...owned[c], monsterId: monsters[m] }, gain: (100 * value[m][c]) / t0 }))
    .filter((x): x is { pick: CharmAssign; gain: number } => !!x)
    .sort((a, b) => b.gain - a.gain);
  return { picks: rows.map((r) => r.pick), gains: rows.map((r) => r.gain) };
}
