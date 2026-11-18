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

---

## In progress / Next

- [x] S1 Data — scraper + monster dataset + search API.
- [x] S2 Engine — wheel model for 5 vocations + optimizer.
- [x] S3 UI — components, dark Tibian theme, wheel visualization.
- [ ] S4 Integration — wire everything, zero TS errors, tests, docs, README.
