# ARCHITECTURE — Tibia Wheel of Destiny Optimizer

> Living document. Each module owner updates its own section; the
> Integration Lead keeps the whole document consistent.

## 1. Overview

A static single-page web app that recommends how to spend Wheel of Destiny
promotion points for a Tibia character, given:

1. the **vocation** (Knight, Paladin, Sorcerer, Druid, Monk),
2. the **available points**,
3. an optional **target monster** (its elemental resistances and damage types,
   sourced from tibiopedia.pl),
4. a **priority slider** between maximum DPS (0) and maximum survivability (100).

```
┌──────────────┐     Monster[]      ┌──────────────┐
│  src/data    │ ─────────────────▶ │              │
│ (static JSON │                    │   src/App    │  OptimizerInput
│  + search)   │                    │  (UI state)  │ ───────────────┐
└──────▲───────┘                    │              │                ▼
       │ offline                    └──────▲───────┘        ┌──────────────┐
┌──────┴───────┐                           │ OptimizerResult│  src/engine  │
│ scripts/     │                           └────────────────│ (wheel model │
│ scraper      │  ◀── tibiopedia.pl                         │ + optimizer) │
└──────────────┘                                            └──────────────┘
```

## 2. Tech stack

| Concern | Choice |
|---------|--------|
| Build / dev server | Vite 8 |
| UI | React 19 + TypeScript |
| Styling | Tailwind CSS v4 (via `@tailwindcss/vite`) |
| Tests | Vitest |
| Data pipeline | Node.js script (run manually, output committed) |

## 3. Directory layout

```
/
├── WORKLOG.md              # workflow journal
├── ARCHITECTURE.md         # this file
├── README.md               # user-facing quick start
├── assets/icon.svg         # project icon (README)
├── docs/modules/           # data.md, engine.md, ui.md, integration.md
├── scripts/
│   ├── scrape-monsters.ts  # offline tibiopedia.pl scraper → src/data/monsters.json
│   └── extract-wheel.mjs   # planner WASM → src/data/wheel/wheel-data.json
├── public/favicon.svg
├── index.html
├── vite.config.ts          # React + Tailwind plugins, chunk size limit
└── src/
    ├── types/index.ts      # shared contract (all modules)
    ├── data/               # monsters.json (2006) + search API (lazy-loaded chunk)
    ├── engine/             # wheel/build.ts, spells, values, gems, optimizer, messages
    ├── components/         # React UI components
    ├── hooks/              # usePersistentInputs, useDebouncedValue
    ├── lib/                # api.ts facade, geometry, inputState, labels (pure, tested)
    ├── integration.test.ts # end-to-end tests (data + engine + input parsing)
    ├── App.tsx             # top-level state and layout
    ├── main.tsx            # entry; starts loading monster data
    └── index.css           # Tailwind v4 theme tokens
```

## 4. Module contracts

All cross-module types live in `src/types/index.ts`.

| Module | Public API (`index.ts`) | Consumers |
|--------|-------------------------|-----------|
| `src/data` | `MONSTERS`, `searchMonsters(query, limit)`, `getMonsterById(id)` | UI |
| `src/engine` | `getWheel(vocation)`, `optimize(input)`, `pointsForLevel(level, scrollPoints = 0)` | UI |

The UI reaches both modules only through `src/lib/api.ts`, which re-exports the engine and loads
`src/data` with a dynamic `import()` (separate chunk; `useMonsterData()` signals readiness).

Data flow: UI collects `OptimizerInput` → `optimize()` returns
`OptimizerResult` (allocation per slice, fill path, activated perks, stat
summary, rationale) → UI renders the wheel and the summary.

## 5. Data integration (S1 Data)

- **Source:** [tibiopedia.pl](https://tibiopedia.pl) (Polish), scraped **offline** by
  `scripts/scrape-monsters.ts` (`npm run scrape:monsters`; cheerio, 2 workers,
  400 ms gap, retries, HTML cache in gitignored `scripts/.cache/`).
- **Output:** `src/data/monsters.json` — 2006 `Monster` records (bestiary, bosses,
  quest and other creatures; arena/event/trap entries skipped), sorted by name,
  bundled statically. No runtime network access.
- **Normalization:** Polish labels / icon file names → `Element` keys;
  `elementModifiers` = % damage taken (site's `+80%` resistance → 20, immune → 0,
  neutral → 100; unknown `?%` omitted). HP 0 placeholders omitted.
- **API (`src/data/index.ts`):** `MONSTERS`, `searchMonsters(query, limit = 10)`
  (diacritic-insensitive, ranked exact > prefix > word-prefix > substring),
  `getMonsterById(id)`, plus helpers `getModifier`, `getWeakestElements`,
  `getStrongestElements`, `getBestAttackElement`, `normalizeText`.
- Details, page structure, mapping table and limitations: [`docs/modules/data.md`](docs/modules/data.md).
- **Wheel data (iteration 2):** `scripts/extract-wheel.mjs` (`npm run extract:wheel`) runs the official
  test-server planner WASM in Node (inputs downloaded manually into gitignored `scripts/.cache/wod/`) and writes
  `src/data/wheel/wheel-data.json` (36 slices × 5 vocations, unlock graph, revelations 250/500/1000, vessels,
  basic/supreme mods, momentum, Revelation Mastery, decoded tibiapal reference builds). `src/data/wheel/spells.ts`
  holds spell metadata (element, area, tibiapal avg hits, isNew). API: `getWheelData(v)`, `SPELLS`, `getSpell(name)`.
  Details: [`docs/modules/wheel-data.md`](docs/modules/wheel-data.md).

## 6. Wheel model and optimization algorithm (S2 Engine)

Full details: [`docs/modules/engine.md`](docs/modules/engine.md).

- **Model** (`src/engine/wheel/build.ts`):
  - Built from `getWheelData()` (planner): 36 slices (4×50, 8×75, 12×100, 8×150, 4×200 = 4000 points, 1000 per domain), dedication perks, and convictions (augments come in twin pairs for stage I/II).
  - 4 revelations at 250/500/1000 revelation points; each full Revelation Mastery slice adds +125.
  - 8 vessels (0-based `vesselId`): vessel n unlocks at n+1 full Gem Vessel slices.
  - Basic and supreme gem mods are mapped to `WheelDefinition.vessels`/`mods`.
- **Unlock rule**: the planner's directed graph. Slices 14/15/20/21 start unlocked; any other slice needs at least one *full* predecessor.
- **Valuation** (`spells.ts`, `values.ts`):
  - Every source gives `{off, def, util}`, blended as `(1−p)·off + p·def + 0.1·util` (each weight at least 0.05).
  - Spell value = share of total damage = weight × expected targets (context: solo = tibiapal average, team-lure 5, team-box 9, boss 1.2, single-target 1) × element multiplier (immune → 0).
  - Cooldowns are capped at 50 % of base. Avatar has value only in boss mode.
- **Search** (`optimizer.ts`):
  - Beam search (width 24) over full-slice fills with revelation look-ahead and a partial last slice.
  - Vessel value = Hungarian placement of owned or recommended gems.
  - Deterministic, ≤ 10 ms.
- **Gems** (`gems.ts`):
  - Owned gems are placed with the Hungarian algorithm; active slots = min(gem, vessel) quality.
  - Recommendations are per quality at grade IV. Upgrades are +1 grade for active mods, ranked by gain.
- **Points**: `pointsForLevel(level, scrollPoints = 0) = max(0, level − 50)` (+ up to 50 scroll points).

## 7. UI (S3 UI)

Single-page React UI (`src/App.tsx`, `src/components/`, `src/hooks/`, `src/lib/`).
Inputs (vocation, points/level, monster, priority) live in `usePersistentInputs`
(localStorage + URL query) and feed a memoized `optimize()` call — no Calculate button.
Results render as an SVG wheel (`WheelChart`, area-proportional slice fill, fill-order
badges, tooltips) and a `ResultsPanel` (scores, revelations, convictions, stats, rationale,
fill order). Components use only the `src/lib/api.ts` facade (real engine; monster dataset
lazy-loaded). Points are clamped to the 4000-point wheel capacity; the level helper uses
`pointsForLevel(level, scrollPoints)`. Dark Tibian theme via Tailwind v4 `@theme` tokens.
Iteration 2: fight context (Hunt/Boss + hunt style, in URL), a "My gems" editor (owned gems per
vocation in localStorage, passed as `OptimizerInput.gems`), a Vessels & gems results panel
(vessels, recommended gems, upgrades, spell usage) and a PL/EN switch (`src/i18n/`, typed
dictionaries, `useT()`; game terms stay English).
Details: [docs/modules/ui.md](docs/modules/ui.md).

## 8. Quality gates (S4 Integration)

| Gate | Command | Status (2026-11-18) |
|------|---------|---------------------|
| Types | `npm run typecheck` (`tsc -b`, strict) | 0 errors |
| Tests | `npm test` (Vitest) | 7 files, 115 tests |
| Lint | `npm run lint` (oxlint) | 0 warnings |
| Build | `npm run build` | main 267 kB (84 kB gzip) + lazy data 699 kB (76 kB gzip) |

### Testing strategy

- **Unit, per module:** `src/data/index.test.ts` (dataset shape, spot checks, search ranking, 20),
  `src/engine/geometry.test.ts` (layout, capacities, adjacency, 35), `src/engine/optimizer.test.ts`
  (path validity on random inputs, priority/monster effects, `pointsForLevel`, 13), `src/lib/*.test.ts`
  (SVG geometry, input serialisation, labels, 16).
- **Integration:** `src/integration.test.ts` (31) runs the real dataset through the UI facade and the real
  engine: every vocation at levels 100/300/600/1000, priority extremes, real monsters (Fury, Demon,
  Dragon Lord), edge budgets, determinism and untrusted URL/localStorage input. Matrix in
  [`docs/modules/integration.md`](docs/modules/integration.md).
- **Smoke:** `vite build` + `vite preview`, page and both chunks served with HTTP 200.
- Not covered: DOM/component tests (no jsdom) — UI logic is kept in pure, tested helpers instead.
