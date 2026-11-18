<img src="assets/icon.svg" width="64" height="64" alt="">

# Tibia Wheel Optimizer

Created in [T3 Code](https://t3.codes).

A static web app that suggests how to spend **Wheel of Destiny** promotion points in Tibia. Pick a vocation,
enter your points (or character level), choose the fight context and optionally a target monster, set a
DPS ↔ survivability priority, add the gems you own, and get a complete build: which slices to fill and in
which order, where to put your gems, which gems to look for, and why.

## Features

- **Official planner data from the upcoming update.** Wheel layout, unlock graph, perks, revelations, augments,
  vessels and gem mods for all 5 vocations (Knight, Paladin, Sorcerer, Druid, Monk) are extracted from the
  official test-server planner, including the new 2026 spells.
- **Full wheel model.** 36 slices in 5 rings (4000 points), directed unlock rule, revelation stages at
  250/500/1000 points, Revelation Mastery, twin augments (stage I/II).
- **Gems & vessels.** Enter your owned gems (lesser/regular/greater, mods with grades I–IV). The optimizer places
  them in the 8 vessels, respecting each vessel's quality, and recommends the best gems to look for and the
  most valuable grade upgrades.
- **Fight context.** Hunt (solo / team-lure / team-box) or Boss. Area spells are valued by the expected number of
  targets. Avatar revelations count only in boss fights.
- **Monster tailoring.** Search 2006 monsters. Builds adapt to the monster's elemental weaknesses,
  resistances and damage types.
- **Priority slider.** 0 = maximum DPS, 100 = maximum survivability.
- **PL / EN interface.** Includes the optimizer's explanations. Game terms stay English.
- SVG wheel with the fill order, stats, revelations, convictions, spell usage per context, and a rationale.
- Live recompute. Inputs and context are saved in localStorage and the URL (shareable links); gems are saved
  per vocation in localStorage. Dark Tibian theme, works from 360 px, no backend.

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
| `npm run extract:wheel` | Regenerate `src/data/wheel/wheel-data.json` from the planner files (see below). |

## Refreshing the wheel data

The planner sits behind Cloudflare, so its files must be downloaded **manually in a browser**:

1. Open the Wheel of Destiny planner on test.tibia.com and, from the browser's developer tools (Network tab),
   save these 3 files into `scripts/.cache/wod/` (gitignored):
   `skillgrid.cjs` (the planner WASM module), `SkillwheelStringsJsonLibrary.json` and
   `wheelofdestinyplanner.min.js`.
2. Optionally save the tibiapal.com JSON files (spell average hits, wheel templates) into `scripts/.cache/tibiapal/`.
3. Run `npm run extract:wheel`, then `npm test`.

The script runs the planner in Node, checks every rule it relies on, and writes only facts (numbers and texts)
to JSON. The CipSoft code itself is never committed or shipped. Details: [docs/modules/wheel-data.md](docs/modules/wheel-data.md).

## How the optimizer works

1. Every source of value gets an (offense, defense, utility) value for the vocation and context:
   dedication, convictions, augments, revelation stages, the Avatar (boss only) and gem mods.
   - Spells are valued by their share of your damage: weight × expected targets × the monster's element modifier.
2. The values are blended by the priority slider: `(1 − p)·offense + p·defense + 0.1·utility`.
3. A beam search (width 24) fills whole slices along the planner's unlock graph. It looks ahead to the next
   revelation threshold and puts leftover points into a partially filled last slice.
4. Owned gems are placed into the unlocked vessels with the Hungarian algorithm. Recommendations and upgrades
   are ranked by their gain.

## Data sources & attribution

- **Wheel of Destiny data:** the official planner by CipSoft (test.tibia.com, upcoming update). It is extracted
  offline; the app ships only the derived facts.
- **Monster data:** [tibiopedia.pl](https://tibiopedia.pl) (resistances, damage types, HP, experience). It is
  scraped offline and shipped as static JSON; the app makes no requests to that site.
- **Average hits per spell:** [tibiapal.com](https://tibiapal.com), used as baseline target counts when hunting.

Tibia is a registered trademark of CipSoft GmbH. This is an unofficial fan project, not affiliated with or endorsed by CipSoft.

## Project structure

```
scripts/scrape-monsters.ts   offline monster scraper (tibiopedia.pl)
scripts/extract-wheel.mjs    offline wheel-data extractor (planner WASM)
src/types/                   shared type contract
src/data/                    monsters.json + search API (lazy-loaded chunk)
src/data/wheel/              wheel-data.json + spell metadata
src/engine/                  wheel model, valuation, optimizer, gems, messages
src/components/, src/hooks/  React UI
src/i18n/                    PL/EN dictionaries (UI + engine messages)
src/lib/                     UI facade (api.ts) and pure helpers
src/integration.test.ts      end-to-end tests
```

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — overview, module contracts, quality gates, testing strategy
- [docs/modules/data.md](docs/modules/data.md) — monster scraper and dataset
- [docs/modules/wheel-data.md](docs/modules/wheel-data.md) — planner extraction and wheel dataset
- [docs/modules/engine.md](docs/modules/engine.md) — wheel model, valuation, search, gems
- [docs/modules/ui.md](docs/modules/ui.md) — components, state, i18n
- [docs/modules/integration.md](docs/modules/integration.md) — integration changes and test matrix
- [WORKLOG.md](WORKLOG.md) — development journal and decisions

## Limitations

- Values come from a heuristic model, not from exact in-game damage formulas.
- These inputs are estimates:
  - the mitigation base per vocation
  - spell `maxTargets` and team target counts
  - Monk spell elements
- tibiapal reference builds use the legacy code format. There is no export to a planner code.
- Some legacy monsters have incomplete damage or resistance data on the source site.
