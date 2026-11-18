<img src="assets/icon.svg" width="64" height="64" alt="">

# Tibia Wheel Optimizer

Created in [T3 Code](https://t3.codes).

A static web app that suggests how to spend **Wheel of Destiny** promotion points in Tibia. Pick a vocation,
enter your character (level, skills), choose the fight context and the monsters of your hunting spot, set a
DPS ↔ survivability priority, add the gems you own, and get a complete build plus two alternatives: which
slices to fill and in which order, where to put your gems, which gems to look for, why, and a code that opens
the build in the official planner.

## Features

- **Official planner data from the upcoming update.** Wheel layout, unlock graph, perks, revelations, augments,
  vessels and gem mods for all 5 vocations (Knight, Paladin, Sorcerer, Druid, Monk) are extracted from the
  official test-server planner, including the new 2026 spells.
- **Full wheel model.** 36 slices in 5 rings (4000 points), directed unlock rule, revelation stages at
  250/500/1000 points, Revelation Mastery, twin augments (stage I/II).
- **Gems & vessels.** Enter your owned gems (lesser/regular/greater, mods with grades I–IV). The optimizer places
  them in the 8 vessels, respecting each vessel's quality, and recommends the best gems to look for and the
  most valuable grade upgrades.
- **Character.** Level (drives the points), promotion scroll points, optional manual points and per-vocation
  skills (melee/distance/fist, shielding, magic level; empty = estimated from level). They drive HP, base
  mitigation and real spell damage.
- **Real mitigation formula.** Base mitigation = shielding × vocation factor + shield / spellbook / quiver defense,
  calibrated on in-game values (paladin quiver for hunts, crossbow for bosses; mages use a spellbook; knights a
  shield only in the shield rotation).
- **Defense as effective HP.** HP, mitigation, dodge and resistances are compared as % effective HP
  (EHP = HP / (1 − mitigation)); capacity and max mana have no value (potions and mana leech are assumed).
- **Damage model.** Spell damage comes from per-spell formulas fitted offline on the TibiaTools damage API used
  by the tibiapal.com calculator, run through a rotation (cooldowns, crit, augments, flat bonus).
- **Rotations.** Per-vocation rotation presets (tibiapal); by default the optimizer picks the best one for the
  spot and build, or you choose one. Revelation spells (Divine Grenade, Executioner's Throw, Twin Bursts,
  Spiritual Outburst; Avatars on bosses) join the rotation while their revelation is active. Boss mode also tries
  a greedy single-target plan. Augments of spells outside the rotation are worth nothing.
- **Forced spells.** Force the wheel augment of utility spells (e.g. Divine Dazzle, Mystic Repulse, Heal Friend);
  the build takes at least their stage I augment.
- **Fight context.** Hunt or Boss (hunt styles were removed). Area spells use average target counts from tibiapal
  while hunting and ~1 target on bosses; **single-target spells are ignored while hunting**. Avatar revelations
  count only in boss fights.
- **Hunting spot.** Search 2006 monsters and add up to 10 with relative weights. Builds adapt to the weighted
  elemental weaknesses, resistances and damage types of the whole spot.
- **Alternatives.** Best build plus 2 distinct alternatives (revelation focus, Avatar focus in boss mode, more
  defensive / offensive), each with its trade-off and score relative to the best build.
- **Planner export.** Every build (gems included) has a code for the official Wheel of Destiny planner:
  copy the code, copy a planner link, or open the planner directly.
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
| `npm run datamine:damage` | Refit `src/data/damage/spell-formulas.json` from the TibiaTools damage API (cached, 2.5 s between requests, stops on HTTP 429; run rarely). |

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

1. Every source of value gets an (offense, defense, utility) value for the vocation, character and context:
   dedication, convictions, augments, revelation stages, the Avatar (boss only) and gem mods.
   - Offense is the % change of rotation damage: fitted spell formulas × expected targets × the spot's weighted
     element modifier × crit, within cooldowns (single-target spells are worth 0 while hunting).
   - Defense is the % change of effective HP: HP +x → x/HP, mitigation / dodge +pp → pp/(100 − m) on the
     character's real base mitigation, resistances × the element's incoming share.
2. The values are blended by the priority slider: `(1 − p)·offense + p·defense + 0.1·utility`.
3. A beam search (width 24) fills whole slices along the planner's unlock graph. It looks ahead to the next
   revelation threshold, puts leftover points into a partially filled last slice, and refines by damping one
   revelation at a time. Alternatives are re-searches with another revelation focus or priority; if one beats
   the main build, it becomes the main build.
4. Owned gems are placed into the unlocked vessels with the Hungarian algorithm. Recommendations and upgrades
   are ranked by their gain.
5. The planner code uses the planner's own format (base64url of raw-deflated tile points and vessel mods). It is
   byte-identical to the official planner's and verified against its WASM in the tests.

## Data sources & attribution

- **Wheel of Destiny data:** the official planner by CipSoft (test.tibia.com, upcoming update). It is extracted
  offline; the app ships only the derived facts.
- **Monster data:** [tibiopedia.pl](https://tibiopedia.pl) (resistances, damage types, HP, experience). It is
  scraped offline and shipped as static JSON; the app makes no requests to that site.
- **Average hits per spell:** [tibiapal.com](https://tibiapal.com), used as baseline target counts when hunting.
- **Spell damage formulas:** fitted offline on the public [TibiaTools](https://tibiatools.io) damage API
  (`/api/v1/damage`, the engine behind the tibiapal.com damage calculator). Requests are cached and rate-limited;
  the app ships only the fitted coefficients and makes no runtime requests. Cooldowns and healing formulas come
  from the opentibiabr/canary spell scripts (2026 spells are estimated).

Tibia is a registered trademark of CipSoft GmbH. This is an unofficial fan project, not affiliated with or endorsed by CipSoft.

## Project structure

```
scripts/scrape-monsters.ts   offline monster scraper (tibiopedia.pl)
scripts/extract-wheel.mjs    offline wheel-data extractor (planner WASM)
scripts/datamine-*.mjs       offline damage-formula fit (TibiaTools API) + curated spell meta
src/types/                   shared type contract
src/data/                    monsters.json + search API (lazy-loaded chunk)
src/data/wheel/              wheel-data.json + spell metadata + planner code encoder/decoder
src/data/damage/             fitted spell damage/healing formulas (spell-formulas.json)
src/data/character/          HP/mana/capacity, default skills, base mitigation
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
- [docs/modules/planner-code.md](docs/modules/planner-code.md) — official planner code format
- [docs/modules/damage-model.md](docs/modules/damage-model.md) — fitted damage model (TibiaTools)
- [docs/modules/character-formulas.md](docs/modules/character-formulas.md) — HP, skills, mitigation
- [docs/modules/engine.md](docs/modules/engine.md) — wheel model, valuation, search, gems
- [docs/modules/ui.md](docs/modules/ui.md) — components, state, i18n
- [docs/modules/integration.md](docs/modules/integration.md) — integration changes and test matrix
- [WORKLOG.md](WORKLOG.md) — development journal and decisions

## Limitations

- Damage formulas are fitted to the TibiaTools calculator (≤ 1.7 damage error), not taken from the game itself.
- Healing formulas are approximate, and the cooldowns of the 2026 spells are estimates.
- Armor is not modelled; base mitigation assumes default equipment per vocation.
- Hunt target counts are tibiapal averages; the shield defense (50) and quiver factor used for paladin
  mitigation come from a few in-game data points.
- Near a full wheel there may be no alternatives (not enough room for a distinct build).
- Some legacy monsters have incomplete damage or resistance data on the source site.
- The UI is functional, not polished; polishing is postponed until the functionality is accepted.
