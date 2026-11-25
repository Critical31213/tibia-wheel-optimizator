# UI module

## Purpose

Single-page React UI: the user picks a vocation, character level / promotion points / skills, a hunting spot (several
weighted monsters) and a DPS ↔ survivability priority; the optimized wheel build (plus up to 2 alternatives) is
recomputed live (no "Calculate" button) and shown as an SVG wheel plus a text
breakdown. Polish / English UI (switch top-right), dark "Tibian" theme, works from 360 px wide; on `lg`
screens it is two columns (controls left, results right).

## Files owned

| File | Role |
|------|------|
| `src/App.tsx` | Layout, state wiring, memoized `optimize` call. |
| `src/components/Panel.tsx` | Bordered section card with numbered heading; D109: a "?" next to the heading shows the section tutorial (`help.<headingId without -heading>`) on hover / focus, under the heading across the panel width. |
| `src/components/VocationPicker.tsx` | 5 toggle cards, `radiogroup`. |
| `src/components/VocationIcon.tsx` | Stroke icon per vocation. |
| `src/components/CharacterPanel.tsx` | One row: level, extra points (D54: scrolls, weekly, bounty, gem upgrades; 0–1000, `scrolls` field), points (override); per-vocation skills in 3 columns (empty = "auto"); knights: a separate "trained skill" segmented row (any / sword / axe / club icons, D51/D54, `meleeSkill`, other weapon types skipped). |
| `src/components/MonsterSearch.tsx` | Hunting spot: debounced ARIA combobox adding monsters (max 10), weight per monster, remove; `MonsterCard` for one, weighted combined chips for several. |
| `src/components/BuildSwitcher.tsx` | "Best build · Alt 1 · Alt 2" toggle + alternative label, trade-off, relative score. |
| `src/components/ExportPanel.tsx` | Planner code of the viewed build: read-only field, Copy code / Copy planner link / Open planner. |
| `src/lib/monsters.ts` | `resolveMonsters`, `combinedModifiers` (weighted average, missing = 100), `combinedDamageTypes` (tested). |
| `src/lib/planner.ts` | Re-exports `PLANNER_URL`/`plannerUrl(code)` from `src/data/wheel/plannerCode` (single source); `copyText` (Clipboard API → `execCommand` fallback) (tested). |
| `src/components/MonsterCard.tsx` | Name, HP/exp, element chips, damage types. |
| `src/components/DebugCopy.tsx` | Temporary (D60): link under "Equipment" copying the exact `OptimizerInput` as JSON (textarea fallback) so a reported build can be reproduced. |
| `src/components/Gain.tsx` | D55: a gain shown as `±x% dmg` (offense colour) and `±y% EHP` (defense colour), negatives red, parts below 0.05 hidden; the blended optimizer score only in the tooltip (shown as `pts` when neither part is visible, e.g. utility). Used for gem recommendations, upgrades (and to IV), weapon ranking, reshapes and suggestions. |
| `src/components/NotesPanel.tsx` | D54: collapsed "For the curious" section at the end of the page with the descriptive hints (extra points, skills, knight skill, fight mode, monster weight, weapon grid, proficiency assumptions, units, storage); icons credit moved to the footer. |
| `src/components/PrioritySlider.tsx` | D91: five fixed steps (`PRIORITY_STEPS` 0/25/50/75/100 = DPS–survivability 100–0 … 0–100) on a range slider with `step` 25 and tick marks (no own panel since D54, rendered inside `FightContextPanel`). |
| `src/components/WheelChart.tsx` | D106: the wheel drawn like the official planner (test server) on a canvas: its backdrop, vocation front, corner art and perk icon sheets (`public/wheel/`, © CipSoft GmbH) with the planner's ring geometry, domain colours (unlocked / filled, additive) and icon placement; tooltips for slices and revelation corners (stage, points, next stage); revelation legend below. |
| `src/components/VesselGems.tsx` | D106: the build's vessels under the wheel as planner sockets (gem sprite = vocation × quality, empty socket by vessel quality); gem name, mods and idle mods on hover / focus. |
| `src/components/ResultsPanel.tsx` | D58: what the wheel adds (`wheelEffect`: % damage, % EHP vs an empty wheel) instead of the 0–100 bars (share of the theoretical full-wheel maximum, misleading), convictions grouped (`groupConvictions`: "3 × Gem Vessel", augment tier I hidden when tier II is taken), stats; revelations moved into the `WheelChart` legend (all four domains, stage dots, points, next stage). D57: `BuildRationale` ("Why this build") is its own full-width panel at the end of the page, above "For the curious"; the fill order list was removed. |
| `src/components/SegmentedControl.tsx` | Generic compact `radiogroup` (roving tabindex, arrows/Home/End, `disabled`). |
| `src/components/FightContextPanel.tsx` | D54 "Fight" panel: Hunt / Boss toggle (hunt style removed, D20) and the priority slider. |
| `src/components/RotationPanel.tsx` | Rotation select (Auto + vocation presets, note / requirements), used rotation of the viewed build (auto-attack share first (D51), then spells: share %, ★ = revelation spell, auto-picked), stance select (Auto / manual set, D32; prefs key `st`), stances of the viewed build (D24), two columns: forced spell augments (select + chips with stage I/II toggle, D35) and forced revelation stages (select per revelation; unreachable stages disabled with an RM gem / upgrade / out-of-reach note). Prefs keys `fs2`, `fr`. |
| `src/hooks/usePersistentSpellPrefs.ts` | `rotationId` + `forcedSpells` per vocation (localStorage) mirrored to URL `r` / `fs`. |
| `src/lib/spellPrefs.ts` | Spell-prefs sanitising + URL / JSON codec (tested). |
| `src/components/GemsPanel.tsx` | Collapsible "My gems" editor in Lesser / Regular / Greater subsections (mods per slot, grade I–IV), empty-vessel highlight. |
| `src/components/GemImport.tsx` | D63: toolbar at the top of "My gems": import button (multiple image files, Ctrl+V while the panel is open) → `readGems` per screenshot, duplicates of a page skipped, `mergeImported`; result line (added / to check / skipped / unrecognised); ambiguous gems get an amber "check" note in their card until edited. Trash icon with inline confirmation removes all gems. |
| `src/components/EquipmentPanel.tsx` | D74: "Equipment" (step 6): paper doll (worn item from `result.gear`, owned count), slot editor in a modal window with the owned items (tier, imbuements, worn mark, add / remove); the weapon slot holds `OwnedWeapons` (proficiency); bonus totals. See [`equipment.md`](equipment.md). |
| `src/components/OwnedWeapons.tsx` | D47 (in the Equipment weapon slot since D76): "My weapons": weapon search (combobox, vocation's weapons with a known tree; knights with `meleeSkill` only that type, D53), per weapon proficiency level 0–n, compact tree (D50: one column of official perk icons per level, click = manual pick with a gold frame, again = Auto; locked levels dimmed; ✦ = reshaped slot; icon legend below) and dust reshapes (shaping option at rank 10 + replaced option, at most 2). D62: knight/monk weapon cards (and the best weapon) show the damage types on their own line (main element, or "physical 25 + fire 26"); proficiency level select sized to its text. |
| `src/components/Tip.tsx` | D52: hover / focus tooltip (aligned start / center / end so edge tooltips stay in the card). |
| `src/components/PerkIcon.tsx` | D50: perk icon from `public/proficiency/` (sprite strip frame; augment mark in the corner), decorative. |
| `src/components/WeaponResultPanel.tsx` | D47: best weapon with its perks as an icon row (D56: with manual picks that the engine beats, an amber note lists the changed levels old → new icon, the gain and "Apply", which writes the engine picks into the manual levels) (tooltip: effect, picked / your choice; gold frame = manual; alpha strike marked "solo play only"), ammunition, other owned weapons (difference), worthwhile reshapes, collapsible "better weapons you do not own" (opening it sets `suggestWeapons`). D62: ammunition shown with its element. |
| `src/hooks/usePerVocationStorage.ts` | Generic per-vocation localStorage value; `usePersistentGems`, `usePersistentWeapons` (D47: owned weapons + suggest flag), `usePersistentGear` (D74). Not in the URL. |
| `src/lib/weapons.ts` | D47: weapon prefs sanitising / codec, `setPerk`, `setShaped`, `perkLabel`, `shapingLabel` (tested). |
| `src/components/GemIcon.tsx` | Diamond icon tinted by gem/vessel quality. |
| `src/components/VesselsPanel.tsx` | Vessels, recommended gems per quality, best upgrades, collapsible spell usage. |
| `src/lib/vessels.ts` | `emptyUnlockedByQuality`, `recommendationsByQuality`, `activeRevelationsByDomain` (tested). |
| `src/components/LanguageSwitch.tsx` | PL / EN segmented toggle. |
| `src/lib/gems.ts` | Gem slot rules, mod filtering, gem (de)serialisation, shared mod grades (D27) (tested). |
| `src/i18n/engine.ts` | `engineText(t, msg, fallback)`: renders engine messages (`engine.<key>`) and translates id params. |
| `src/i18n/` | `en.ts` / `pl.ts` dictionaries, `lang.ts` (pure helpers), `context.ts` (`useT`, `useI18n`), `I18nProvider.tsx` (tested). |
| `src/hooks/useDebouncedValue.ts` | Generic debounce hook. |
| `src/hooks/usePersistentInputs.ts` | Inputs state persisted to localStorage + URL. |
| `src/lib/inputStorage.ts` | D101: stored inputs per vocation (vocation and wheel variant shared), migration of the old shared key, `resetVocation`. |
| `src/lib/api.ts` | UI facade over `src/engine` + lazily loaded `src/data` (`loadMonsterData`, `useMonsterData`). |
| `src/lib/geometry.ts` | Pure SVG geometry helpers (tested). |
| `src/lib/inputState.ts` | Input (de)serialisation + validation, monster-list codec, `characterOf` (tested). |
| `src/lib/labels.ts` | Labels, colours, `clamp`, `cx`, `modifierKind`, `priorityLabel` (tested). |
| `src/index.css`, `index.html`, `public/favicon.svg` | Theme, fonts, icon. |

## Component tree

```
App
├─ VocationPicker      value, onChange(vocation)
├─ CharacterPanel      vocation, value (points, level, scrolls, skills), max (= wheel.totalCapacity), onChange(patch)
├─ MonsterSearch       value: WeightedMonster[], ready (dataset loaded), onChange(MonsterEntry[])
│  └─ MonsterCard      monster
├─ FightContextPanel   value: FightContext, onChange(patch), priority, onPriorityChange (→ PrioritySlider)
├─ GemsPanel           vocation, gems, mods, emptyVessels (viewed build, per quality), onChange(updater)
├─ EquipmentPanel      vocation, gear, worn (result.gear), weaponName, weapons: WeaponPrefs (+ updaters)
│  └─ OwnedWeapons     vocation, prefs: WeaponPrefs, onChange(updater)
├─ Panel › RotationPanel presets, spells (forceable), value: SpellPrefs, onChange(patch), usage = viewed build `rotation`
├─ Panel › WheelChart  wheel, result | null   (the *viewed* build: best or alternative)
├─ Panel › WeaponResultPanel result.weapon, owned (weapons of the computed input), suggest, busy, onSuggestChange   (only with weapons)
├─ Panel › ResultsPanel result   (empty-state text when points = 0)
├─ Panel › ExportPanel  code = viewed build `plannerCode` (empty state when undefined)
└─ Panel › VesselsPanel vocation, result, mods   (only when result != null)
```

`main.tsx` wraps `App` in `I18nProvider`; `LanguageSwitch` sits in the header (top-right).

Components never import `src/engine` / `src/data` directly — only `src/lib/api.ts`.

## State flow

1. `usePersistentInputs()` holds `{ vocation, points, level, scrolls, mainSkill, shielding, magicLevel, monsters, priority, mode }`.
   Initial value = defaults ← localStorage (D101: `wheel-optimizer:inputs:v2` for the vocation and wheel variant,
   `wheel-optimizer:inputs:v2:<vocation>` for the rest; a vocation switch loads that vocation's own values) ← URL query
   (`?v=druid&p=420&lv=470&ml=110&m=demon_dragon-lord*2&prio=75&f=hunt`; the removed hunt-style key `h` is ignored and dropped; URL wins; a link with `v` treats
   absent optional keys as empty). D102: the mirrored URL carries this browser's id (`o`, `wheel-optimizer:owner:v1`);
   a URL with the own id (bookmark, history, address-bar suggestion) is ignored on load, so the stored (newer) settings
   win; a link without it or with another id applies (`linkSearch`, `mirrorSearch` in `src/lib/inputStorage.ts`, also
   used by the spell prefs). Every change is written back to
   localStorage (try/catch) and to the URL with `history.replaceState`.
   All values are sanitised (`sanitize`) — unknown vocation dropped, points clamped to 0–`MAX_POINTS` (4000 = wheel
   capacity), priority snapped to the nearest step (`snapPriority`, D91). Once the monster dataset is loaded, unknown monster ids are dropped
   (`withKnownMonsters`). A legacy `monsterId` / single `m=id` becomes a one-monster list.
   D101: "Reset <vocation> settings" (below the left column, with a confirmation) removes every stored key of the
   active vocation (`vocationStorageKeys`: inputs, spells, gems, weapons, gear with charms, compare code), keeps only
   `v` / `w` in the URL and remounts the optimizer (`App` keys `Optimizer` by a reset counter), so all hooks read the
   defaults. Other vocations are untouched.
2. `App` derives `wheel = getWheel(vocation)` (memo) and clamps points to `wheel.totalCapacity`.
3. `useDeferredValue(inputs)` keeps the slider/typing responsive; the input is built in a
   `useMemo` and computed by `useOptimizer` in a Web Worker (D42: `src/workers/optimize.worker.ts`, newest input only,
   main-thread fallback without Worker support or after a worker error; the shown build follows its own input's
   vocation, results get `aria-busy` while a newer input runs). The input is keyed on the deferred vocation/points/spot/priority/context/gems/character with `monster: null`,
   `monsters = resolveMonsters(entries, getMonsterById)`, `character = characterOf(inputs)` (only the vocation's skill
   fields; level falls back to `points + 50`; `undefined` when nothing entered) and `alternatives: 0`; `context = contextOf(inputs)` (`{ mode }` only),
   `rotationId` / `forcedSpells` from `usePersistentSpellPrefs(vocation)` (deferred; auto / none → `undefined`),
   `gems` from `usePersistentGems(vocation)` (also deferred), `weapons` / `suggestWeapons` from `usePersistentWeapons(vocation)` (deferred; none → `undefined`), `gear` = `gearInput(usePersistentGear(vocation))` (deferred; nothing set → `undefined`). `points = 0` → `result = null` → empty state.
4. A local `view` index (0 = best, i = `result.alternatives[i-1]`) picks the *viewed* build (`BuildResult` =
   `Omit<OptimizerResult, 'alternatives'>`) shown by the wheel, summary, export and vessels panels; it falls back
   to 0 when the alternative disappears.

### Persistence keys

| Key | Where | Content |
|-----|-------|---------|
| `wheel-optimizer:inputs:v2` | localStorage | D101: `{ vocation, wheel }` |
| `wheel-optimizer:owner:v1` | localStorage | D102: random id of this browser, written to the URL as `o` |
| `wheel-optimizer:inputs:v2:<vocation>` | localStorage | D101: the rest of `InputState` for that vocation (legacy `monsterId` migrated) |
| `wheel-optimizer:inputs:v1` | localStorage | up to D100: the whole `InputState`, shared; copied to every vocation that has no own inputs yet, then removed |
| `?v= &p= &lv= &sc= &sk= &sh= &ml= &ms= &m= &prio= &f= &w=` | URL query | same inputs (`w=live` = live wheel, omitted for the default; `lv` level, `sc` scrolls, `sk` main skill, `sh` shielding, `ml` magic level, `ms` knight's melee skill sword/axe/club; `m` = `id[*weight]` joined by `_`, weight 1 omitted; `f` = hunt/boss; legacy `h` ignored); empty optional keys omitted |
| `wheel-optimizer:spells:v1:<vocation>` | localStorage | `{ rotationId, forcedSpells }` JSON, validated against the vocation's presets / forceable spells (max 8) |
| `?r= &fs=` | URL query | rotation preset id (absent = auto), forced spells joined by `,`; a link with `v` but no `r`/`fs` = auto / none |
| `wheel-optimizer:gems:v1:<vocation>` | localStorage | `OwnedGem[]` JSON, validated by `sanitizeGems` |
| `wheel-optimizer:weapons:v1:<vocation>` | localStorage | `{ weapons: OwnedWeapon[], suggest }` JSON, validated by `sanitizeWeapon` |
| `wheel-optimizer:compare:v1:<vocation>` | localStorage | D89: the own wheel's planner code or link (string, max 300 chars) |
| `wheel-optimizer:lang:v1` | localStorage | `pl` / `en` |

Gems and weapons are deliberately **not** in the URL (too long); a shared link carries every other input.

## Character, hunting spot, alternatives, export (iteration 3)

- **Character**: typing a level sets `points = pointsForLevel(level, scrolls)` (clamped to capacity); editing points
  afterwards is a manual override (help text says "points set manually"). Skill fields per vocation (D13): knight
  melee + shielding · paladin distance + shielding + magic level · sorcerer/druid magic level · monk fist + magic
  level; empty = "auto" (engine estimates from level).
- **Hunting spot**: up to 10 monsters, weight 0.1–100 (default 1, one decimal). One monster → `MonsterCard`;
  several → weighted-average element chips (`combinedModifiers`) and damage types ordered by weight. Hunt mode shows
  "Single-target spells are ignored in hunt mode" (D16).
- **Alternatives**: not shown (D36); the app asks the engine for none.
- **Wheel variant (D88)**: a `SegmentedControl` in the wheel panel header switches `InputState.wheel` between
  "Announced changes" (default) and "Live (tibia.com)"; the request sends `wheelVariant`, the shown wheel, mods
  and revelation reach follow the result's variant. Live vessels show their domain and Vessel Resonance (0–III)
  and the quality-match bonus.
- **Charms (D93)**: a charm button in the paper doll (bottom-left cell, own SVG icon) opens a modal (`CharmsEditor`) with the 12 offensive charms and a stage switch (— / I / II / III) each, the assignment of the shown build (creature → charm, gain %) and the area-ammunition note. Stored in the gear prefs (`charms`), sent as `input.charms`. The rotation damage table has a Charms row.
- **Average targets (D107)**: in the rotation panel (hunt only), a collapsible list of `getTargetSpells` (area / chain / beam damage spells) with a number field each; the placeholder is the community average, ↺ restores one spell, a button restores all. Clearing the hunting spot restores the defaults (`App`). Stored with the spell prefs, URL key `tg`.
- **Excluded spells (D92)**: in the rotation panel, a select of `getExcludableSpells` (wheel + rotation spells) with removable chips; excluding a spell drops it from the forced list and the custom rotation. Stored with the spell prefs, URL key `xs`.
- **Release switch (D90)**: with `WHEEL_UPDATE_RELEASED` the toggle is hidden (`wheelVariants()` has one entry), a
  stored or linked `w=live` becomes `current`, and an old-wheel code in the compare panel shows
  `compare.retiredVariant`.
- **Compare with your wheel (D89)**: `ComparePanel` takes a planner code or link (`parseOwnWheel` in
  `src/lib/compare.ts`); a code of the selected vocation and wheel variant is sent as `compareWith` (another
  variant offers a switch). It shows the verdict, the optimal-vs-own gain, the differences where each wheel is
  better (`Gain` per slice / revelation / vessels) and the reasons; "Show my wheel on the chart" draws the own
  allocation in `WheelChart`.
- **Export**: `plannerUrl(code)` = `https://www.test.tibia.com/community/?subtopic=wheelofdestinyplanner&code=<encoded>` (version 0 live codes: the www.tibia.com planner);
  copy result announced in a `role="status"` line; empty state when `plannerCode` is undefined.

## Gem editor

- Quality → slots (`slotsForQuality`): lesser = basic 1; regular = basic 1 + 2; greater = basic 1 + 2 + supreme.
  Changing quality calls `normalizeGem`, which clears slots the quality no longer has.
- Mod options per slot come from `wheel.mods` via `modsForSlot` (basic mods filtered by `slots`, absent = both;
  supreme slot = `kind: 'supreme'`); the mod already chosen in the other basic slot is hidden. Supreme options are ordered by `sortSupremeMods` (D41): effects, Revelation Mastery, augments by spell.
  An unknown stored `modId` is kept and shown as `#id`.
- Grade I–IV is an inline `SegmentedControl` next to each mod select (disabled until a mod is chosen); the
  grade's `gradeValues` entry is shown next to the slot label.
- "Add gem" uses a quality select labelled with the vocation-specific gem name (`gemName`, read from the planner's
  `VesselInfos.GemNames` in the wheel data, e.g. "Greater Sage Gem" for sorcerers and "Greater Mystic Gem" for druids); each gem card has a quality select and a Remove button. The panel is collapsible
  (`aria-expanded` / `aria-controls`); it starts collapsed when the vocation already has gems (D104), open otherwise.

## Results: vessels & gems

`VesselsPanel` renders (each with an empty state while the engine returns `[]`):
vessels (`GemIcon` by quality, locked/unlocked, assigned gem + mod chips with roman grades, badge
owned / recommended), recommended gems (quality, mods, gain, reason), best upgrades (mod, slot, grade from → to,
gain) and "Spells in this context" (✓/✗ with screen-reader text, expected targets, reason) collapsed by default.
Mod names are looked up in `wheel.mods` by `kind` + `modId`.

## i18n

- No library. `src/i18n/en.ts` is the source of truth (`as const`); `MessageKey = keyof typeof en`;
  `pl.ts` is typed `Record<MessageKey, string>`, so a missing key fails `tsc`. A test also checks identical
  keys and identical `{placeholder}` sets per key.
- `useT()` returns `t(key, vars?)` (`{name}` interpolation, EN fallback). `useI18n()` adds `lang` / `setLang`.
- Default language: localStorage, else `navigator.language` starting with `pl` → `pl`, else `en`.
  `I18nProvider` sets `<html lang>` and persists the choice.
- Translated: all UI chrome, aria labels, element / domain / category / priority labels, vocation blurbs.
  Not translated: game terms from data (perk, spell, mod names, vocation names, gem item names) and
  engine-generated text (`rationale`, `reason`, stat labels) — those come from the engine in English.
- `labels.ts` keeps the English constants (`priorityLabel` = `en[priorityKey(v)]`) for non-React callers.

## Theme tokens (`src/index.css`, Tailwind v4 `@theme`)

- `ink-950…500` warm near-black backgrounds; `parchment-50…400` text; `gold-300…700` accent.
- Semantic: `weak` (green), `resist` (red), `immune` (grey), `offense`, `defense`, `utility`.
- `font-display` = Cinzel (Google Fonts) for headings.
- Component classes: `.panel`, `.section-title`, `.field`, `.priority-range`.
- Domain colours (`DOMAIN_COLORS` in `labels.ts`): topLeft green, topRight red,
  bottomLeft purple, bottomRight blue — each with `base` (filled), `dim` (empty), `text`.

## Accessibility

- Vocation: `role="radiogroup"` / `role="radio"` + `aria-checked`, roving tabindex, arrows/Home/End.
- Monster search: ARIA 1.2 combobox (`aria-expanded`, `aria-controls`, `aria-activedescendant`,
  `role="listbox"`/`option`); ↑/↓ move, Enter selects, Esc closes (second Esc clears text);
  "Clear all" empties the spot ("No monster (generic build)"). Each row has a labelled weight input ("Weight of X") and
  "Remove X" button; the list is in an `aria-live` region.
- Fight context, grade and language toggles are `SegmentedControl` radiogroups (arrow keys).
  Gem selects have `<label>`s (visually hidden where the context is obvious); Remove has "Remove gem N".
- Slider has `aria-valuetext` ("Balanced (50 of 100)"); the "Balanced" label resets to 50.
- Score bars use `role="meter"`; revelation pips have an `aria-label` ("Stage 2 of 3").
- Wheel slices are focusable (`tabIndex=0`, `role="img"`, descriptive `aria-label`); hover and
  focus show the same tooltip. Gold `:focus-visible` outline globally; reduced-motion respected.

## Wheel geometry

Angles are degrees clockwise from 12 o'clock, matching `Slice.indexInRing`:

- Slice angles: `[i·360/n, (i+1)·360/n]` with `n = slicesInRing`. Domains therefore land at
  topRight 0–90° (12→3 o'clock), bottomRight 90–180°, bottomLeft 180–270°, topLeft 270–360°.
- Point at angle `a`, radius `r`: `(cx + r·sin a, cy − r·cos a)` (SVG y points down).
- Rings are laid out evenly between hub radius 34 and outer radius 192 (viewBox 400):
  `inner = hub + (ring−1)·w`, `outer = hub + ring·w`, `w = (outer−hub)/ringCount`.
- Partial fill is **area-proportional**: `r_fill = √(inner² + f·(outer² − inner²))`, `f = points/capacity`.
- Each sector is `M outerStart A outer … L innerEnd A inner … Z`, large-arc flag when span > 180°;
  a full 360° span is clamped to 359.9° (an SVG arc can't start and end on the same point).
- Fill-order badges sit at the sector centroid (mid angle, mid radius) and show the 1-based
  index of the slice in `result.path`.

## Monster data loading

The monster dataset (~950 kB JSON) is code-split. `main.tsx` calls `loadMonsterData()` before the first
render so the `data` chunk downloads in parallel; `useMonsterData()` (a `useSyncExternalStore` hook) flips
to `true` when it resolves. Until then `searchMonsters` returns `[]` (the listbox says "Loading monster
data…") and `getMonsterById` returns `undefined`, so the first build is generic and is recomputed once
the selected monster resolves. The engine is bundled eagerly (it is small).

## Work log

- 2026-11-18 — Theme tokens, fonts, favicon; `lib/` helpers (geometry, input state, labels) with tests;
  persistence hooks; fixture fallback facade.
- 2026-11-18 — All components (`VocationPicker`, `PointsInput`, `MonsterSearch`, `MonsterCard`,
  `PrioritySlider`, `WheelChart`, `ResultsPanel`) and `App` layout; fixed `-0` / full-circle arc
  rounding in `geometry.ts`. `tsc -b`, `vitest run src/lib` (16 tests) and `npm run build` pass.
- 2026-11-18 — Fixture fallback removed; monster data lazy-loaded; scroll points field; `MAX_POINTS` = 4000.
- 2026-11-18 — (iteration 2) Fight context, My gems editor, Vessels & gems results, PL/EN i18n (`src/i18n/`),
  `SegmentedControl`; gems per vocation in localStorage, context in URL. 126 tests pass, lint/build clean.
- 2026-11-18 — Removed the dev mod fixture (the UI uses `wheel.mods`).
  - Engine messages are rendered in PL/EN (`engineText`), with the English string as fallback.
  - Spell share (`% dmg`) and upgrade `gainToMax` (gain to grade IV) are shown.
  - Gem names come from the data, and vessels are labelled `vesselId + 1`.
- 2026-11-18 — (iteration 3) Character panel (level/scrolls/points override/skills → `character`), multi-monster
  hunting spot with weights (→ `monsters`), alternatives switcher, planner export; hunt-mode single-target note.

## Rotation & forced spells (iteration 4, D20/D21)

- `RotationPanel` (right column, above the build summary): `<select>` "Auto (best)" + `getRotationPresets(vocation)`;
  the chosen preset's `note` and `requires` ("needs Beam Mastery", "needs a shield") below it. `optimize` gets
  `rotationId` (undefined = auto). Switching vocation loads that vocation's stored prefs; an id not belonging to the
  vocation is sanitised to auto.
- Used rotation = viewed build's `result.rotation`: preset name, "picked automatically" when `auto`, each spell with
  rounded `share` % and ★ when `fromRevelation`.
- Forced spells: `getForceableSpells(vocation)` (spells of wheel augment slices only, not gem-only supreme mods; sorted) in an
  "Add spell…" select; chips with × remove; max 8; passed as `forcedSpells` (undefined when empty).

## Iteration 5 (D23: vessels hold only owned gems)

- **Wheel**: the domain-caption legend under the wheel is replaced by the viewed build's active revelation perks
  (`activeRevelationsByDomain`, stage ≥ 1), in a 2×2 grid matching the quadrants: "Beam Mastery II · 520 pts".
  A domain without an active revelation leaves its cell empty; no active revelation → no list.
- **My gems**: three subsections (vocation gem names via `gemName`), each with its own list and "+ Add gem" for that
  quality. `App` passes `emptyVessels = emptyUnlockedByQuality(shown.vessels)` (unlocked vessels whose `source` is not
  `owned`; legacy `recommended` counts as empty). A quality with empty vessels gets an amber border + "N unlocked
  vessels for X gems are empty — add your gems"; the collapsed panel header shows "N empty vessels".
- **Vessels**: only owned gems are shown inside a vessel; any other unlocked vessel reads "Empty — add a gem".
- **Owned gems**: a quality section with 2+ gems collapses (header toggle); a collapsed section also hides its add button.
- **Recommended gems**: grouped by quality (`recommendationsByQuality`; each quality section collapses, D30; a replacement shows a note), each with mods, gain, reason and
  near-equal substitutes, or "—". "Add to my gems" appends it (`gemFromRecommendation`, mods at the character's grades).
- **Best upgrades**: one row per mod ("gems: N"); "Upgrade" raises that mod in every gem (`setModGrade`). Editing a
  grade in the gems editor also applies to every gem with the mod (`updateGem`, D27).
