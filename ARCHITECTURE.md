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

_To be documented by the Data & Scraper Specialist — see `docs/modules/data.md`._

## 6. Wheel model and optimization algorithm (S2 Engine)

_To be documented by the Algorithm & Logic Engineer — see `docs/modules/engine.md`._

## 7. UI (S3 UI)

_To be documented by the Frontend & UI Designer — see `docs/modules/ui.md`._

## 8. Quality gates (S4 Integration)

- `npm run typecheck` — zero TypeScript errors.
- `npm test` — Vitest unit tests.
- `npm run build` — production build succeeds.
