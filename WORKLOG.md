# WORKLOG — Tibia Wheel of Destiny Optimizer

Ongoing journal of the development process: what was done, issues encountered,
architectural decisions, and work in progress. Newest entries at the bottom of
each section. Every agent appends its own entries, prefixed with its role.

Roles:
- **Coordinator** — main agent, sets up the project and delegates.
- **S1 Data** — Data & Scraper Specialist (`src/data`, `scripts/`).
- **S2 Engine** — Algorithm & Logic Engineer (`src/engine`).
- **S3 UI** — Frontend & UI Designer (`src/components`, `src/App.tsx`, styling).
- **S4 Integration** — Integration & Testing Lead (whole repo, docs, QA).

---

## Decisions (ADR-style, short)

| # | Date | Decision | Reason |
|---|------|----------|--------|
| D1 | 2026-11-18 | Stack: Vite 8 + React 19 + TypeScript + Tailwind CSS v4, Vitest for tests. | Static SPA is enough — no server required at runtime; fast dev loop; Tailwind fits a custom dark Tibian theme. |
| D2 | 2026-11-18 | Monster data is scraped **offline** by a Node script into a committed JSON file; the app ships static data. | tibiopedia.pl does not send CORS headers for browser use, and scraping a third-party site on every page view would be slow and impolite. |
| D3 | 2026-11-18 | One shared type contract in `src/types/index.ts`; each module exposes a small public API via its `index.ts`. | Lets the three implementation subagents work in parallel without touching each other's files. |
| D4 | 2026-11-18 | The 5 classes are Knight, Paladin, Sorcerer, Druid, Monk. | Monk was added to Tibia in 2025 and has its own Wheel of Destiny. |
| D5 | 2026-11-18 | Priority slider is a single number 0–100 (0 = max DPS, 100 = max survivability). | Simplest possible mental model for the user and a single weight for the optimizer. |
| D6 | 2026-11-18 | Node.js 26 LTS installed portably in `%LOCALAPPDATA%\node-portable` (no admin install). | Node was not present on the dev machine. |
| D7 | 2026-11-18 | Wheel data source switched to the **official test-server planner** (test.tibia.com, upcoming update). Its WASM module (`skillgrid.js`) + `SkillwheelStringsJsonLibrary.json` are downloaded manually via a browser (Cloudflare blocks scripts) into gitignored `scripts/.cache/wod/`; a Node script runs the WASM and generates static JSON. | Most up-to-date data (new spells, gems, vessels). The CipSoft binary itself is never committed or shipped. |
| D8 | 2026-11-18 | Fight context: Hunt/Boss toggle (manual only); Avatar revelations valued only in Boss mode. Hunt style Solo / Team-lure (~4–6 mobs) / Team-box (~8–10 mobs); Boss ≈ single target. Baseline spell target counts from tibiapal.com `spell-average-hits` (cached in `scripts/.cache/tibiapal/`). | User requirement; counts are estimates to be verified. |
| D9 | 2026-11-18 | Spell augments valued automatically by context: expected targets, spell element vs monster resistances, single-target vs area. | User requirement. |
| D10 | 2026-11-18 | Gems: user-owned gem inventory (quality, mods, grades I–IV) placed optimally into vessels + recommendations of best gems and most valuable mod-grade upgrades. | User requirement. |
| D11 | 2026-11-18 | UI language switch PL / EN. | User requirement. |
| D12 | 2026-11-18 | Realistic mitigation: depends on shielding/level; tiny at mid levels (user's RP ≈ 1%). Target audience level 200–1500; HP preferred below ~1200 (EK) / ~1500 (RP) — must emerge from the math, not a hard rule. | User feedback. |
| D13 | 2026-11-18 | Character inputs per vocation: EK level+melee+shielding; RP level+distance+shielding+mlvl; MS/ED level+mlvl; Monk level+fist+mlvl. | Needed for HP/mana, mitigation, spell damage and healing (e.g. RP mas san scales with mlvl). |
| D14 | 2026-11-18 | Flat "Damage and Healing" bonus valued relative to real per-hit damage/healing; consider Revelation Mastery gems that reach the next revelation stage (bigger flat bonus). Leech slices strongly devalued. | User guidance. |
| D15 | 2026-11-18 | Multiple monsters per hunting spot with weights; best build + 2 alternatives; export-only planner code (incl. gems); gem/upgrade ranking by gain only (no cost). UI polishing postponed until functionality is accepted. | User answers. |
| D16 | 2026-11-18 | **Hunt mode (AoE hunting) never values single-target spells** (all hunt styles); single-target spells count only in Boss mode. | User rule. |
| D17 | 2026-11-18 | Damage model calibrated on the public TibiaTools damage API used by tibiapal.com (`https://tibiatools.io/api/v1`: `GET /meta/{vocations,stances,weapons,ammo,shields,perks,spells,creatures,charms}`, `POST /damage`). Datamined **offline** (polite: low rate, cached) into fitted per-spell formulas + perk effects committed as static data; no runtime dependency. | User: tibiapal estimates are very good; avoid hammering a third-party API on every slider move. |
| D18 | 2026-11-18 | Defense valued as effective HP (EHP = HP / (1 − mitigation)); the arbitrary "spike" factor is removed. Gem slot 1 offers only Hit Points or Mitigation Multiplier; capacity and max mana have no value (potions + mana-leech imbuement assumed). Default resistance: physical unless the spot's monsters favour another. | User discussion; mitigation never beats HP on 200–1500 with real values. |
| D19 | 2026-11-18 | Real mitigation formula (no fight modes in the current game): ≈ shielding/100 % + shield/spellbook/quiver defense × vocation factor; calibration points: RP shielding 108 → 1.07 %; RP + shield 2.5 % total (shield part 1.28 %); ED 781 → 0.4 % shielding + 0.87 % spellbook. RP: quiver (hunt, bow) / crossbow (boss); mages: spellbook; EK: shield only in the shield rotation. | User data + Canary source. |
| D20 | 2026-11-18 | Hunt styles removed (hunt targets = tibiapal averages; boss = 1). Damage based on rotation presets (`src/data/damage/rotations.ts`): engine auto-picks the best preset for the spot/build (user may override); revelation-unlocked spells (Divine Grenade, Executioner's Throw, Ice/Terra Burst, Spiritual Outburst; Avatars in boss) are added when the revelation is active; druid ultimate area spell (Eternal Winter / Wrath of Nature) chosen by resistance. Augments of spells outside the rotation (transit slices) have no value. | User guidance. |
| D21 | 2026-11-18 | Forced spells: the user can force wheel augments of chosen spells (utility, e.g. Divine Dazzle, Mystic Repulse, Heal Friend). Healing gems excluded for ED/MS; for RP/EK/Monk valued on the defense side. Ballistic Mastery (bow: +4 % physical/holy pierce; crossbow: +10 % crit extra damage) and Positional Tactics (+3 distance 70 % of the time, else +3 holy/healing mlvl) valued exactly. | User guidance + planner texts. |

---

## Log

### 2026-11-18 — Coordinator
- Created branch `feature/wheel-optimizer`.
- Installed portable Node v26.13.1 (npm 11.20).
- Scaffolded Vite + React + TS, added Tailwind v4 (`@tailwindcss/vite`) and Vitest.
- Wrote shared contract `src/types/index.ts` and stub public APIs:
  `src/data/index.ts` (`MONSTERS`, `searchMonsters`, `getMonsterById`) and
  `src/engine/index.ts` (`getWheel`, `optimize`, `pointsForLevel`).
- Created `WORKLOG.md`, `ARCHITECTURE.md`, `docs/modules/`.
- Delegating S1/S2/S3 in parallel, then S4 for integration.

### 2026-11-18 — S3 UI
- Dark Tibian theme (Tailwind v4 `@theme` tokens, Cinzel headings), favicon.
- Components: VocationPicker, PointsInput, MonsterSearch (ARIA combobox) + MonsterCard,
  PrioritySlider, WheelChart (SVG), ResultsPanel; two-column layout ≥ lg, 360 px OK.
- Inputs persisted to localStorage + URL query; live memoized recompute.
- `src/lib/api.ts` facade with removable fixture fallback (`src/lib/fixtures.ts`).
- `tsc -b`, `vitest run src/lib` (16 tests), `npm run build` green. Docs: `docs/modules/ui.md`.

### 2026-11-18 — S1 Data
- Scraper `scripts/scrape-monsters.ts` (cheerio + tsx; `npm run scrape:monsters`),
  polite: 2 workers, 400 ms gap, generic UA, 4 retries w/ backoff, gitignored HTML cache.
- `src/data/monsters.json`: 2006 monsters scraped from tibiopedia.pl (no fallback needed).
  Handles cookie-gated splash page, legacy text-only attack lists, HP 0 placeholders.
- `src/data/index.ts`: `MONSTERS`, ranked `searchMonsters`, `getMonsterById` + element helpers.
- Tests `src/data/index.test.ts` (20, incl. Dragon/Dragon Lord/Demon/Hydra/Grim Reaper
  spot checks) green; `tsc -b` clean. Docs: `docs/modules/data.md`.

### 2026-11-18 — S2 Engine
- Research: tibia.fandom.com is paywalled (HTTP 402) for automated fetch; used search summaries (fandom
  *Version 13 Updates*, tibiaqa.com) + canary server sources (`WheelSlots_t`, `getMaxPointsPerSlot`,
  `canPlayerSelectPointOnSlot`, `io_wheel.cpp` per-slot bonuses, revelation stages, promotion scrolls).
- **Finding:** the wheel has 5 rings (4×50, 8×75, 12×100, 8×150, 4×200 = 4000), not 4 rings; a full domain is
  exactly 1000, so revelation stage 3 needs a full domain. UI geometry is generic (ring count derived), no change needed.
- Implemented `src/engine/wheel/` (geometry builder, perk model, 5 vocation files, build/cache),
  `scoring.ts` (priority blend + monster tailoring), `optimizer.ts` (beam search + revelation look-ahead,
  partial last slice, stats, rationale), `pointsForLevel(level, scrollPoints = 0)`.
- Tests: `geometry.test.ts` + `optimizer.test.ts` (48 tests) green; `tsc -b` clean. Docs: `docs/modules/engine.md`.
- Approximate: perk value units, monk spell elements/passives, Vessel Resonance value; gems not modelled.

### 2026-11-18 — S4 Integration
- Removed the UI fixture fallback (`src/lib/fixtures.ts`, `FIXTURE FALLBACK` branches, `isDemoWheel` + demo banner).
- `MAX_POINTS` 100 000 → 4000 (5-ring wheel capacity, asserted against `getWheel().totalCapacity`); UI ring
  geometry was already generic. Added promotion-scroll points (0–50) to `PointsInput` → `pointsForLevel(level, scrolls)`.
- Bundle: 964 kB single chunk → 267 kB main + 699 kB lazy `data` chunk (dynamic `import('../data')` in
  `src/lib/api.ts`, `useMonsterData()`); `src/data` contract unchanged.
- Bug fixes: unknown monster ids from URL/localStorage were kept forever (now dropped via `withKnownMonster`
  once data loads); URL points could exceed wheel capacity; oxlint `set-state-in-effect` in `PointsInput`.
- `src/integration.test.ts` (31 tests). Gates: typecheck 0 errors, 115 tests pass, lint 0 warnings, build OK,
  `vite preview` serves page + chunks (HTTP 200).
- Docs: README rewritten, ARCHITECTURE unified (layout, gates, testing strategy), `docs/modules/integration.md`.

---

### 2026-11-18 — Coordinator (iteration 2)
- Extracted planner files via the built-in browser; verified the WASM runs in Node (`createModule()` → `SkillwheelPlanner`).
- Findings: 36 tiles = 6×6 grid ids 0–35 (`QTL0..QBR8`); directed unlock graph identical for all vocations; 8 vessels with fixed levels, unlocked in order by filling Gem Vessel slices; mod grades I–IV.
- Extended contract `src/types/index.ts`: `FightContext`, gem/mod/vessel types, new `OptimizerResult` fields (engine returns empty stubs for now).

### 2026-11-18 — S1 Data (iteration 2)
- `scripts/extract-wheel.mjs` (`npm run extract:wheel`): runs the planner WASM in Node, asserts every rule
  empirically, writes `src/data/wheel/wheel-data.json` (~0.5 MB, facts only). Loader `src/data/wheel/index.ts`
  (`getWheelData`, `SPELLS`, `getSpell`, `getWheelSpellNames`), types `src/data/wheel/types.ts`, spells `spells.ts` (57).
- Findings: unlock graph identical for all vocations (fill must be complete); revelation stages at 250/500/1000
  domain points, flat dmg/heal bonus Σ[0,4,9,20][stage]; RM slice = +125 to its own domain, RM gem = +150/165/180/225
  to the named revelation (thresholds only); augments: 2 copies, stage I then II order-independent; vessels
  lesser,regular,greater,lesser,greater,regular,greater,greater, vessel n unlocks at n+1 filled Gem Vessel slices
  (any), +1 dmg/heal per Gem Vessel slice; momentum 0/0.33/0.66/1 % per grade on supreme cooldown mods;
  mitigation dedication 0.075 %/pt. tibiapal builds are legacy codes (decoded, slice points only).
- New spells (2026 Vocation Adjustments): Shield Slam, Divine/Ethereal Barrage, Death Echo, Forked Thorns/Glacier,
  Thousand Fist Blows. Approximate: most `maxTargets`, monk elements (assumed physical).
- Contract note (for Coordinator/S2): `ModDefinition` lacks `effects`/numeric values and supreme `spell`/`revelation`/
  `category` detail — engine can read them from `getWheelData()`; consider mapping in `getWheel()`.
- Tests: `src/data/wheel/wheel.test.ts`; `vitest run src/data` 58/58, `tsc -b` clean. Docs: `docs/modules/wheel-data.md`.

### 2026-11-18 — S3 UI (iteration 2)
- Fight context panel (Hunt/Boss, Solo/Team-lure/Team-box, Avatar hint) → `optimize({ context })`; persisted in
  localStorage + URL (`f`, `h`). `InputState` gained `mode`/`huntStyle` (one-line fix in `src/integration.test.ts`).
- "My gems" collapsible editor: quality → slots, mods filtered from `wheel.mods`, inline grade I–IV, edit/remove;
  stored per vocation (`wheel-optimizer:gems:v1:<voc>`), not in URL → `optimize({ gems })`.
- Results "Vessels & gems": vessels, recommended gems, best upgrades, collapsible spells — empty states until S2.
- PL/EN i18n in `src/i18n/` (typed dicts, `useT()`, `<html lang>`, default from `navigator.language`).
- Dev-only mod fixture `src/lib/devFixtures.ts` (stripped from prod) — remove once `wheel.mods` is filled.
- Gates: `tsc -b` 0 errors, 126 tests (incl. i18n key parity, gem slot rules, gem/context persistence), lint 0, build OK.

### 2026-11-18 — S2 Engine (iteration 2)
- Rewrote `src/engine/`:
  - The wheel model now comes from `getWheelData()` (directed unlock graph, twin augments I/II, RM +125, 8 vessels, basic and supreme mods). The hand-written `wheel/vocations/*`, `perks.ts`, `geometry.ts` and `scoring.ts` are removed.
  - New `spells.ts` (context-aware targets, element, damage shares), `values.ts` (Parts per source), `gems.ts` (Hungarian placement, recommendations, upgrades) and `messages.ts` (i18n keys).
- Optimizer: beam search over the directed graph with revelation look-ahead. Vessel value = best placeable gem. Fills `vessels`, `gemRecommendations`, `upgradeRecommendations`, `spells`, `rationaleMsgs` and `labelMsg`.
- Assumptions: heuristic spell weights and baselines; the Mitigation Multiplier mod is taken literally; level ≈ points + 50.
- Tests: 4 engine test files. `tsc -b` clean, all tests pass, lint clean. Perf ≤ 10 ms at 4000 points. Docs: `docs/modules/engine.md`.

### 2026-11-18 — S4 Integration (iteration 2)
- **Mitigation fix.** Per the planner, the Mitigation Multiplier "increases your mitigation multiplicatively".
  - Gain = `BASE_MITIGATION[voc] × multiplier`. Approximate bases: knight 20, monk 14, paladin 10, mages 6 %.
  - It is no longer a flat reduction. Grade IV = +6 % for a knight and +1.8 % for a mage.
  - Offensive mage builds no longer pick it. Tests were added in `engine/gems.test.ts`.
- **Engine ↔ UI.**
  - Removed `src/lib/devFixtures.ts` and the `isFixture` prop.
  - Engine messages are translated (`src/i18n/engine.ts` `engineText`, `engine.*` in PL/EN, with element and hunt-style params translated).
  - The UI shows spell `share` and `gainToMax` (now filled by `gems.ts`). Vessels are labelled `vesselId + 1`.
  - `rationale.threat` was split into `threat`/`threatMax` so no English text travels as a param.
- **Bug fixed: gem names.** They were guessed (sorcerer "Mage", druid "Sage"). They now come from the planner's
  `GemNames` (Sage = sorcerer, Mystic = druid).
- **Integration tests.** 135 in `src/integration.test.ts`. The matrix is 5 vocations × 4 contexts × 5 budgets with owned gems.
  - Checks the directed path, that Avatar is valued only in boss mode, vessel quality and placement, non-empty recommendations, and that PL/EN keys resolve.
  - Also covers persistence round-trips (context in the URL, gems in localStorage) and Avatar stage in boss vs hunt.
  - The i18n parity test now covers every engine key.
- Added `.gitattributes` (`* text=auto eol=lf`).
- **Gates.**
  - typecheck 0 errors. 353 tests in 12 files pass. lint 0.
  - Build: main 629 kB (138 kB gzip; the wheel data is needed for the first render and is kept there on purpose), lazy monster chunk 699 kB (76 kB gzip).
  - `vite preview` serves everything with HTTP 200.
- **Docs.** README, ARCHITECTURE (pipeline diagram, contracts, gates), `docs/modules/integration.md`, `engine.md`, `ui.md`.

### 2026-11-18 — S3 UI (iteration 3)

- `CharacterPanel` replaces `PointsInput`: level drives points (`pointsForLevel`), scroll points, manual points override, per-vocation skills (D13, empty = auto) → `OptimizerInput.character` via `characterOf`.
- Hunting spot: several monsters with weights (max 10, 0.1–100), weighted-average element chips / damage types (`src/lib/monsters.ts`); passed as `monsters` with `monster: null`. Hunt mode notes that single-target spells are ignored (D16).
- `BuildSwitcher` (Best · Alt 1 · Alt 2) switches wheel/summary/export/vessels; `ExportPanel` shows `plannerCode` with Copy code / Copy planner link / Open planner (`src/lib/planner.ts`). Both show empty states until the engine fills `alternatives` / `plannerCode`.
- Persistence: new URL keys `lv sc sk sh ml`, `m` = `id[*w]` joined by `_` (legacy single `m` / `monsterId` migrated; a link with `v` treats absent optional keys as empty). Integration test inputs adapted (`monsters`, `withKnownMonsters`).
- New PL/EN strings; `tsc -b`, `vitest run` (363), lint and build pass.

### 2026-11-18 — S1a Planner code (iteration 3)

- Planner code reverse-engineered: `<V><ver>` + base64url (no padding) of raw deflate of 36 tile bytes (by grid id) + 8×3 vessel bytes `[basic1, basic2, supreme]` (`0xFF` empty). Mod keys = wheel-data ids; no grade stored. WASM uses zlib-ng level 9; re-implemented so codes are byte-identical.
- `src/data/wheel/plannerCode.ts`: `encodePlannerCode`, `decodePlannerCode` (incl. legacy `…0…`), `plannerUrl`, `plannerVesselIssues`, `sliceIdForGrid`/`gridForSliceId` (engine slice id = tile name). New dep `fflate` (inflate).
- Tests: planner fixtures + 200 random builds vs WASM (skip without cache). Spec: `docs/modules/planner-code.md`.

### 2026-11-18 — S1b Damage model (iteration 3)

- `scripts/datamine-tibiatools.mjs` (`npm run datamine:damage`): 279 cached `/damage` + 9 meta requests to the TibiaTools API (2.5 s apart, stop on 429). Fits 144 spell variants on a shared level term g(L) (L/5 to 500, then /6, /7, /8…): ≤ 1.7 damage error, 4 monk spells ≤ 1.44 %.
- `src/data/damage/`: `spell-formulas.json` + loader (`spellAverageHit` with stage/part, base-damage % [not on level term], flat bonus × bonusFactor; cooldown turns, element, area, `isSingleTarget` D16, tibiapal targets/rotations, crit, Canary healing). Probe rules (crit, creatures, Combat Mastery, Ascetic, Lord of Destruction) in `rules`.
- `src/data/character/`: HP/mana/cap, default skills, `mitigationPercent` (RP ≈ 1 % mid levels); as pure eHP an HP point always beats a Mitigation point at 200–1500, so the engine should value mitigation as sustain.
- Docs: `docs/modules/damage-model.md`, `docs/modules/character-formulas.md`.

### 2026-11-18 — S2 Engine (iteration 3)

- **Damage model.** `spells.ts` was rewritten around a rotation model that uses `src/data/damage` formulas, character level and skills (`input.character`, default level = points + 50), weighted monsters and crit EV.
  - `off` = % change of rotation damage. Augments, crit, cooldown, the flat bonus (revelation stages and vessel slices), revelation extras and passives (Combat Mastery, Ascetic, Lord of Destruction) are valued as rotation deltas.
  - Healing spells use the healing formulas, on the defense side.
  - Shared cooldowns were added: Hell's Core / Rage of the Skies, Eternal Winter / Wrath of Nature, strikes.
- **D16.** Single-target spells are unusable in hunt mode: no share, no augment or gem value, and the `rationale.singleTarget` / `spell.singleTargetHunt` messages. Boss mode counts 1.2 targets for area spells.
- **Defense.**
  - HP is valued as effective HP vs spike (weighted `maxDamage`).
  - Damage reduction and the Mitigation Multiplier are valued as sustained reduction on the real base mitigation (`src/data/character`).
  - Leech is strongly devalued, and resistances are weighted by the spot's damage types.
  - Result: HP wins clearly at RP 400; mitigation is about equal to HP at EK 1500, and the lesser gem becomes Mitigation Multiplier at priority ≥ 90.
- **RM look-ahead.** RM slices and gems are worth only the next-stage gain. Owned RM gems are included in the search.
- **Multi-monster.** `input.monsters` weights are normalised (they override `monster`), and `rationale.spot` was added.
- **Search.**
  - Allocation-free candidate ranking, and only the top 8 states are completed.
  - A full wheel short-circuits the search.
  - A refine pass damps one revelation at a time and keeps the result if the exact objective improves.
  - Worst case is 31 ms including alternatives (was ~60 ms).
- **Alternatives / planner code.**
  - `alternatives` (default 2, max 5) offer revelation focus, Avatar focus (boss), and more defensive / more offensive builds, with a minimum distance of max(50, 10 % of the budget) points.
  - They come with `label(Msg)`, `tradeoff(Msg)` and `relativeScore`.
  - `plannerCode` is set on the main build and on each alternative; it is verified by decode, by an unlock-path replay and by the official planner WASM round-trip.
- **Messages.**
  - New keys: `rationale.character|singleTarget|spot|hpOverMitigation|mitigationOverHp`, `spell.singleTargetHunt`, `gem.singleTargetHunt`, `alt.revelationFocus|avatarFocus|defensive|offensive|tradeoff`.
  - PL translations were added in `src/i18n/pl.ts` so that `tsc` passes. **S4: please review the wording.**
- **Tests.**
  - New: `src/engine/iteration3.test.ts`.
  - `spells.test.ts`: the "boss favours single-target" check was replaced by D16 checks.
  - `gems.test.ts`: `BASE_MITIGATION` was removed, and `mitigationGain` now takes the valuation.
  - `optimizer.test.ts`: the perf test now uses the best of 3 runs per input, so parallel test workers do not cause false failures.
  - No integration test expectations changed.

### 2026-11-18 — S4 Integration (iteration 3)

- **Wiring.**
  - `src/lib/planner.ts` duplicated `PLANNER_URL`/`plannerUrl`. It now re-exports them from `src/data/wheel/plannerCode.ts`, where `plannerUrl` trims the code.
  - App passes `character` (`characterOf`), `monsters` (`resolveMonsters`, `monster: null`) and `alternatives: 2`. BuildSwitcher drives the wheel, summary, export and vessels.
- **Engine fixes found by E2E.**
  - An alternative could score above the "best" build (up to 106 %). Such a candidate is now promoted to main and the alternatives are recomputed.
  - Alternatives are sorted by `relativeScore`.
  - Revelation-focus labels name every revelation at the top stage, so two "Ascetic focus" labels can no longer appear together.
  - `SpellUsage.share` is restored. It had been dropped, so the UI "% dmg" never showed.
  - `rationale.hunt` no longer says that single-target spells count for 1 target (D16).
- **PL review.** The new engine keys were reworded to natural Polish with UI-consistent terms (Hunt, spell na pojedynczy cel, Expowisko). Planner names stay in English (Hit Points, Mitigation Multiplier, Revelation).
- **E2E tests.** +65 in `src/integration.test.ts` (200 in total).
  - D16 for 5 vocations × 3 hunt styles.
  - Planner codes for 30 random inputs, main build plus alternatives: each decodes to the same tile points and gems, and the official WASM `updateByCode` loads identical points and gems.
  - Alternatives are distinct, labelled and resolve in PL/EN.
  - Weighted spot: Askarak Demon ↔ Chakoya Windcaller flips fire vs energy.
  - Character: RP 400 → HP over mitigation; EK 1500 → Mitigation Multiplier.
  - New URL keys round-trip.
- **Browser** (T3 preview).
  - Paladin, level 600, 2 monsters. Alternatives switch, the export code and copy/open buttons render, and PL/boss rationales render.
  - No console errors.
- **Gates.**
  - `tsc -b` 0 errors. `vitest run`: 17 files, 494 tests. Lint 0.
  - Build: main 724 kB (158 kB gzip, incl. damage JSON and fflate inflate), lazy monsters 699 kB (76 kB gzip).
- **Docs.** README (character, spots, alternatives, export, TibiaTools/tibiapal attribution, `npm run datamine:damage`), ARCHITECTURE (pipeline, contracts, data flow, gates), `docs/modules/integration.md`, `engine.md`, `ui.md`.

### 2026-11-18 — Fix: max mana valued as offense

Max mana was scored as offense, so at DPS-leaning priority lesser gems for every vocation recommended Mana over Hit Points. A bigger mana pool does not raise damage: mana is now utility only (`K.MANA_UTIL`), HP gets a small utility tie-break (`K.HP_UTIL`). Test added in `iteration3.test.ts`; RM look-ahead test now checks the objective instead of the sum of stages.

### 2026-11-18 — S3 UI (iteration 4)

- Hunt style control removed (Hunt/Boss kept); `InputState.huntStyle` dropped, `context = { mode }`; legacy URL key `h` ignored and removed from links.
- New `RotationPanel` (right column): "Auto (best)" + `getRotationPresets(vocation)` with note / requirements; shows the viewed build's `rotation` (share %, ★ revelation spells, auto-picked); "Force augment for spell" select + chips from `getForceableSpells(vocation)` (augment slices + supreme-mod spells, `src/lib/api.ts`). Passes `rotationId` / `forcedSpells` to `optimize`.
- Persistence: `usePersistentSpellPrefs` + `src/lib/spellPrefs.ts` — localStorage `wheel-optimizer:spells:v1:<vocation>`, URL `r` / `fs`; unknown ids → auto; max 8 forced spells (tests in `spellPrefs.test.ts`).
- Tests: integration contexts reduced to boss / hunt; `docs/modules/ui.md` updated.

### 2026-11-18 — S1 Data (iteration 4)
- **Mitigation (D19)** in `src/data/character`:
  - Formula: `(shielding × vocFactor + 2.56 × offhandDefense)/100 × (quiver 0.877) × (1 + wheel%)`. vocFactor is K 1.148, P/M 1.13, S/D 1.112 (the Canary multiplier × 0.883).
  - It reproduces the user's in-game values exactly: RP 108 shielding with quiver → 1.07 %; RP with a shield → 2.50 % total, of which the shield is 1.28 % (assumed defense 50); ED level 781 → 0.40 % shielding + 0.87 % spellbook. The ED values use the defaults: shielding 36 and spellbook defense 34.
  - Canary's own constants do not fit these values.
  - Defaults: paladin quiver, mages spellbook, knight and monk none. Typical shield and spellbook defense per level bracket comes from TibiaTools item meta, because tibiopedia.pl cannot be scraped.
  - New: `mitigationBreakdown` and `effectiveHp`.
  - Changed: the default mage shielding is now 28→40, and the `wielding`/`defense` options were removed.
- **Paladin weapons (D21)** in `src/data/damage`:
  - `weaponBracket(voc, level, 'bow' | 'crossbow')`. Bow brackets use Diamond Arrow; use `paladinWeaponFor(mode)` to pick the weapon for a mode.
  - `HitOptions.skillBonus`, `magicLevelBonus` and `paladinWeapon` evaluate Positional Tactics (`POSITIONAL_TACTICS`).
  - `BALLISTIC_MASTERY` holds the bow pierce 4 % and the crossbow +10 % crit extra damage.
  - `pierceDamageMod(mod, pct)`: pierce cancels resistance 1:1 up to a modifier of 1.0, then adds at half rate. This was probed with 6 TibiaTools calls (`scripts/probe-pierce.mjs`, cached) and matched exactly.
- **Revelation spells (D20):** `REVELATION_SPELLS` / `revelationSpell(name)`, plus `unlockedBy` on damage spells. A test checks that every spell in `rotations.ts`, including the `or` alternatives, resolves to a formula.
- Docs: `character-formulas.md` and `damage-model.md` updated.

### 2026-11-18 — S2 Engine (iteration 4)
- **Hunt styles removed:** hunt targets are tibiapal averages, and boss mode counts 1 target (area spells 1.2). `huntStyle` is optional and ignored.
- **Defense = % effective HP (D18):**
  - HP +x → x/HP; mitigation or dodge → pp/(100−m); resistance → the same × incoming share.
  - The spike factor and the HP/mana/capacity utility hacks were removed; capacity and max mana are worth 0.
  - Gem slot 1 offers only HP or Mitigation Multiplier.
  - Base mitigation uses the D19 offhand defaults; the knight uses a shield only for `requires.shield` rotations.
  - Result: the lesser gem is Hit Points for every vocation, levels 200–1500.
- **Rotations (D20):**
  - Uses `input.rotationId`, or auto picks the best valid preset jointly with the build. In boss mode a greedy plan (`presetId: 'boss'`) also competes.
  - Revelation spells are cast on cooldown; `or` alternatives are resolved by element vs the spot.
  - One shared damage reference across plans keeps them comparable.
  - `result.rotation` is reported for the main build and for each alternative.
  - Perf: light screening search per plan, full search for the finalists. Worst case ~45 ms.
- **Transit and forced spells (D21):**
  - Augments of spells outside the rotation are worth 0 (`spell.notInRotation`).
  - Forced spells are seeded via the cheapest path to their stage I augment (`rationale.forced` / `forcedImpossible` / `forcedNoAugment`).
- **Gems:**
  - Healing supremes are 0 for sorcerer and druid (including Nature's Embrace cooldown), and valued as EHP for the others.
  - Ballistic Mastery and Positional Tactics are valued as exact damage deltas.
  - Only mods with positive value are recommended.
- **Messages:** new EN and PL keys.
- **Tests:** new `iteration4.test.ts`.
- **Test expectations changed:**
  - EK 1500 lesser gem → Hit Points (D18), in the iteration 3 and integration tests.
  - Hunt-style target tests rewritten.
  - Mitigation Multiplier per-vocation test: it now follows base mitigation (mages have a spellbook).
  - Weighted energy-weak sorcerer spot: the preset rotation keeps Death Echo on top; the test now checks the energy share and the rotation change.
  - Boss single-target spells may be `spell.notInRotation`.
  - i18n `rationale.hunt` no longer takes `{style}` (UI test).
- **Known:** at priority 50 the RP 500–800 hunt build takes Gift of Life 2, because 1 % EHP is weighted like 1 % damage. Divine Grenade (+ Divine Empowerment) wins at priority ≤ 20–35.
- **For the UI:** the greedy boss plan id `boss` needs a label.

### 2026-11-18 — S4 Integration (iteration 4)
- **Wiring:**
  - The greedy boss plan id `boss` is now `GREEDY_ROTATION_ID` in `src/types` (the engine reuses it). The UI labels it `rotation.boss` ("Boss: best plan vs one target" / "Boss: najlepszy plan na jeden cel"), both in `RotationPanel` and in the rationale `{rotation}` param.
  - Verified with no change needed: alternatives show their own `rotation`, `rotationId` / `forcedSpells` reach `optimize`, and legacy `h` links load.
- **PL review:** the new `rotation.*` and `engine.rationale/spell.*` keys were reworded (gender-neutral "Wzięto wymuszone augmenty", "Obrażenia liczone z rotacji", "Revelation" capitalised).
- **E2E (+25, `src/integration.test.ts` 165):**
  - No Capacity or Mana gem mods for any vocation, level, mode or priority.
  - Forced Divine Dazzle, Mystic Repulse and Heal Friend reach the allocation.
  - Every manual preset is honoured (`auto=false`, alternatives too).
  - `fromRevelation` is set only while the revelation is active.
  - The Avatar is in the rotation only in boss mode with its revelation.
  - The boss label is translated.
  - Planner codes work with forced spells.
- **Browser (RP 600):**
  - Auto rotation with shares, then a manual preset with Divine Grenade ★.
  - Forced Divine Dazzle: the slice is filled.
  - Boss label shown in EN and PL; alternatives work.
  - No Vite error overlay. The 2 console entries from page load were not inspected.
- **Gates:** tsc 0, vitest 19 files / 485 passed, lint 0, build OK (main 743 kB / 163 kB gzip).
- **Docs:**
  - README: rotations, forced spells, EHP defense and the real mitigation formula; hunt styles removed.
  - ARCHITECTURE: contracts, gates and tests.
  - `docs/modules/integration.md`.

## In progress / Next

- [x] S1 Data — scraper + monster dataset + search API.
- [x] S2 Engine — wheel model for 5 vocations + optimizer.
- [x] S3 UI — components, dark Tibian theme, wheel visualization.
- [x] S4 Integration — wire everything, zero TS errors, tests, docs, README.
- [x] Iteration 2 — official planner data extracted (S1), fight context + gems editor + PL/EN UI (S3).
- [x] Iteration 2 — engine on planner data: context-aware spells, Avatar boss-only, gems & vessels (S2).
- [x] Iteration 2 — integration: mitigation fix, engine messages i18n, fixtures removed, E2E matrix (S4).
- [x] Iteration 3 — planner code (S1a), TibiaTools damage model + character formulas (S1b), rotation engine, D16, alternatives (S2), character / spot / alternatives / export UI (S3), integration + E2E (S4).
- [x] Iteration 4 — D18–D21: EHP defense, real mitigation, rotation presets, forced spells, hunt styles removed (S1–S4).
- [ ] User acceptance of iteration 4 functionality, then UI polish (postponed per D15).

Open issues:
- Healing formulas are approximate (canary `onGetFormulaValues`); verify against in-game values.
- Cooldowns of the 2026 spells are approximate (tibiapal rotation presets).
- Armor is not modelled; base mitigation assumes default equipment per vocation.
- UI polish postponed (D15); no DOM/component tests (jsdom + Testing Library).
- No alternatives near a full wheel (no room for a ≥ 10 % different build).
- Some legacy monsters lack damage types / max damage.
- **Pending user decision:** at priority 50, the RP 500–800 hunt build picks Gift of Life instead of the meta Divine Grenade + Divine Empowerment. The cause is that 1 % EHP is weighted like 1 % damage, and the offense/defense exchange rate is not decided yet. Divine Grenade wins at priority ≤ 20–35.
- Paladin mitigation calibration assumes shield defense 50, and the quiver factor (0.877) comes from a single data pair.
- Rotation preset notes are English-only data strings (not translated in PL).
- Consider a Web Worker for `optimize()` if the beam width or alternative count grows.
