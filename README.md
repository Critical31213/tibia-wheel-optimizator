<img src="assets/icon.svg" width="64" height="64" alt="">

# Tibia Wheel Optimizer

Created in [T3 Code](https://t3.codes).

A static web app that suggests how to spend **Wheel of Destiny** promotion points in Tibia. Pick a vocation,
enter your points (or character level), optionally choose a target monster, set a DPS ↔ survivability
priority, and get a complete build: which slices to fill, in which order, and why.

## Features

- All 5 vocations: Knight, Paladin, Sorcerer, Druid, Monk.
- Full wheel model: 36 slices in 5 rings (4000 points), unlock rule, revelation stages (250/500/1000 domain points).
- Points from level (`level − 50`) plus optional promotion-scroll points (up to 50).
- Search across 2006 monsters (diacritic-insensitive); builds adapt to the monster's elemental weaknesses,
  resistances and damage types.
- Single 0–100 priority slider: 0 = maximum DPS, 100 = maximum survivability.
- SVG wheel with fill-order badges and tooltips, stat summary, revelations, convictions and a plain-English rationale.
- Live recompute, inputs saved to localStorage and the URL (shareable links), dark Tibian theme, works from 360 px.
- No backend: everything runs in the browser.

## Quick start

Requires Node.js 20+ (developed with Node 26; a portable Node install works fine — just put it on `PATH`).

```bash
npm install
npm run dev        # http://localhost:5173
```

| Script | What it does |
|--------|--------------|
| `npm run dev` | Vite dev server with HMR. |
| `npm run build` | Type-check (`tsc -b`) and production build into `dist/`. |
| `npm run preview` | Serve the production build locally. |
| `npm run typecheck` | TypeScript only, strict mode. |
| `npm test` | Vitest unit + integration tests. |
| `npm run lint` | oxlint. |
| `npm run scrape:monsters` | Re-scrape tibiopedia.pl into `src/data/monsters.json` (slow and polite; run rarely). |

## How the optimizer works

1. Each slice's dedication and conviction perks, and each revelation stage, get an (offense, defense, utility) value per vocation.
2. Values are weighted by the priority slider: `(1 − p)·offense + p·defense + 0.1·utility`.
3. A target monster scales offense by its damage taken per element (squared, so weaknesses matter and immunities count as zero) and defense by its damage types and max hit.
4. A beam search (width 24) fills whole slices respecting the unlock rule (ring 1 is free, other slices need a full neighbour), with look-ahead toward the next revelation threshold.
5. Leftover points go greedily into a partially filled last slice; the result includes the fill order, stats and the reasons behind the choice.

## Data source & attribution

Monster data (resistances, damage types, HP, experience) is scraped offline from
[tibiopedia.pl](https://tibiopedia.pl) and shipped as static JSON; the app makes no requests to that site.
Wheel layout and perks are based on publicly documented game mechanics and the open-source canary server.
Tibia is a registered trademark of CipSoft GmbH. This is an unofficial fan project, not affiliated with or endorsed by CipSoft.

## Project structure

```
scripts/scrape-monsters.ts   offline monster scraper
src/types/                   shared type contract
src/data/                    monsters.json + search API (lazy-loaded chunk)
src/engine/                  wheel model, scoring, optimizer
src/components/, src/hooks/  React UI
src/lib/                     UI facade (api.ts) and pure helpers
src/integration.test.ts      end-to-end tests
```

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — overview, module contracts, quality gates, testing strategy
- [docs/modules/data.md](docs/modules/data.md) — scraper and dataset
- [docs/modules/engine.md](docs/modules/engine.md) — wheel model, scoring, search
- [docs/modules/ui.md](docs/modules/ui.md) — components, state, geometry
- [docs/modules/integration.md](docs/modules/integration.md) — integration changes and test matrix
- [WORKLOG.md](WORKLOG.md) — development journal and decisions

## Limitations

- Perk values are a heuristic model, not exact in-game damage formulas; Monk data is approximate.
- Gems (and gem-based Vessel Resonance values) are not modelled.
- Some legacy monsters have incomplete damage or resistance data on the source site.
- The dataset is a snapshot; re-run `npm run scrape:monsters` after game updates.
