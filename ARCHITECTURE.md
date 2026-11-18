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
├── WORKLOG.md            # workflow journal
├── ARCHITECTURE.md       # this file
├── README.md             # user-facing quick start
├── docs/modules/         # one .md per module (owned by each subagent)
├── scripts/              # offline tooling (monster scraper)
├── public/               # static assets
└── src/
    ├── types/            # shared contract (all modules)
    ├── data/             # monster dataset + search API
    ├── engine/           # wheel model + optimizer
    ├── components/       # React UI components
    ├── App.tsx           # top-level state and layout
    └── main.tsx
```

## 4. Module contracts

All cross-module types live in `src/types/index.ts`.

| Module | Public API (`index.ts`) | Consumers |
|--------|-------------------------|-----------|
| `src/data` | `MONSTERS`, `searchMonsters(query, limit)`, `getMonsterById(id)` | UI |
| `src/engine` | `getWheel(vocation)`, `optimize(input)`, `pointsForLevel(level)` | UI |

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

## 6. Wheel model and optimization algorithm (S2 Engine)

Full details: [`docs/modules/engine.md`](docs/modules/engine.md).

- **Model** (`src/engine/wheel/`): 36 slices in 5 rings (4×50, 8×75, 12×100, 8×150, 4×200 = 4000 points,
  1000 per domain), layout/capacities/unlock prerequisites/per-slot bonuses taken from the canary server sources.
  `geometry.ts` builds angles (clockwise from 12 o'clock) and symmetric adjacency; per-vocation files
  (`vocations/*.ts`) define dedication per point, spell augments, 200-slot passives and the 4 revelations
  (thresholds 250/500/1000). Monk is marked approximate.
- **Unlock rule**: ring-1 slices are always available; any other slice needs at least one full adjacent slice.
- **Scoring** (`scoring.ts`): each perk has an (off, def, util) value vector with element tags;
  `value = (1−p)·off·offMult + p·def·defMult·threat + 0.1·util`, where `offMult = mean (modifier/100)²`
  over the perk's elements, `defMult` rewards coverage of the monster's damage types and `threat` scales with
  `maxDamage`.
- **Search** (`optimizer.ts`): beam search (width 24) over full-slice fills ranked by score + revelation
  look-ahead + remaining·density, greedy completion with a partially filled last slice; deterministic, 2–6 ms.
- **Points**: `pointsForLevel(level, scrollPoints = 0) = max(0, level − 50)` (+ up to 50 scroll points).

## 7. UI (S3 UI)

Single-page React UI (`src/App.tsx`, `src/components/`, `src/hooks/`, `src/lib/`).
Inputs (vocation, points/level, monster, priority) live in `usePersistentInputs`
(localStorage + URL query) and feed a memoized `optimize()` call — no Calculate button.
Results render as an SVG wheel (`WheelChart`, area-proportional slice fill, fill-order
badges, tooltips) and a `ResultsPanel` (scores, revelations, convictions, stats, rationale,
fill order). Components use only the `src/lib/api.ts` facade, which temporarily falls back
to demo fixtures while the engine is a stub. Dark Tibian theme via Tailwind v4 `@theme` tokens.
Details: [docs/modules/ui.md](docs/modules/ui.md).

## 8. Quality gates (S4 Integration)

- `npm run typecheck` — zero TypeScript errors.
- `npm test` — Vitest unit tests.
- `npm run build` — production build succeeds.
