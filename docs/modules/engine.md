# Engine module (`src/engine`) — Wheel model & optimizer

Owner: **S2 Engine**. Public API (`src/engine/index.ts`):

| Export | Purpose |
|---|---|
| `getWheel(vocation): WheelDefinition` | 36 slices + 4 revelations for a vocation (cached, treat as read-only). |
| `optimize(input): OptimizerResult` | Best allocation for points / monster / priority. Deterministic, ~2–6 ms. |
| `pointsForLevel(level, scrollPoints = 0)` | `max(0, level − 50)` (+ 0–50 scroll points, only from level 51). |
| `MIN_LEVEL_FOR_POINTS`, `MAX_SCROLL_POINTS` | 50 / 50. |
| `getEngineWheel`, `isAvailable` | Internal model + unlock rule (used by tests). |

Files:

```
src/engine/
  index.ts            public API
  optimizer.ts        beam search, result assembly, stats, rationale
  scoring.ts          priority blend, monster tailoring, score tables
  wheel/geometry.ts   36-slot layout, angles, adjacency builder
  wheel/perks.ts      perk value model + perk factories
  wheel/build.ts      geometry + vocation data -> EngineWheel / WheelDefinition
  wheel/vocations/    knight.ts paladin.ts sorcerer.ts druid.ts monk.ts (+ shared.ts, types.ts)
  geometry.test.ts    invariants × 5 vocations
  optimizer.test.ts   path validity, budget, priority, monster, perf
```

## 1. Sources

| Fact | Source | Status |
|---|---|---|
| 36 slices, 9 per domain, capacities 50/75/75/100/100/100/150/150/200 (1000 per domain) | canary `wheel_definitions.hpp` (`WheelSlots_t`), `PlayerWheel::getMaxPointsPerSlot` | verified (server emulator mirroring the client) |
| Unlock rule & adjacency | canary `PlayerWheel::canPlayerSelectPointOnSlot` / `canSelectSlotFullOrPartial` | verified |
| Dedication per point (HP/mana/capacity/mitigation) and conviction of every slot, per vocation | canary `io_wheel.cpp` (`slotGreen200` … `slotPurple200`) | verified (monk: canary only) |
| Revelation thresholds 250 / 500 / 1000 | tibia.fandom.com *Version 13 Updates*, tibiaqa.com, canary | verified |
| Revelation flat bonus +4 / +9 / +20 damage & healing | canary `io_wheel.hpp` | verified |
| Revelation perk names per vocation/domain | canary `applyRedStageBonus` / `applyPurpleStageBonus` / `applyBlueStageBonus` | verified |
| Points = level − 50 (1/level from 51); scrolls 3+5+9+13+20 = 50 | tibiaqa.com, canary `wheel_scrolls.lua` (one community source lists revised = 8) | verified |
| Numeric *value* of each perk (off/def units) | engine estimate | **approximate** |
| Monk spell elements & passives | engine estimate | **approximate** |

URLs: <https://github.com/opentibiabr/canary> (`src/creatures/players/components/wheel/`, `src/io/io_wheel.cpp`),
<https://tibia.fandom.com/wiki/Version_13_Updates>, <https://www.tibiaqa.com/33683/how-do-promotion-scrolls-work>.

> Correction vs. the initial assumption (rings 4×50, 8×75, 12×100, 12×150 = 3600): the real wheel has
> **5 rings** — 4×50, 8×75, 12×100, 8×150, 4×200 = **4000** points. A full domain is exactly 1000, i.e.
> revelation stage 3 requires a completely filled domain (gems' *Revelation Mastery* can add domain points
> in-game; not modelled).

## 2. Geometry

Domain colours (canary): green = topLeft, red = topRight, purple = bottomRight, blue = bottomLeft.
`indexInRing` counts clockwise from 12 o'clock; topRight = 12→3, bottomRight = 3→6, bottomLeft = 6→9, topLeft = 9→12.

```
                         12 o'clock
              topLeft (green)  |  topRight (red)
                               |
   ring 5  [200]               |               [200]           4 × 200
   ring 4    [150][150]        |        [150][150]             8 × 150
   ring 3      [100][100][100] | [100][100][100]              12 × 100
   ring 2          [75][75]  <-|->  [75][75]                   8 × 75
   ring 1              [50]    |    [50]                       4 × 50
  9 ---------------------------+--------------------------- 3
   ring 1              [50]    |    [50]
   ring 2          [75][75]  <-|->  [75][75]
   ring 3      [100][100][100] | [100][100][100]
   ring 4    [150][150]        |        [150][150]
   ring 5  [200]               |               [200]
              bottomLeft (blue)|  bottomRight (purple)
                               6
   <-> = rings 2 and 3 touch across domain borders (cross-domain unlock)
```

| Ring | Slices | Per domain | Capacity | Angular width |
|---|---|---|---|---|
| 1 | 4 | 1 | 50 | 90° |
| 2 | 8 | 2 | 75 | 45° |
| 3 | 12 | 3 | 100 | 30° |
| 4 | 8 | 2 | 150 | 45° |
| 5 | 4 | 1 | 200 | 90° |

Slice ids are canary-style and identical for all vocations: `green-50`, `green-bottom-75`, `green-top-75`,
`green-bottom-100`, `green-middle-100`, `green-top-100`, `green-bottom-150`, `green-top-150`, `green-200`, …
("top/bottom" refer to canary's 6×6 grid; for green/red "top" is the 12 o'clock side).

### Adjacency rule (builder in `geometry.ts`)

1. **Radial**: slices of rings *r* and *r+1* are adjacent when their angular spans overlap (> 0°).
2. **Lateral**: neighbouring slices of the same ring (index ±1) are adjacent inside a domain for rings 2–4;
   across a domain border only in rings 2 and 3. Ring 1 slices are not adjacent to each other.
3. The result is symmetric and equals the symmetric closure of canary's prerequisite lists (tested).

**Unlock rule**: a slice can receive points if it is in ring 1, or **any adjacent slice is full**
(canary checks every listed neighbour, including same-ring and cross-domain ones). Revelation domain points =
sum of points in the domain's 9 slices (partial slices count).

## 3. Per-vocation data

### Dedication (per point, verified — canary)

| Kind | Knight | Paladin | Sorcerer | Druid | Monk |
|---|---|---|---|---|---|
| HP | 3 | 2 | 1 | 1 | 2 |
| Mana | 1 | 3 | 6 | 6 | 2 |
| Capacity | 5 | 4 | 2 | 2 | 5 |
| Mitigation | 0.03 % | 0.03 % | 0.03 % | 0.03 % | 0.03 % |
| 200-slices | HP + mana | HP + mana | HP + mana | HP + mana | HP + mana |

### Slot layout (dedication → conviction), identical for every vocation

| Slot | Green (TL) | Red (TR) | Purple (BR) | Blue (BL) |
|---|---|---|---|---|
| 50 | cap → Vessel | mitig → **Spell A** | HP → Vessel | mana → **Spell B** |
| 75 (G,R,P: top · B: bottom) | mana → Life leech 0.75% | cap → Vessel | mitig → Skill +1 | HP → Vessel |
| 75 (G,R,P: bottom · B: top) | mana → Skill +1 | cap → Life leech | mitig → Mana leech 0.25% | HP → Mana leech |
| 100 side A | HP → Vessel (top) | mana → Skill +1 (top) | cap → **Spell C** (top) | mitig → Skill +1 (bottom) |
| 100 middle | HP → **Spell C** | mana → **Spell E** | cap → **Spell D** | mitig → **Spell E** |
| 100 side B | HP → **Spell D** (bottom) | mana → Vessel (bottom) | cap → Vessel (bottom) | mitig → Vessel (top) |
| 150 top | mitig → Mana leech | HP → Vessel | mana → Vessel | cap → Life leech |
| 150 bottom | mitig → Vessel | HP → Mana leech | mana → Life leech | cap → Vessel |
| 200 | HP+mana → **Passive G** | HP+mana → **Spell B** | HP+mana → **Passive P** | HP+mana → **Spell A** |

Each spell group appears in two slices: the first full slice grants augment **I**, the second **II**.

### Spells, passives and revelations (names verified; value units approximate)

| | Knight | Paladin | Sorcerer | Druid | Monk ≈ |
|---|---|---|---|---|---|
| Spell A | Fierce Berserk (phys, off 4.5) | Divine Caldera (holy, 4.5) | Great Fire Wave (fire, 4) | Heal Friend (heal, def 2.5) | Flurry of Blows (phys, 4.5) |
| Spell B | Front Sweep (phys, 3.5) | Sharpshooter (off 3) | Hell's Core / Rage of the Skies (fire+energy, 5) | Strong Ice Wave (ice, 4.5) | Sweeping Takedown (phys, 4) |
| Spell C | Groundshaker (phys, 4) | Strong Ethereal Spear (phys, 4) | Magic Shield (def 4) | Mass Healing (def 3.5) | Mass Spirit Mend (def 3.5) |
| Spell D | Intense Wound Cleansing (def 3.5) | Swift Foot (support) | Energy Wave (energy, 4) | Terra Wave (earth, 4) | Chained Penance (phys, 3.5) |
| Spell E | Chivalrous Challenge (support) | Divine Dazzle (support) | Sap Strength (def 2) | Nature's Embrace (def 3) | Mystic Repulse (support) |
| Passive G (green-200) | Battle Instinct | Positional Tactics | Runic Mastery | Healing Link | Guiding Presence ≈ |
| Passive P (purple-200) | Battle Healing | Ballistic Mastery | Focus Mastery | Runic Mastery | Sanctuary ≈ |
| Rev. topLeft (green) | Gift of Life | Gift of Life | Gift of Life | Gift of Life | Gift of Life |
| Rev. topRight (red) | Executioner's Throw | Divine Grenade | Beam Mastery | Blessing of the Grove | Spiritual Outburst ≈ |
| Rev. bottomRight (purple) | Avatar of Steel | Avatar of Light | Avatar of Storm | Avatar of Nature | Avatar of Balance |
| Rev. bottomLeft (blue) | Combat Mastery | Divine Empowerment | Drain Body | Twin Burst | Ascetic ≈ |

Other convictions: Skill +1 (melee / distance / magic level / fist; off 2, mages 3), Life leech +0.75 % (def 2.5),
Mana leech +0.25 % (off 1, def 1, util 0.5), Vessel Resonance (off 1, def 1, util 2; tagged with all elemental
resistances because gems provide them — **approximate**).

## 4. Scoring

Every perk carries a vector `v = (off, def, util, offElements?, defElements?)`, in units where 1 ≈ +1 % effective
damage or survivability (**approximate** estimates).

**Dedication per point** (vocation-independent in value units, because per-point HP/mana scale with the vocation's
base HP/mana): HP `def 0.03`; mana `off 0.015, def 0.01`; capacity `util 0.01`; mitigation `def 0.03`;
HP+mana `off 0.015, def 0.04`.

**Revelation stage k** (k = 1..3): `v_k = base × [0.35, 0.6, 1][k] + flat_k × 0.25` on both off and def, with
`flat = 4 / 9 / 20`.

**Priority blend** (`p = priority / 100`):

```
wOff = max(0.05, 1 − p)     wDef = max(0.05, p)     wUtil = 0.1
```

**Monster tailoring**:

```
offMult(v) = mean_{e ∈ v.offElements} (elementModifier(e) / 100)^2     (1 if untagged or no monster)
defMult(v) = 0.6 + 0.8 × |monster.damageTypes ∩ v.defElements| / |monster.damageTypes|   (1 if untagged)
threat     = clamp(maxDamage / 1000, 0.6, 1.6)                          (1 if unknown)

value(v) = wOff · off · offMult + wDef · def · defMult · threat + wUtil · util
```

Squaring the modifier makes a 150 % weakness worth 2.25× and an immunity worth 0 — strong enough to swap
which spell augment is taken.

**Score of an allocation** `a` (points per slice):

```
S(a) = Σ_i a_i · ded_i  +  Σ_{i full} conv_i  +  Σ_d rev_d[stage(domainPoints_d)]
stage(x) = #{t ∈ [250, 500, 1000] : x ≥ t}
```

**Reported scores**: `offenseScore = round(100 · Off(a) / Off(fullWheel))`, same for defense, where Off/Def are the
monster-tailored but un-blended totals.

## 5. Search algorithm

1. `budget = min(points, 4000)`; precompute scalar tables `ded[i]`, `conv[i]`, `rev[d][stage]`.
2. **Beam search** (width 24) over *full-slice fills*: each step expands every beam state by filling one
   available slice whose capacity fits the remaining budget; states are deduplicated by the bitmask of full slices.
3. **Ranking** (only for pruning):
   `rank = S + Σ_d 0.6 · Δrev_d · progress_d + remaining · density`, where `progress_d` is the fraction of the way
   from the previous to the next revelation threshold (only if still reachable with the remaining budget), and
   `density` = mean value-per-point over all slices — this makes states with different spent points comparable and
   is the revelation look-ahead.
4. **Completion**: every state kept in the beam is completed greedily (best gain/point among available slices,
   including revelation deltas); when the leftover is smaller than the chosen slice's room it is partially filled
   and becomes the last path entry. The best completed state wins.
5. Ties break by bitmask key → fully deterministic.

Complexity: ≤ 36 steps × 24 states × 36 candidates ≈ 31 k expansions (O(36) each) + 24 greedy completions per
step (O(36²) each). Measured 2–6 ms per call (budget test asserts < 50 ms).

The `path` is the fill order of the winning state; every entry was unlocked when it was started, all but the last
are full.

## 6. Assumptions & limitations

- Premium + promotion assumed; `pointsForLevel` ignores scrolls unless passed.
- Gems, fragments, gem mods and *Revelation Mastery* bonus points are not modelled (Vessel Resonance has a flat value).
- Spell-augment effects are modelled as value units, not exact spell numbers.
- Mitigation is treated as untagged (applies to all damage types).
- Monk data is from canary and partly estimated; marked "approximate" in perk descriptions.
- Optimizer is heuristic (beam), not proven optimal; it never violates connectivity or the point budget.

## 7. Work log

- 2026-11-18 — Researched mechanics: wiki pages are paywalled (HTTP 402); used tibiaqa.com/fandom search summaries
  and the canary server sources (slot enum, capacities, prerequisites, per-slot bonuses, revelations). Found the
  5-ring / 4000-point layout (not 4 rings).
- Built geometry builder (angles → adjacency), per-vocation data files, perk value model, scoring with monster
  tailoring, beam-search optimizer with revelation look-ahead and partial last slice.
- Tests: 48 engine tests (geometry ×5 vocations, random path validity, budget, priority shift, monster weakness,
  perf). `tsc -b` clean.
