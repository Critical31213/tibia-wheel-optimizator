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

## In progress / Next

- [x] S1 Data — scraper + monster dataset + search API.
- [x] S2 Engine — wheel model for 5 vocations + optimizer.
- [x] S3 UI — components, dark Tibian theme, wheel visualization.
- [x] S4 Integration — wire everything, zero TS errors, tests, docs, README.
- [x] Iteration 2 — official planner data extracted (S1), fight context + gems editor + PL/EN UI (S3).
- [x] Iteration 2 — engine on planner data: context-aware spells, Avatar boss-only, gems & vessels (S2).
- [x] Iteration 2 — integration: mitigation fix, engine messages i18n, fixtures removed, E2E matrix (S4).

## Known limitations / Next steps

- Perk values are heuristic; calibrate spell weights and baselines against real damage/healing formulas.
- Mitigation base per vocation (`BASE_MITIGATION`) is an estimate; verify against in-game Cyclopedia values.
- Spell `maxTargets` and team target counts (team-lure 5, team-box 9) are approximate; monk spell elements assumed physical.
- tibiapal reference builds use the legacy code format (slice meanings may have changed); no planner export code is generated.
- Some legacy monsters lack damage types / max damage on tibiopedia.pl.
- No DOM/component tests — add jsdom + Testing Library for `App`, `GemsPanel`, `MonsterSearch`, `PointsInput`.
- Scroll points are not persisted; consider adding them to the URL state.
- Consider a Web Worker for `optimize()` if the beam width is increased.
