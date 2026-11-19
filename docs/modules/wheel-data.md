# Wheel data (S1 Data, iteration 2)

## Purpose

Static, verified facts about the Wheel of Destiny for all 5 vocations: the 36 slices (dedication +
conviction perks), unlock graph, revelations, gem vessels, gem mods, momentum and Revelation Mastery
rules, plus spell metadata used by the engine to value augments in a fight context (D7–D9).

## Files

| File | Role |
|------|------|
| `scripts/extract-wheel.mjs` | `npm run extract:wheel` — runs the official planner WASM in Node, verifies rules empirically (throws on any failed assertion) and writes the JSON. |
| `scripts/.cache/wod/` (gitignored) | `skillgrid.cjs` (planner WASM module), `SkillwheelStringsJsonLibrary.json` (texts), `wheelofdestinyplanner.min.js` (UI reference only). |
| `scripts/.cache/hunt-data/` (gitignored) | `spellAverageHitsData.json`, `rotationPresetsData.json`, `wheelTemplatesData.json` from community data. |
| `src/data/wheel/wheel-data.json` | Generated dataset (committed; facts only, no CipSoft code). |
| `src/data/wheel/wheel-data.d.json.ts` | Types the JSON import as `WheelDataFile`. |
| `src/data/wheel/types.ts` | Internal types (`WheelTile`, `WheelRevelation`, `WheelBasicMod`, `WheelSupremeMod`, `SpellMeta`, …). |
| `src/data/wheel/spells.ts` | Hand-curated spell metadata table (`SPELLS`). |
| `src/data/wheel/index.ts` | Public API: `WHEEL_DATA`, `getWheelData(vocation)`, `SPELLS`, `getSpell(name)`, `getWheelSpellNames(vocation)`. |
| `src/data/wheel/wheel.test.ts` | Vitest checks. |

`src/data/wheel` is imported directly (`import { getWheelData } from '../data/wheel'`), independently of the
lazy-loaded monster chunk.

## Re-downloading the inputs (manual, Cloudflare)

test.tibia.com and the community data pages are behind Cloudflare, which blocks scripted downloads. Use a normal browser:

1. Open the planner on the test server (`https://test.tibia.com/...subtopic=wheelofdestinyplanner` or the
   live tibia.com library page once released). Open DevTools → Network, reload.
2. Save the responses of `skillgrid.js` (Emscripten loader with embedded/adjacent WASM) as
   `scripts/.cache/wod/skillgrid.cjs`, `SkillwheelStringsJsonLibrary.json` and
   `wheelofdestinyplanner.min.js` into `scripts/.cache/wod/`. If the WASM is a separate `.wasm` file, save it
   next to `skillgrid.cjs` with the same name the loader requests.
3. On the community data pages (spell average hits / wheel templates pages) save the JSON responses
   `spellAverageHitsData.json`, `rotationPresetsData.json`, `wheelTemplatesData.json` into
   `scripts/.cache/hunt-data/`.
4. `npm run extract:wheel`, then `npx vitest run src/data`.

Planner API notes: `require('skillgrid.cjs')()` resolves to the module; `new M.SkillwheelPlanner(M.EActiveVocation.Knight)`.
Embind vectors must be `.delete()`d, planners too. `onModChange(slot 1|2|3, modKey, vesselId)` (slot 3 = supreme);
the planner always uses grade IV for mods. `updateByCode` returns -1 (invalid), 0 (older code format) or >0.

## Schema (`WheelDataFile`)

- `grid` — 6×6, quarters `TL TR BL BR` → `Domain`, `ringByCapacity {50:1,75:2,100:3,150:4,200:5}`.
- `unlockGraph` — `initiallyUnlocked: [14,15,20,21]`, `edges[gridId]` = slices unlocked when that slice is
  **completely** filled (partial points unlock nothing). Identical for all vocations.
- `revelation` — `thresholds [250,500,1000]`, `damageHealingBonusPerStage [0,4,9,20]`.
- `revelationMastery`, `augmentStacking`, `vessels` (list, rule, gem names), `momentum`, `dedicationPerks`, `texts`.
- `vocations[v]`:
  - `tiles[36]` — `gridId, tileName (QTL0..QBR8), quarter, domain, row, col, ring, capacity, initiallyUnlocked,
    isGemVessel, dedication {smallPerkId, perks[{id,name,perPoint}]}, conviction {id, category, value, name,
    description, numericValue/displayValue, augment {subject, spells, stage1, stage2}, revelationPoints}`.
  - `revelations[4]` (index = quarter) — `name, largePerkId, description` (with `a/b/c`), `stageTexts[3]`,
    `stageValues[{display, values}]`, `spells` (granted), `affectsSpells` (Beam Mastery), `isAvatar`.
  - `vessels[8]` — `id, vesselLevel, quality, unlockOrder, gemName`; `gemVesselTiles`.
  - `mods.basic[]` — `id, name, slots ([1]/[2]/[1,2]), effects[{name, display[4], values[4]}], gradeValues[4]`
    (values are vocation-specific, e.g. Hit Points).
  - `mods.supreme[]` — `id, name, category (effect | augDamage | augCrit | augCooldown | augHealing |
    revelationMastery), spell, revelation, gradeValues[4], values[4], momentum?[4]`.
  - `referenceBuilds` — community templates: recommended lesser/greater gems and decoded builds
    (`points, description, code, legacyCode, spent, tiles {gridId: points}, vessels, revelationStages`).
  - `verification` — raw outputs of the empirical checks.

Texts have HTML stripped; numbers are parsed where possible, display strings kept.

## Verification findings (all asserted by the script)

- **Grid:** 36 slices per vocation, 4×50, 8×75, 12×100, 8×150, 4×200 = 4000; 1000 per domain. Layout of perk
  *types* is identical for all vocations (same tiles hold Gem Vessel, RM, leech, skill, augments).
- **Unlock graph:** derived per vocation (for each slice Y, greedily fill everything that does not unlock Y;
  slices whose fill unlocks Y are its in-edges) — identical for all 5 vocations. Outer corners unlock nothing.
- **Revelations:** stage 1/2/3 at 250/500/1000 domain points. Flat damage & healing = Σ over domains of
  `[0,4,9,20][stage]` (verified on random full fills).
- **Revelation Mastery:** each filled RM slice (perk 46, one per domain) adds **125** points to its *own* domain's
  revelation; supreme RM gem mods add 150/165/180/225 (grade I–IV) to the named revelation. They count only
  toward thresholds (corner points), not toward the 4000 grid points.
- **Augment stacking:** each augment appears on exactly 2 slices; first filled copy = stage I, second = stage II
  (cumulative), regardless of order (planner summary value 1 → 2).
- **Dedication:** per-point increments per vocation (e.g. knight HP 3, mana 1, cap 5); smallPerkId 2 = HP + mana;
  mitigation 0.075 %/point (planner stores hundredths, truncated: `floor(points·7.5)/100`). Totals cross-checked
  on a full wheel.
- **Vessels:** 8 vessels with fixed qualities `lesser, regular, greater, lesser, greater, regular, greater, greater`;
  vessel *n* unlocks when *n+1* Gem Vessel slices are filled, independent of which (3 random orders tested).
  Each filled Gem Vessel slice adds +1 flat damage & healing (`getVesselsDamageAndHealingBonus`).
- **Momentum:** supreme cooldown mods: cooldown fixed across grades, momentum chance 0/0.33/0.66/1 % for grades I–IV, additive.
- **Mods:** 46 basic mods (ids 32, 42, 43 are empty in the config); slot 1 accepts 20 (HP/mana/cap/mitigation and
  their hybrids, single elemental resistances), slot 2 accepts ids 0–29 (resistances). 27 supreme mods per vocation.
- **Reference builds:** community codes are in the old format (`legacyCode: true`); the planner still decodes them
  (slice points only, no gems). Treat their slice meanings with care.

## Spells (`spells.ts`)

57 spells: every spell named by an augment (group augments expanded: *Special Spells* → Lightning, Strong
Energy Strike, Strong Flame Strike; *Focus Spells* → Hell's Core, Rage of the Skies; *Forked Spells* → Forked
Thorns, Forked Glacier), a revelation (Twin Bursts → Ice Burst + Terra Burst; Beam Mastery affects both great
beams) or a supreme mod. `isNew` = introduced by the 2026 Vocation Adjustments update: Shield Slam, Divine
Barrage, Ethereal Barrage, Death Echo, Forked Thorns, Forked Glacier, Thousand Fist Blows (Lord of Destruction is
a new *passive* revelation, not a spell). `avgHitsHunt` from community data; beams carry `avgHitsHuntOuter`.

## Attribution

Average target counts and reference builds: community hunting data (spell average hits, wheel
templates). Wheel facts: official Tibia Wheel of Destiny planner (CipSoft). The binary and strings are never committed.

## Limitations

- `maxTargets` is an estimate for most area spells; monk spell elements are assumed physical (`approximate: true`).
- Values come from the **test server** and may change before release; re-run the extraction after updates.
- The planner uses grade IV for all mods; lower grades come from the strings file only.
- community builds predate the new layout (`legacyCode`).

## Planner export code

Build ↔ official planner code/URL (pure TS, byte-identical to the planner): see [planner-code.md](planner-code.md).
