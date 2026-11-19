# Engine module (`src/engine`): wheel model, valuation, optimizer, gems

Owner: **S2 Engine** (iteration 3). Every number comes from the official test-server planner data in
`src/data/wheel` (see [`wheel-data.md`](wheel-data.md)); the engine contains no hand-written wheel tables.

## Public API (`src/engine/index.ts`)

| Export | Purpose |
|---|---|
| `optimize(input): OptimizerResult` | The best allocation, path, revelations, convictions, stats, vessels, gem and upgrade recommendations, and spells. Also `plannerCode` and `alternatives`. Deterministic; ~65 ms worst case (2500 points), test budget 100 ms, including RM re-optimization and D34 pair tries. |
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
  - D28: a gem fits only a vessel of its own quality (lesser → lesser, regular → regular, greater → greater); then all its slots are active (`fits`, `activeSlots`). Placement gives mismatched pairs weight 0.
  - D35: `input.forcedStage2` (both slices, `forcedSeed` → `pairPath`), `input.forcedRevelations` (`forcedStages`, `forceTables`, `planValid`), `revelationOptions` (reach per stage via `domainCost`; D38: plus the vessel fill an RM gem needs, `vesselFills`). D38: `forceTables` penalty is graded per missing stage. D43: RM recommendations go through `withRoom` on the re-optimized wheel (`vesselsAt`), must beat the current objective and be placed; `withRoom` values placed RM gems by `placedValue`. Duplicate supreme mod names get an effect suffix (`distinctNames` in wheel/build.ts).
  - D34: `searchPlan` adds seeded searches (`pairTries`, `pairSeed`, `cheapestPath`) for the top 2 augment pairs with stage II > stage I that the plain search did not fill.
  - D31: life leech (nodes, augments, supreme mods) per +1 pp = `leech / threat × 100 / LIFE_LEECH_IMBUE[vocation]` (`leechPoint`).
  - D32: `input.stances` (names, `[]` = none) replaces the automatic stance pick in `pickStances`.
  - D30: `withRoom`: with every unlocked vessel of a quality filled, a recommendation of that quality becomes a replacement of the weakest placed gem (`replaces`, gain = difference) or is dropped. Qualities without an unlocked vessel keep their recommendations.
- D29 life leech: `leechEhp(model, threat)` (values.ts) = leech HP/s / (leech HP/s + main heal per turn) × HEAL_EHP × threat, with leech per cast = leech% × damage × (0.1n + 0.9) / n . `weightsFor(priority, v.leech)` adds defense weight × leech to the offense weight. Gift of Life is ×0.5 while hunting.
- **Momentum.** Supreme cooldown mods add 0, 0.33, 0.66 or 1 % momentum by grade.

## 2. Valuation (`spells.ts`, `values.ts`)

Every source yields `Parts = { off, def, util }`. They are blended as `score = wOff·off + wDef·def + 0.1·util`, where:
- `p = priority / 100`;
- `wOff = max(0.05, 1 − p)`;
- `wDef = max(0.05, p)`.

**Character** (`valuationFor`).
- The engine uses `input.character`. Missing skills are estimated with `defaultCharacterStats` (`src/data/character`).
- With no character, `level = points + 50`.
- Level and skills drive HP, base mitigation (`mitigationPercent` with the D19 offhand defaults; the knight uses a shield only when the rotation `requires.shield`) and every spell hit (`src/data/damage` formulas).

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
  - **Passives.** Combat Mastery and Ascetic (harmony spenders) multiply the spells they affect; Lord of Destruction boosts the damage type of the elemental stance (D24, `LORD_OF_DESTRUCTION`).
- **Rotation (D20):** one attack slot per 2 s turn. A *plan* is a preset from `getRotationPresets(vocation)` or the greedy plan (`GREEDY_PLAN_ID = 'boss'`).
  - Plan selection: `input.rotationId` (manual), else auto = every preset (plus the greedy plan in boss mode), each searched jointly with the build; the best valid plan wins. `requires.revelation` is valid only when the build reaches that revelation; `requires.shield` switches the knight to a shield (base mitigation).
  - `planFor` resolves `or` alternatives by per-cast damage vs the spot at stage 3, drops revelation-granted spells and merges duplicates.
  - Preset rotation: active revelation spells (Divine Grenade, Executioner's Throw, bursts, Spiritual Outburst…) are cast first, on cooldown. The remaining turns are water-filled over the preset ratios, each spell capped at 1 / (cooldown / 2 s). Shared cooldown groups keep only their best spell.
  - Greedy plan: spells filled by per-cast damage within cooldowns; Avatars count only in boss mode.
  - Auto-attack fills the remaining turns. Weapon vocations use g(L) + 0.5·0.085·skill·attack; mages use g(L). Paladin auto-attack hits 6 targets in hunt (bow, diamond arrows; storm arrows 5.3, D59) and 1 in boss (crossbow).
  - `result.rotation` = `{presetId, auto, spells[{name, ratio (casts/min), share %, fromRevelation}]}` for the main build and each alternative.
- **`off` unit:** `100 · ΔT / Tref`. Tref is shared by every plan (the best preset without a revelation requirement, no wheel bonuses), so plans are comparable; `model.baseOff` is each plan's own T0 offset vs Tref.
- **Transit slices:** augments and gem mods of spells outside the rotation are worth 0 (`spell.notInRotation`) unless the spell is forced or a heal. Utility spells (Divine Dazzle) count only when forced (`spell.forced`). Augment damage deltas are clamped at ≥ 0.
  - All damage perks are valued as a rotation delta (`deltaOff`): augments, crit, cooldown (through rotation share), flat bonus, revelation stages and supreme mods.
- **Targets:**

  | Spell or context | Targets |
  |---|---|
  | single-target spell, hunt (D16) | **unusable**: its share, augments and gem mods are 0 |
  | single-target spell, boss | 1 |
  | area spell, boss mode | `min(maxTargets, 1.2)` (adds) |
  | area spell, hunt | `min(maxTargets, avgHitsHunt)` (community averages; `huntStyle` is ignored) |
  | beam outer tiles, hunt / boss | `avgHitsHuntOuter` / 0 |

- **Monsters:**
  - `input.monsters` takes precedence over `input.monster`. Weights are normalised and non-positive weights are dropped.
  - The element multiplier is the weighted average over the spot. Immune (0) makes a spell useless.
  - With no monster, the multiplier is 1.
- **Healing** (`healPerCast`, `healShare`):
  - Healing spells use the healing formulas and are valued on the defense side.
  - Team heals count ×0.5 in hunt and fully in boss mode.

### Defense (`values.ts`)

`def` is **% effective HP** (D18):

| Source | Value |
|---|---|
| +x max HP | `100 · x / HP` |
| +pp mitigation or dodge | `100 · pp / (100 − m)` (m = current mitigation) |
| Mitigation Multiplier | multiplies the real base mitigation, then valued as above |
| resistance | the same × `incomingShare(element)` (spot damage types; physical when unknown) |
| capacity, max mana | 0 |
| healing | healed HP × `HEAL_EHP` (0.5), as % of HP |
| Avatar damage reduction (boss) | `100 · uptime · r / (1 − r)` |
| life / mana leech | strongly devalued |

One uniform `threat = clamp(maxDamage / 1000, 0.6, 1.6)` scales all defense; there is no spike factor. HP beats Mitigation Multiplier per dedication point and per gem for every vocation (tested at levels 200–1500).

The rationale reports the ratio (`rationale.hpOverMitigation` / `rationale.mitigationOverHp`).

**Paladin uniques.** Ballistic Mastery: hunt (bow) +4 % pierce via `pierceDamageMod` against the spot's resistances; boss (crossbow) +10 % crit extra damage. Positional Tactics: 70 % of the time +3 distance, otherwise +3 holy and healing magic level. Both are exact rotation deltas.

**Avatar.** Worth 0 in hunt mode. In boss mode its uptime-scaled damage boost and damage reduction are valued, including its supreme mods and momentum.

**Revelations.** The value of stage s is the sum of:
- the rotation Δ with only that domain at stage s;
- passive effects (Gift of Life, Combat Mastery, Divine Empowerment, Blessing of the Grove);
- the flat Damage & Healing bonus.

**Revelation Mastery** (slice or supreme gem) is valued with look-ahead: `rev(stage(points + x)) − rev(stage(points))`.
- It is worth 0 unless it reaches the next stage.
- Owned RM gems count in the search. They are assigned to greater vessels (largest first), and their points are added to the domain as soon as the vessel unlocks.

**Gem Vessel slices** (D23) are valued as the slice's own +1 flat bonus plus the Hungarian placement gain of *owned* gems that the newly unlocked vessel lets the placement use. Recommended (hypothetical) gems are never assumed, so without owned gems a vessel slice is worth only its flat bonus.

### Stances (`stances.ts`, D24)

- Data: `src/data/damage/stances.ts` (`STANCES`, `stanceCombos`, `SERENE_UPTIME` 0.8, `NON_ADJACENT_SHARE` 0.3).
- Character: skill +% (Blood Rage 25, Sharpshooter 32, Virtue of Justice 8 × serene), shielding +30 % (Protector, via mitigation; EHP reference keeps the unstanced shielding).
- Spell model: element magic level (Divine Defiance 6 % distance → holy/healing, Elemental Synthesis 10 % ML → ice/earth), elemental stance bonus on natural spells (+4 % base fire, +4 % crit chance energy, +30 % crit extra death) and conversion (other spells take the element's sensitivity for min(1, element casts / other casts)), Exposed Weakness 8 % pierce, Harmony spenders ×(1 + 0.0478 × base pp), Protector damage ×0.85.
- Defense (`stanceDefense`, × threat, in `baseParts`): damage taken (Blood Rage +15 %, Protector −15 %, Sapped Strength −10 %), dodge 12 % × 30 %, healing (+10 % self / Sustain +35 % all × serene, healing ML) × heal share × K.HEAL_EHP.
- Pick (`pickStances`): per plan, the stance set with the highest blended `baseParts`; a preset's `stance` is fixed.

### Weapon proficiency (`proficiency.ts`, D46)

Optional `input.weapons`: the loadout enters `stanceBuilder` (attack, element magic level, perks after the
stances) and `valuationFor` (weapon skills before stance percentages; `v.weapon` sustain in `baseParts`).
Plans carry their weapon; the choice, re-choice and `result.weapon` are described in
[`proficiency.md`](proficiency.md#engine-d46).

## 3. Optimizer (`optimizer.ts`)

0. **Plans and forced spells.** One prepared valuation per plan (see Rotation). Forced spells (`input.forcedSpells`, D21) are seeded with a Dijkstra over slice capacities to their cheapest stage I augment, and every search starts from that seed. Messages: `rationale.forced`, `rationale.forcedImpossible`, `rationale.forcedNoAugment`.
1. **Tables.** Parts for each dedication point, conviction, augment I/II, revelation[domain][stage] and vessel[k], blended by priority. `blendTables` can rescale revelations for alternatives.
2. **Beam search.** `FULL_SEARCH` = width 24 with 8 completions; `LIGHT_SEARCH` = 12 with 2. With more than 2 plans, every plan is screened with the light search, then the best plan (and a runner-up within 2 %) gets the full search. A plan gated on a revelation whose search misses it gets a second full search with that revelation boosted ×10, so it is compared on a valid build (no bias: the choice uses the shared objective). Manual and auto mode share the offense reference. Screening uses width 8 / 1 completion. Refine and alternatives use the light search. Fills are full slices, deduplicated by allocation key.
   - Candidates are ranked without allocating (`rankOf` with a precomputed delta). Only the top 24 are materialised, and only the top 8 are greedily completed per level.
   - Rank = score + revelation-stage look-ahead + greedy-completion estimate. A partial last slice uses the remainder.
   - A budget ≥ total capacity has only one allocation, so the search returns the full wheel and no alternatives.
3. **Refine.** For each domain at stage 1–2, damp it (×0.2) and re-run the search. The result replaces the main build only if its exact objective under the main valuation is higher (and, in auto mode, the plan stays valid).
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
   - Each alternative picks its own best plan. `rationale.rotationAuto`, `rotationManual` and `rotationRequires` explain the rotation.
   - `relativeScore = 100 · objective(alt) / objective(main)`, under the main valuation. If any candidate search beats the main build (the beam is heuristic; seen up to 106 %), it is promoted to main in the same pass (alternatives too close to it are dropped), so `relativeScore ≤ 100`. Alternatives are sorted by `relativeScore` (desc).
   - The `alt.revelationFocus` label names every revelation at the alternative's highest stage (`A + B focus`); if two focus alternatives would still share a label, each lists all its active revelations (highest stage first).
   - `tradeoffMsg` (`alt.tradeoff`) lists the offense and defense deltas and the revelations.
6. **Planner code.** `encodePlannerCode` (strict) of the allocation (`gridForSliceId`) plus the owned vessel gems (D23).
   - Only slots matching the vessel quality are exported; vessels with `plannerVesselIssues` are skipped.
   - Tests decode the code, replay `path` against the unlock graph, and load it in the official planner WASM.
7. **Scores.** Offense and defense are normalised to the full wheel at stage 3 (0–100).

**Measured runtime** (warm, single thread, alternatives included):

| Budget | Time |
|---|---|
| 600 points | 9–15 ms |
| 3200 points, paladin hunt | 34 ms (21 ms without alternatives, 12 ms with a manual rotation) |
| worst case (perf test, 3200 points) | ~45 ms |
| full wheel | 3 ms |

- **Augment pair look-ahead.** While exactly one copy of an augment is full and the other is affordable, the rank adds stage II × `LOOKAHEAD_WEIGHT` (stage I can be worth 0, e.g. an unusable cooldown).

## 4. Gems (`gems.ts`)

- **Placement rule.** Maximise Σ blend(gem value in vessel) over a one-to-one assignment (Hungarian algorithm), using only each vessel's active slots.
  - Because active slots follow `min(gem, vessel)` quality, strong supreme gems end up in greater vessels and basic-only gems fill the lower vessels.
  - D23: a vessel holds only a gem the player owns. Unlocked vessels without an owned gem have `gem: null` and `source: 'empty'`; the engine never emits `source: 'recommended'`.
  - Locked vessels have `unlocked: false`, `gem: null` and `source: 'empty'`.
- **`gemRecommendations`.**
  - Per quality, at grade I (D26: a newly revealed gem): the best `basic1` (HP or Mitigation Multiplier only), the best distinct `basic2`, and the top-2 supreme variants for greater gems. Only mods with positive value are listed. Healing supreme gems (healing spell augments and cooldowns) are 0 for sorcerer and druid, and valued as EHP for the others.
  - Revelation Mastery (D26): `withRmReoptimized` re-runs the search (main plan, beam width 16) with a hypothetical greater grade-I gem owned, once without a supreme mod and once per RM mod. Gain = basics (static) + objective(with RM) − objective(without). Reason `gem.rmReopt` (new stage) or `gem.rmReoptFree` (same stage, freed points). Avatar RM skipped outside boss mode; skipped when the wheel is full.
  - Advice only (D23): computed for all three qualities (with or without owned gems) and never placed into a vessel or used by the search.
  - Each has `reason` and `reasonMsg` from the dominant mod (spell share, avatar in boss, RM stage gained, resistance vs monster, and so on), sorted by gain.
- **`upgradeRecommendations`.**
  - Only owned gems, only active slots, and only +1 grade; empty (D26) while an unlocked vessel has no gem.
  - D27: one entry per mod (`kind`, `modId`, `gems` = owned gems with it); grades are shared by the character (`withSharedGrades` normalizes input gems to the highest grade per mod), so the gain sums over every placed gem with the mod. Recommended gems carry the character's grade for a mod (`GemEnv.grades`).
  - Supreme spell mods are valued with the build's wheel effects on the other spells in both sides of the delta (`spellBundleParts(..., others)`): a cooldown cut is worth nothing when the preset rotation is ratio-bound.
  - `gain = blend(grade + 1) − blend(grade)`, with momentum included for cooldown mods, sorted descending.
  - `gainToMax = blend(IV) − blend(grade)`.

## 5. i18n

- `rationaleMsgs`, `SpellUsage.reasonMsg`, `GemRecommendation.reasonMsg` and `StatLine.labelMsg` carry `{ key, params }`.
- Keys are `rationale.*`, `spell.*`, `gem.*` and `stat.*`, and are listed in `ENGINE_MESSAGES` (English templates with `{param}` placeholders).
- The plain `rationale`, `reason` and `label` strings stay in English.
- The UI translates `engine.<key>` (PL and EN in `src/i18n/`) and the id params (elements) through `engineText()`.
- `rationale.threat` and `rationale.threatMax` are separate keys, so no English fragment ends up in a param.
- `renderMessage` fills placeholders and leaves unknown ones as they are.

## 6. Assumptions

- The rotation is a single-slot model (presets with ratios, or greedy in boss mode), with no mana limits and no movement.
- The Avatar's boss window is 120 s per 30 min.
- Hunt targets (community averages), `maxTargets` and monk elements are approximate (S1).
- Single-target spells are ignored in hunt mode (D16).
- 1 % effective HP is weighted like 1 % damage; `HEAL_EHP`, threat and leech factors are heuristics. Base mitigation comes from `src/data/character`.
- Momentum is valued as a cooldown proxy.

## 7. Tests

| File | Covers |
|---|---|
| `model.test.ts` | Geometry, the directed unlock graph matches `WHEEL_DATA`, twins, vessels and mods, thresholds, messages. |
| `spells.test.ts` | Targets (community averages, hunt > boss), D16 (single-target unusable in hunt, boss targets ≤ 1.2, no Augmented Annihilation in hunt), immune → useless, Avatar, cooldown floor, momentum, effect parsing, augments. |
| `gems.test.ts` | Hungarian vs brute force, active slots, placement, recommendations, upgrades, Mitigation Multiplier scaling with real base mitigation. |
| `gemSteps.test.ts` | D26: upgrades only with every unlocked vessel filled; RM gem re-optimization (owning the gem reaches the predicted stage), no avatar RM in hunt. |
| `optimizer.test.ts` | Path validity on random inputs, RM, vessel unlock order, augments, determinism, edge budgets, priority, perf < 50 ms (best of 3 per input), planner reference builds. |
| `iteration3.test.ts` | Character level and skills, HP > mitigation (RP 400), HP still beats Mitigation Multiplier for EK 1500 at priority 100 (D18), leech devalued, RM look-ahead and owned RM gem, multi-monster weighting, distinct alternatives, planner code decode and unlock path, official planner WASM round-trip (`skipIf` when `scripts/.cache/wod/skillgrid.cjs` is missing). |
| `iteration5.test.ts` | D23: no `recommended` vessel source (main + alternatives, planner code carries only owned gems), recommendations without owned gems, vessel slice = flat bonus without gems, owned-gem vessel valuation matches the placement, owned gems placed in the build; distinct focus labels. |
| `iteration4.test.ts` | D18 (RP 600 lesser = HP, no capacity/mana gems, HP > mitigation for all vocations 200–1500, no healing gems for mages); D20 (non-beam rotation for a low-level sorcerer, beams only with Beam Mastery, Wrath of Nature vs an earth-weak spot, Divine Grenade in the rotation iff active, manual rotation); transit augments = 0; forced augment taken or reported impossible. |

## Gain effects (D55)

Gem recommendations, upgrades (`effect`, `effectToMax`), weapon picks and reshapes carry `effect: GainEffect`
(`effectOf` in `gems.ts`): `dmg` = the unblended `Parts.off` (% damage per turn), `ehp` = `Parts.def / threat` (% effective HP).
The blended `gain` / `delta` stays the ranking value. Replacement gems subtract the weakest placed gem's effect;
re-optimized Revelation Mastery gems add the regular basics' effect to the with/without wheel difference
(`objectiveParts`). Weapons use `loadoutValuer` (unblended `loadoutScorer`).

D58: `BuildResult.wheelEffect` = `effectOf(v, rawTotals(..., withBase = false))`, i.e. what the wheel and its gems add over an
empty wheel. `offenseScore` / `defenseScore` (share of the full-wheel maximum) stay for alternatives only.

D60: after a full beam search, `improveSwaps` tries 1-for-1 swaps of a full slice for an empty slice of the same
capacity (rebuilt with `replay`, must stay connected) and keeps strict improvements (up to 4 rounds). Fixes e.g. a
Revelation Mastery slice whose points cross no threshold chosen over the skill boost next to it.

D61: `rationale()` adds a `rationale.unique*` line for every full unique slice on the path: a per-perk description and
`gain` = `effectOf(v, convP[i])` (non-zero parts only, e.g. "+3% damage, +0.3% EHP"; the UI translates "damage").
Below 0.05 in both parts it emits `rationale.uniquePath` (filled for dedication points / as a step outwards).
