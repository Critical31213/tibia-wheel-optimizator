# Engine module (`src/engine`): wheel model, valuation, optimizer, gems

Owner: **S2 Engine** (iteration 3). Every number comes from the official test-server planner data in
`src/data/wheel` (see [`wheel-data.md`](wheel-data.md)); the engine contains no hand-written wheel tables.

## Public API (`src/engine/index.ts`)

| Export | Purpose |
|---|---|
| `optimize(input): OptimizerResult` | The best allocation, path, revelations, convictions, stats, vessels, gem and upgrade recommendations, and spells. Also `plannerCode` and `alternatives`. Deterministic; < 35 ms worst case including alternatives. |
| `getWheel(vocation): WheelDefinition` | Contract view: 36 slices, 4 revelations, 8 `vessels`, and `mods` (basic and supreme). |
| `pointsForLevel`, `MIN_LEVEL_FOR_POINTS`, `MAX_SCROLL_POINTS` | Unchanged. |
| `ENGINE_MESSAGES`, `renderMessage`, `EngineMessageKey` | i18n templates for `rationaleMsgs`, `reasonMsg` and `labelMsg`. |
| `DEFAULT_CONTEXT` | `{ mode: 'hunt', huntStyle: 'solo' }`, used when `input.context` is missing. |
| `getEngineWheel`, `isAvailable` | Internal model and unlock rule (for tests and the UI). |

```
src/engine/
  index.ts        public API
  wheel/build.ts  getWheelData -> EngineWheel (slices, unlock graph, twins, revelations, mods) + WheelDefinition
  spells.ts       context-aware spell model (targets, element, damage shares, cooldowns)
  values.ts       Parts {off, def, util} for dedication, convictions, augments, revelations, avatar, mods
  gems.ts         gem valuation, Hungarian placement, recommendations, upgrades
  optimizer.ts    tables, beam search, result assembly, stats, rationale
  messages.ts     ENGINE_MESSAGES key -> English template
  *.test.ts       model, spells, gems, optimizer, iteration3
```

## 1. Data model

- **Slices.** The engine index is the planner `gridId` (row-major 6×6). The slice id is the planner `tileName` (`QTL0`…`QBR8`).
  - Ring, capacity and domain come from the planner: rings hold 4×50, 8×75, 12×100, 8×150 and 4×200 points, which is 4000 in total and 1000 per domain.
  - `indexInRing` sorts each ring by angle, clockwise from 12 o'clock. The domains run in this order: `topRight`, `bottomRight`, `bottomLeft`, `topLeft`.
- **Unlock rule.** This is the planner's directed graph, `WHEEL_DATA.unlockGraph`.
  - Slices 14, 15, 20 and 21 start unlocked.
  - Any other slice is available only when at least one slice with an edge into it is **completely full**.
  - `slice.adjacent` in the contract is the undirected version of this graph, used for drawing.
  - The graph is asymmetric (corner slices, for example), so the engine always uses `unlockedBy`.
- **Dedication.** Planner perks per point: HP, mana, capacity, and mitigation at 0.075 % per point.
- **Convictions.** Each conviction applies only when its slice is full.
  - Augment slices come in pairs (`twin`). The first full copy gives stage I and the second gives stage II, in either order.
  - The other kinds are RM (+125 points to the revelation of its own domain), Gem Vessel, life leech, mana leech, skill, and vocation-unique perks.
- **Revelations.**
  - Stage thresholds are 250, 500 and 1000 revelation points. Revelation points are domain grid points plus 125 for each full RM slice in that domain.
  - Revelation-points gems (supreme mods for Revelation Mastery, 150/165/180/225 by grade) count toward thresholds only, and only when placed in an unlocked greater vessel.
  - Flat damage and healing bonus = Σ over domains of [0, 4, 9, 20][stage], plus 1 per full Gem Vessel slice.
- **Vessels.** There are 8 vessels, numbered with a **0-based** `vesselId` in planner order (lesser, regular, greater, lesser, greater, regular, greater, greater). Vessel *n* (0-based) unlocks when *n + 1* Gem Vessel slices are full, in any domain.
- **Gems and slots.** A lesser gem has `basic1`. A regular gem has `basic1` and `basic2`. A greater gem has both basics and `supreme`.
  - Any gem fits any vessel. Active slots = `SLOTS_BY_QUALITY[min(gem quality, vessel quality)]`.
- **Momentum.** Supreme cooldown mods add 0, 0.33, 0.66 or 1 % momentum by grade.

## 2. Valuation (`spells.ts`, `values.ts`)

Every source yields `Parts = { off, def, util }`. They are blended as `score = wOff·off + wDef·def + 0.1·util`, where:
- `p = priority / 100`;
- `wOff = max(0.05, 1 − p)`;
- `wDef = max(0.05, p)`.

**Character** (`valuationFor`).
- The engine uses `input.character`. Missing skills are estimated with `defaultCharacterStats` (`src/data/character`).
- With no character, `level = points + 50`.
- Level and skills drive HP, mana, base mitigation (`mitigationPercent`) and every spell hit (`src/data/damage` formulas).

### Damage model (`spells.ts`)

`buildSpellModel(vocation, context, monsters, character)` is cached (100 entries). Its spell set is the wheel spells plus the vocation's damage spells; runes are excluded.

- **Per cast:** `perCast = hit(stage) × targets × weighted element × crit EV × passive multipliers`.
  - **Hit precompute.** `hit` is stored per revelation stage 0..3 as `{base, boost, bf}`.
    - `boost` is the extra hit from +100 % base damage; the level term is excluded.
    - `bf` multiplies the flat Damage & Healing bonus.
  - **Revelation extras:**
    - Executioner's Throw: the extra replaces the main hit.
    - Bursts: average of main and extra.
    - Spiritual Outburst: the extra is added.
    - Beams: side hits land on the outer targets, and the central hit gets +10/12/14 % per target, capped at 30/36/42 %.
  - **Passives.** Combat Mastery, Ascetic (harmony spenders) and Lord of Destruction (fire) multiply the spells they affect.
- **Rotation:** one attack slot per 2 s turn.
  - Spells are filled greedily by per-cast damage, each capped at 1 / (cooldown / 2 s).
  - Shared cooldown groups keep only their best spell: Twin Bursts, Hell's Core / Rage of the Skies, Eternal Winter / Wrath of Nature, strong strikes, ultimate strikes.
  - Auto-attack fills the remaining turns. Weapon vocations use g(L) + 0.5·0.085·skill·attack; mages use g(L).
  - Paladin auto-attack hits 3 / 4 / 5 targets (solo / team-lure / team-box).
- **`off` unit:** `100 · ΔT / T0`, where T0 is the rotation with no wheel bonuses and every stage at 0.
  - All damage perks are valued as a rotation delta (`deltaOff`): augments, crit, cooldown (through rotation share), flat bonus, revelation stages and supreme mods.
- **Targets:**

  | Spell or context | Targets |
  |---|---|
  | single-target spell, hunt (D16) | **unusable**: its share, augments and gem mods are 0 |
  | single-target spell, boss | 1 |
  | area spell, boss mode | `min(maxTargets, 1.2)` (adds) |
  | area spell, solo hunt | `min(maxTargets, avgHitsHunt)` (tibiapal) |
  | area spell, team-lure / team-box | `min(maxTargets, max(solo, 5 / 9))` |

- **Monsters:**
  - `input.monsters` takes precedence over `input.monster`. Weights are normalised and non-positive weights are dropped.
  - The element multiplier is the weighted average over the spot. Immune (0) makes a spell useless.
  - With no monster, the multiplier is 1.
- **Healing** (`healPerCast`, `healShare`):
  - Healing spells use the healing formulas and are valued on the defense side.
  - Team heals count ×0.5 solo and ×2 in team hunts.

### Defense (`values.ts`)

| Source | Value |
|---|---|
| +1 % max HP | `HP_DEF · spikeFactor`, where spikeFactor = clamp(2 · spike / maxHP, 0.25, 1.5) and spike = weighted monster `maxDamage`, else 3 · level |
| +1 pp damage reduction | `DR_DEF / (1 − mitigation)`: sustained reduction, compounding with existing mitigation |
| Mitigation Multiplier | multiplies the character's real base mitigation (`mitigationPercent(voc, level, {shielding})`), then valued as damage reduction |
| resistance | `pct · DR_DEF · incomingShare(element)`; incoming shares are weighted over the spot's damage types |
| life / mana leech | strongly devalued: life leech 0.15 def per %; mana leech 0.1 off and 0.05 def per % |

All `def` values are scaled by `threat = clamp(maxDamage / 1000, 0.6, 1.6)`.

HP acts as effective HP against spikes, so it dominates at low and mid level. Mitigation grows with level and shielding, so it becomes competitive only at high level and high defense priority:
- EK 1500: about 1 : 1 per dedication point;
- RP 400: HP is worth about 15× more.

The rationale reports the ratio (`rationale.hpOverMitigation` / `rationale.mitigationOverHp`).

**Avatar.** Worth 0 in hunt mode. In boss mode its uptime-scaled damage boost and damage reduction are valued, including its supreme mods and momentum.

**Revelations.** The value of stage s is the sum of:
- the rotation Δ with only that domain at stage s;
- passive effects (Gift of Life, Combat Mastery, Divine Empowerment, Blessing of the Grove);
- the flat Damage & Healing bonus.

**Revelation Mastery** (slice or supreme gem) is valued with look-ahead: `rev(stage(points + x)) − rev(stage(points))`.
- It is worth 0 unless it reaches the next stage.
- Owned RM gems count in the search. They are assigned to greater vessels (largest first), and their points are added to the domain as soon as the vessel unlocks.

**Gem Vessel slices** are valued as the Hungarian placement gain of the next vessel plus 1 flat bonus.

## 3. Optimizer (`optimizer.ts`)

1. **Tables.** Parts for each dedication point, conviction, augment I/II, revelation[domain][stage] and vessel[k], blended by priority. `blendTables` can rescale revelations for alternatives.
2. **Beam search.** Width 24 over full-slice fills, deduplicated by allocation key.
   - Candidates are ranked without allocating (`rankOf` with a precomputed delta). Only the top 24 are materialised, and only the top 8 are greedily completed per level.
   - Rank = score + revelation-stage look-ahead + greedy-completion estimate. A partial last slice uses the remainder.
   - A budget ≥ total capacity has only one allocation, so the search returns the full wheel and no alternatives.
3. **Refine.** For each domain at stage 1–2, damp it (×0.2) and re-run the search. The result replaces the main build only if its exact objective under the main valuation is higher.
4. **Final pass.** Recompute stages, RM, vessels, stats, recommendations, spells and `plannerCode`.
5. **Alternatives.** The count is `input.alternatives ?? 2`, clamped to 0..5; none are produced below 100 points. Candidates, in order:
   - Avatar focus (boss mode; avatar revelation ×8);
   - top revelation off (×0);
   - priority shift ±35 (more defensive or more offensive);
   - top two revelations off;
   - the opposite shift;
   - push each other non-maxed revelation (×4).

   Acceptance and scoring:
   - An alternative is accepted only if it differs by at least `max(50, 0.1 · budget)` points (Σ|Δ| / 2) from the main build and from every alternative already accepted.
   - `relativeScore = 100 · objective(alt) / objective(main)`, under the main valuation. If any candidate search beats the main build (the beam is heuristic; seen up to 106 %), it is promoted to main and alternatives are recomputed (≤ 3 rounds), so `relativeScore ≤ 100`. Alternatives are sorted by `relativeScore` (desc).
   - The `alt.revelationFocus` label names every revelation at the alternative's highest stage (`A + B focus`), so two focus alternatives never share a label.
   - `tradeoffMsg` (`alt.tradeoff`) lists the offense and defense deltas and the revelations.
6. **Planner code.** `encodePlannerCode` (strict) of the allocation (`gridForSliceId`) plus the vessel gems.
   - Only slots matching the vessel quality are exported; vessels with `plannerVesselIssues` are skipped.
   - Tests decode the code, replay `path` against the unlock graph, and load it in the official planner WASM.
7. **Scores.** Offense and defense are normalised to the full wheel at stage 3 (0–100).

**Measured runtime** (warm, single thread, alternatives included):

| Budget | Time |
|---|---|
| 600 points | 3–6 ms |
| 2500 points | 15–20 ms |
| worst case (sorcerer, 3200 points) | 31 ms |
| full wheel | 3 ms |

## 4. Gems (`gems.ts`)

- **Placement rule.** Maximise Σ blend(gem value in vessel) over a one-to-one assignment (Hungarian algorithm), using only each vessel's active slots.
  - Because active slots follow `min(gem, vessel)` quality, strong supreme gems end up in greater vessels and basic-only gems fill the lower vessels.
  - Unplaced vessels that are unlocked get `source: 'recommended'`: the best gem of that vessel's quality at grade IV, with id `recommended-<quality>`.
  - Locked vessels have `unlocked: false`, `gem: null` and `source: 'empty'`.
- **`gemRecommendations`.**
  - Per quality, at grade IV: the best `basic1`, the best distinct `basic2`, and the top-2 supreme variants for greater gems.
  - Each has `reason` and `reasonMsg` from the dominant mod (spell share, avatar in boss, RM stage gained, resistance vs monster, and so on), sorted by gain.
- **`upgradeRecommendations`.**
  - Only owned gems, only active slots, and only +1 grade.
  - `gain = blend(grade + 1) − blend(grade)`, with momentum included for cooldown mods, sorted descending.
  - `gainToMax = blend(IV) − blend(grade)`.

## 5. i18n

- `rationaleMsgs`, `SpellUsage.reasonMsg`, `GemRecommendation.reasonMsg` and `StatLine.labelMsg` carry `{ key, params }`.
- Keys are `rationale.*`, `spell.*`, `gem.*` and `stat.*`, and are listed in `ENGINE_MESSAGES` (English templates with `{param}` placeholders).
- The plain `rationale`, `reason` and `label` strings stay in English.
- The UI translates `engine.<key>` (PL and EN in `src/i18n/`) and the id params (elements, hunt styles) through `engineText()`.
- `rationale.threat` and `rationale.threatMax` are separate keys, so no English fragment ends up in a param.
- `renderMessage` fills placeholders and leaves unknown ones as they are.

## 6. Assumptions

- The rotation is a single-slot greedy model, with no mana limits and no movement.
- The Avatar's boss window is 120 s per 30 min.
- Expected targets per context, `maxTargets` and monk elements are approximate (S1).
- Single-target spells are ignored in hunt mode (D16).
- The defense constants (`K.HP_DEF`, `K.DR_DEF`, spike, leech factors) are heuristics. Base mitigation comes from `src/data/character`.
- Momentum is valued as a cooldown proxy.

## 7. Tests

| File | Covers |
|---|---|
| `model.test.ts` | Geometry, the directed unlock graph matches `WHEEL_DATA`, twins, vessels and mods, thresholds, messages. |
| `spells.test.ts` | Targets per context, team-box > solo, D16 (single-target unusable in hunt, boss targets ≤ 1.2, no Augmented Annihilation in hunt), immune → useless, Avatar, cooldown floor, momentum, effect parsing, augments. |
| `gems.test.ts` | Hungarian vs brute force, active slots, placement, recommendations, upgrades, Mitigation Multiplier scaling with real base mitigation. |
| `optimizer.test.ts` | Path validity on random inputs, RM, vessel unlock order, augments, determinism, edge budgets, priority, perf < 50 ms (best of 3 per input), planner reference builds. |
| `iteration3.test.ts` | Character level and skills, HP > mitigation (RP 400), Mitigation Multiplier for EK 1500 at priority 100, leech devalued, RM look-ahead and owned RM gem, multi-monster weighting, distinct alternatives, planner code decode and unlock path, official planner WASM round-trip (`skipIf` when `scripts/.cache/wod/skillgrid.cjs` is missing). |
