# Engine module (`src/engine`): wheel model, valuation, optimizer, gems

Owner: **S2 Engine** (iteration 2). Every number comes from the official test-server planner data in
`src/data/wheel` (see [`wheel-data.md`](wheel-data.md)); the engine contains no hand-written wheel tables.

## Public API (`src/engine/index.ts`)

| Export | Purpose |
|---|---|
| `optimize(input): OptimizerResult` | The best allocation, path, revelations, convictions, stats, vessels, gem and upgrade recommendations, and spells. Deterministic; at most about 10 ms at 4000 points. |
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
  *.test.ts       model, spells, gems, optimizer
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

Every source yields `Parts = { off, def, util }`:

| Part | Unit |
|---|---|
| `off` | ≈ % of total damage output |
| `def` | ≈ % survivability, scaled by `threat = clamp(maxDamage / 1000, 0.6, 1.6)` |
| `util` | capacity and mana cost |

**Blend:** `score = wOff·off + wDef·def + 0.1·util`, where `p = priority / 100`, `wOff = max(0.05, 1 − p)` and `wDef = max(0.05, p)`.

**Expected targets** (`expectedTargets`):

| Spell or context | Targets |
|---|---|
| single-target spell | 1 (always) |
| area spell, boss mode | `min(maxTargets, 1.2)` |
| area spell, solo hunt | `min(maxTargets, avgHitsHunt)` (tibiapal) |
| area spell, team-lure / team-box | `min(maxTargets, max(solo, 5 / 9))` |

- Beams use 0.5 × pool for the central part. The outer part (`avgHitsHuntOuter`, 0.4 × pool in team styles) is weighted separately and is 0 against bosses.
- Healing spells count 1 target, or the party size for area heals in team hunts.

**Element.** `elem = monster.elementModifiers[element] / 100`. Immune (0) makes the spell useless, and so are its augments and its gem mods. With no monster, `elem = 1`.

**Damage share.**
- `c(spell) = weight × targets × elem`.
- `share = 100 · c / C`.
- `C` = the vocation's baseline attacks (auto-attacks or runes; mage area runes count 3/4/6 targets) + all non-revelation damage spells.
- Revelation spells (Executioner's Throw, Divine Grenade, Ice/Terra Burst, Spiritual Outburst) are added at weight 0.35 × stage multiplier. Twin Bursts share one cooldown.

| Effect | Value |
|---|---|
| +X % base damage | `off = X · share / 100` |
| crit extra damage | ×0.1 |
| crit chance | ×0.5 |
| life leech | → `def` |
| mana leech | → `off` and `def` |
| cooldown −r s (base cooldown B) | `share · (B / max(B/2, B − r) − 1)`. Cooldowns are **capped at 50 % of base**. |
| area / shape / jumps | add targets via the target model |
| healing augments | `def` via a heal share. Team heals count ×0.5 solo and ×2 in team. |

**Avatar.** Worth 0 in hunt mode. In boss mode:
- `off = 100 · (15 s / 120 s) · ((1 + 0.5 + extra) / (1 + 0.1·0.5) − 1) · min(1, 30 min / cooldown)`
- `extra` is 5/10/15 % by stage. `def` is the uptime-scaled damage reduction.
- This applies to the revelation itself and to its supreme mods, momentum included.

**Basic mods.** Resistances are worth `pct × incomingShare(monster, element)`; with no monster, generic shares are used. HP, mana and capacity scale relative to `level ≈ points + 50`.

**Mitigation Multiplier** (basic mod 30: 20/22/24/30 % by grade; dedication 0.075 %/point). The planner says it
"increases your mitigation multiplicatively", so it scales the character's base mitigation and is not a flat
damage reduction:
- extra damage reduction = `BASE_MITIGATION[vocation] × multiplier / 100`, then valued like +1 % reduction on all damage (`K.MIT_DR_DEF = 1`) × threat;
- `BASE_MITIGATION` (approximate, mid/high level) = knight 20 %, monk 14 %, paladin 10 %, sorcerer 6 %, druid 6 %;
- in-game mitigation = (defense + shielding) × equipment × wheel multiplier × combat stance, so knights with a shield are highest and mages are lowest;
- example: a grade IV gem is worth +6 % reduction for a knight and +1.8 % for a mage.

It remains the top defensive `basic1` mod for knights. Offensive mage builds prefer mana.

**Supreme mods.** Damage, crit, cooldown and healing use the spell model. Revelation Mastery is worth Δ(revelation value) for the extra points. Momentum is worth `off = 0.5·m` and `def = 0.2·m`.

## 3. Optimizer (`optimizer.ts`)

1. **Tables.** Precompute Parts and blended scalars for:
   - dedication per point
   - each conviction
   - augment I/II
   - revelation[domain][stage]
   - vessel[k]: the marginal value of unlocking vessel k = Hungarian placement of the owned gems over vessels `0..k`, against the grade-I recommended gem, plus 1 flat bonus.

   Before the search, revelation spells and RM mods assume `min(1000, 0.6 · budget)` revelation points.
2. **Beam search.**
   - Width 24, over states that fill one available slice completely. States are deduplicated by allocation key.
   - Rank = score + 0.6 × (next revelation-stage gain × progress toward it) + greedy-completion estimate.
   - When the budget cannot fill the next slice, the remainder goes to the best available slice as a partial last slice.
   - Ties break on the key, so the result is deterministic.
3. **Final pass.** Recompute the facts from the chosen grid (stages, RM slices, wheel effects), then:
   - place the owned gems
   - add the points of placed RM gems
   - recompute the stages, vessels, stats, recommendations and spells.
4. **Scores.** Offense and defense are normalised to the full wheel at stage 3 (0–100).

Complexity:
- Search: `O(steps · W · 36)` with an allocation-free gain function.
- Hungarian assignment: `O(n²m)`, with n, m ≤ 8.
- Measured: 0.4 ms at 100 points, 2.4 ms at 1000 points, 10 ms at 4000 points.

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

- Spell weights (single 0.6, area 0.5, per-spell overrides), the baseline attacks, and the boss window (120 s fight, 30 min between attempts) are heuristics.
- `maxTargets` and monk elements are approximate (S1).
- The level is estimated as points + 50 and is used to scale HP, mana and flat bonuses.
- The Mitigation Multiplier multiplies an **estimated** base mitigation per vocation (`BASE_MITIGATION`, see §2). Calibrate it against in-game values.
- Momentum is valued as a flat cooldown proxy.

## 7. Tests

| File | Covers |
|---|---|
| `model.test.ts` | Geometry, the directed unlock graph matches `WHEEL_DATA`, twins, vessels and mods, thresholds, messages. |
| `spells.test.ts` | Targets per context, team-box > solo for area spells, boss favours single-target, immune → useless, Avatar is 0 in hunt and > 0 in boss, cooldown floor, momentum, effect parsing, augment I/II. |
| `gems.test.ts` | Hungarian vs brute force, active slots, placement respects vessel quality, recommended/locked vessels, recommendations, upgrade ranking. |
| `optimizer.test.ts` | Directed-path validity on 60 random inputs, RM points and stages, vessel unlock order, augment stacking, determinism, edge budgets, priority, perf < 50 ms, loose check against the planner reference builds. |
