# ARCHITECTURE — Tibia Wheel of Destiny Optimizer

> Living document. Each module owner updates its own section; the
> Integration Lead keeps the whole document consistent.

## 1. Overview

A static single-page web app that recommends how to spend Wheel of Destiny
promotion points for a Tibia character, given:

1. the **vocation** (Knight, Paladin, Sorcerer, Druid, Monk),
2. the **character** (level → points, scroll points, per-vocation skills),
3. an optional **hunting spot**: up to 10 monsters with relative weights (elemental
   resistances and damage types sourced from tibiopedia.pl),
4. a **priority slider** between maximum DPS (0) and maximum survivability (100),
5. the **fight context** (hunt or boss), the **rotation** (auto or a preset) and **forced spell augments**,
6. the **gems the player owns** (placed in vessels; recommendations and upgrades).

It returns the best build plus alternatives, each with an official planner export code (gems included).
Wheel facts come from the official test-server planner (upcoming update) via an offline extraction pipeline;
spell damage comes from formulas fitted offline on the a public damage-calculator API.

```
OFFLINE (npm scripts; outputs committed)
  tibiopedia.pl ─────────────▶ scripts/scrape-monsters.ts ─▶ src/data/monsters.json
  test.tibia.com planner ─┐
   (manual browser save   ├──▶ scripts/.cache/wod/ ──┐
    of 3 files)           │                          ├──▶ scripts/extract-wheel.mjs ─▶ src/data/wheel/wheel-data.json
  community data avg hits ──┴──▶ scripts/.cache/hunt-data/ ┘    (runs WASM in Node,        + src/data/wheel/spells.ts
                                                              asserts every rule)
  damage API /damage ─────▶ scripts/datamine-damage.mjs ─▶ src/data/damage/spell-formulas.json
   (cached, rate-limited)       (+ datamine-damage-meta.mjs: cooldowns, areas, healing)

RUNTIME (static SPA)
  src/data/wheel ─────getWheelData()────────┐
  src/data/damage ────spell formulas────────┼─▶ src/engine ──getWheel()/optimize()──┐
  src/data/character ─HP, skills, mitigation┤        │ encodePlannerCode()          │
  src/data/wheel/plannerCode ◀──────────────┘────────┘                              │
  src/data (lazy chunk) ──searchMonsters()/getMonsterById()─────────────────────────┤
                                                                                    ▼
  URL + localStorage (vocation, points, lv/sc/sk/sh/ml, m=id*w_…, prio, f, h)
        ──▶ src/App ── characterOf() → character, resolveMonsters() → monsters ──▶ src/lib/api.ts
  localStorage per vocation (gems) ──▶ │   OptimizerInput ▶ / ◀ OptimizerResult (+ alternatives, plannerCode)
                                       ▼
   WheelChart, ResultsPanel, ExportPanel (lib/planner → plannerUrl), VesselsPanel
                 components ◀── src/i18n (PL/EN; engine.<key> for EngineMessage)
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
├── docs/modules/           # data, wheel-data, planner-code, damage-model, character-formulas, proficiency, engine, ui, integration
├── scripts/
│   ├── scrape-monsters.ts  # offline tibiopedia.pl scraper → src/data/monsters.json
│   ├── extract-wheel.mjs   # planner WASM → src/data/wheel/wheel-data.json
│   ├── datamine-damage.mjs  # damage API → src/data/damage/spell-formulas.json
│   ├── datamine-damage-meta.mjs # curated cooldowns / areas / healing formulas
│   └── import-proficiency.mjs # TibiaPal trees + tibiopedia weapon stats → src/data/proficiency/proficiency.json
├── public/favicon.svg
├── index.html
├── vite.config.ts          # React + Tailwind plugins, CSP meta, third-party-licenses.txt (D37), chunk size limit
├── THIRD_PARTY_NOTICES.md  # sources and licenses; guarded by src/legal.test.ts (D37)
└── src/
    ├── types/index.ts      # shared contract (all modules)
    ├── data/               # monsters.json (2006) + search API (lazy-loaded chunk)
    ├── data/wheel/         # wheel-data.json (planner facts) + spells.ts, getWheelData(), plannerCode.ts
    ├── data/damage/        # spell-formulas.json + loader (spellAverageHit, isSingleTarget, …)
    ├── data/character/     # HP/mana/cap, default skills, mitigationPercent
    ├── engine/             # wheel/build.ts, spells, values, stances, proficiency, gems, optimizer, messages
    ├── components/         # React UI components
    ├── hooks/              # usePersistentInputs, usePersistentGems, useDebouncedValue
    ├── i18n/               # en/pl dictionaries (UI + engine.<key>), engineText(), provider
    ├── lib/                # api.ts facade, geometry, inputState, gems, labels, monsters, planner (pure, tested)
    ├── integration.test.ts # end-to-end tests (data + engine + input parsing)
    ├── App.tsx             # top-level state and layout
    ├── main.tsx            # entry; starts loading monster data
    └── index.css           # Tailwind v4 theme tokens
```

## 4. Module contracts

All cross-module types live in `src/types/index.ts`.

| Module | Public API | Consumers |
|--------|------------|-----------|
| `src/data` | `MONSTERS`, `searchMonsters(query, limit)`, `getMonsterById(id)` | UI (lazy, via `lib/api.ts`) |
| `src/data/wheel` | `getWheelData(v)`, `WHEEL_DATA`, `SPELLS`, `getSpell(name)` | Engine; UI `labels.gemName` |
| `src/data/wheel/plannerCode` | `encodePlannerCode`, `decodePlannerCode`, `plannerUrl`, `plannerVesselIssues`, `gridForSliceId`/`sliceIdForGrid` | Engine (export code); UI via `lib/planner` (`plannerUrl`) |
| `src/data/damage` | `spellAverageHit`, `healingAverage`, `spellCooldownTurns`, `isSingleTarget`, `defaultTargets`, `recommendedRotation`, `critMultiplier`, `revelationSpell`, `weaponBracket`, `pierceDamageMod`, `getRotationPresets` | Engine; UI (`getRotationPresets` via `lib/api`) |
| `src/data/character` | `maxHitPoints`, `maxMana`, `capacity`, `defaultCharacterStats`, `resolveCharacterStats`, `mitigationPercent`, `mitigationBreakdown`, `effectiveHp` | Engine |
| `src/engine` | `getWheel(v)` → `WheelDefinition` (slices, revelations, `vessels`, `mods`); `optimize(OptimizerInput)` → `OptimizerResult`; `pointsForLevel`; `ENGINE_MESSAGES` | UI |
| `src/i18n` | `useT()`, `translator(lang)`, `engineText(t, EngineMessage, fallback)` | UI |

Key contract types (`src/types/index.ts`):

| Type | Notes |
|------|-------|
| `OptimizerInput` | `vocation, points, monster, priority`, optional `context: FightContext`, `gems: OwnedGem[]`, `character: CharacterStats`, `monsters: WeightedMonster[]` (overrides `monster`), `alternatives` (default 2, max 5), `rotationId` (preset id; absent = auto), `forcedSpells` |
| `OptimizerResult` | allocation, path, revelations, convictions, stats, rationale (+`rationaleMsgs`), `vessels` (0-based `vesselId`), `gemRecommendations`, `upgradeRecommendations` (+`gainToMax`), `spells` (+`share` for useful damage spells), `rotation: RotationUsage` (`presetId` — `GREEDY_ROTATION_ID` `'boss'` for the greedy boss plan, labelled `rotation.boss` in the UI — `auto`, spells with share and `fromRevelation`), `plannerCode`, `alternatives` |
| `AlternativeBuild` | `label`/`labelMsg`, `tradeoff`/`tradeoffMsg`, `relativeScore` (% of the best build's objective, ≤ 100, sorted desc), `result` (with its own `plannerCode`) |
| `EngineMessage` | `{ key, params }` → UI looks up `engine.<key>`; English strings remain as fallback |
| `OwnedGem` / `ModDefinition` | quality lesser/regular/greater → 1/2/3 mods; grades I–IV; supreme `target` |

The UI reaches both modules only through `src/lib/api.ts`, which re-exports the engine and loads
`src/data` with a dynamic `import()` (separate chunk; `useMonsterData()` signals readiness).

Data flow: UI collects `OptimizerInput` (`characterOf(inputs)`, `resolveMonsters(inputs.monsters)`,
`monster: null`, `alternatives: 0` (D36), `rotationId` / `forcedSpells` from `usePersistentSpellPrefs`) → `optimize()` (in a Web Worker via `useOptimizer`, D42) returns `OptimizerResult` (allocation per slice, fill
path, activated perks, stat summary, rationale, vessels, `plannerCode`) → wheel, summary, export code and vessels render the best build.

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
  basic/supreme mods, momentum, Revelation Mastery, decoded community reference builds). `src/data/wheel/spells.ts`
  holds spell metadata (element, area, community avg hits, isNew). API: `getWheelData(v)`, `SPELLS`, `getSpell(name)`.
  Details: [`docs/modules/wheel-data.md`](docs/modules/wheel-data.md).
- **Damage model (iteration 3):** `scripts/datamine-damage.mjs` (`npm run datamine:damage`) fits per-spell
  formulas offline on the a public damage-calculator API → `src/data/damage/spell-formulas.json`.
  Loader: `spellAverageHit`, `spellCooldownTurns`, `isSingleTarget` (D16), `defaultTargets`, `recommendedRotation`,
  `critMultiplier`, `healingAverage`. Details: [`docs/modules/damage-model.md`](docs/modules/damage-model.md).
- **Weapon proficiency (D45):** `scripts/import-proficiency.mjs` (`npm run import:proficiency`) →
  `src/data/proficiency/proficiency.json` (weapons with stats and proficiency trees, dust shaping options).
  API: `WEAPONS`, `getWeapon`, `weaponsFor`, `searchWeapons`, `shapingOptions`, `shapingValue`.
  Engine (D46): `src/engine/proficiency.ts` (perk model, perk choice), weapon choice in `optimizer.ts`. Details: [`docs/modules/proficiency.md`](docs/modules/proficiency.md).
- **Character formulas:** `src/data/character/`: HP/mana/cap by level, default skills 200–1500, `mitigationPercent`
  (× wheel Mitigation Multiplier). Details: [`docs/modules/character-formulas.md`](docs/modules/character-formulas.md).

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
  - **Damage:** expected damage per rotation, built on the `src/data/damage` formulas and the character's level and skills (`input.character`; default level = points + 50).
    - **Rotations (D20):** one attack slot per 2 s turn. A preset (`src/data/damage/rotations.ts`) sets the cast ratios: `input.rotationId`, or auto = the best valid preset chosen jointly with the build (`requires.revelation` must be reached, `requires.shield` respected, `or` alternatives resolved by element vs the spot). Active revelation spells are cast on cooldown first; cooldowns and shared cooldowns are respected. Boss mode also tries the greedy plan (`boss`). `result.rotation` reports it for the main build and each alternative.
    - Per cast = hit × targets (hunt: community averages; boss: 1, area spells 1.2) × weighted element modifier over `input.monsters` × crit EV.
    - Augments, crit, cooldown, the flat bonus, revelation stages and passives are valued as a rotation delta. Augments of spells outside the rotation (transit slices) are worth 0 unless forced or healing.
    - **Forced spells (D21):** the search starts from the cheapest path to each forced spell's stage I augment; a rationale explains when points are insufficient.
  - **D16:** single-target spells are worth 0 in hunt mode. In boss mode, area spells count 1.2 targets.
  - **Defense = % effective HP (D18):** HP +x → 100·x/HP; mitigation or dodge +pp → 100·pp/(100−m); resistance → the same × the element's incoming share (physical by default). Base mitigation uses `mitigationPercent` with the D19 offhand defaults. Capacity and max mana are worth 0; healing counts as EHP; a uniform threat factor scales all defense. Gem slot 1 offers only HP or Mitigation Multiplier.
    - Leech is strongly devalued.
    - Avatar has value only in boss mode.
  - **Revelation Mastery** (slices, owned and recommended gems) is valued with look-ahead to the next stage.
- **Search** (`optimizer.ts`):
  - One beam search per rotation plan: a light screening pass (width 12) for every plan, then a full search (width 24) for the best plan and a runner-up within 2 %. Beam search (allocation-free ranking) over full-slice fills with revelation look-ahead and a partial last slice, plus a refine pass that damps one revelation at a time.
  - Returns `plannerCode` and `input.alternatives ?? 2` distinct alternatives (revelation focus, Avatar focus, priority shift), each with `relativeScore`, sorted best first. If an alternative search beats the main build on the main objective, it is promoted to main in the same pass.
  - Deterministic; worst case ~35–45 ms with alternatives.
- **Gems** (`gems.ts`):
  - Owned gems are placed with the Hungarian algorithm; active slots = min(gem, vessel) quality.
  - Recommendations are per quality at grade IV, only mods with positive value. Healing supreme gems are 0 for sorcerer/druid. Paladin uniques (Ballistic Mastery, Positional Tactics) are valued as exact damage deltas. Upgrades are +1 grade for active mods, ranked by gain.
- **Points**: `pointsForLevel(level, scrollPoints = 0) = max(0, level − 50)` (+ up to 50 scroll points).

## 7. UI (S3 UI)

Single-page React UI (`src/App.tsx`, `src/components/`, `src/hooks/`, `src/lib/`).
Inputs (vocation, points/level, monster, priority) live in `usePersistentInputs`
(localStorage + URL query) and feed `optimize()` in a Web Worker (`useOptimizer`, D42) — no Calculate button.
Results render as an SVG wheel (`WheelChart`, area-proportional slice fill, fill-order
badges, tooltips) and a `ResultsPanel` (scores, revelations, convictions, stats, rationale,
fill order). Components use only the `src/lib/api.ts` facade (real engine; monster dataset
lazy-loaded). Points are clamped to the 4000-point wheel capacity; the level helper uses
`pointsForLevel(level, scrollPoints)`. Dark Tibian theme via Tailwind v4 `@theme` tokens.
Iteration 2: fight context (Hunt/Boss + hunt style, in URL), a "My gems" editor (owned gems per
vocation in localStorage, passed as `OptimizerInput.gems`), a Vessels & gems results panel
(vessels, recommended gems, upgrades, spell usage) and a PL/EN switch (`src/i18n/`, typed
dictionaries, `useT()`; game terms stay English).
Iteration 3: character panel (level → points, scroll points, manual override, per-vocation skills →
`OptimizerInput.character`), hunting spot with several weighted monsters (`monsters`, weighted element chips),
"Best build · Alt 1 · Alt 2" switcher over `result.alternatives`, and a planner export (code, copy, planner link).
Iteration 4: hunt styles removed; `RotationPanel` (auto / preset, the viewed build's rotation with shares and ★ revelation spells,
forced spell augments; per-vocation localStorage + URL `r` / `fs`).
Details: [docs/modules/ui.md](docs/modules/ui.md).

## 8. Quality gates (S4 Integration)

| Gate | Command | Status (2026-11-18, iteration 4) |
|------|---------|---------------------|
| Types | `npm run typecheck` (`tsc -b`, strict) | 0 errors |
| Tests | `npm test` (Vitest) | 19 files, 485 tests (WASM round-trips run when `scripts/.cache/wod` exists) |
| Lint | `npm run lint` (oxlint) | 0 warnings |
| Build | `npm run build` | main 743 kB (163 kB gzip, incl. wheel data, damage formulas, fflate inflate) + lazy monster data 699 kB (76 kB gzip) + CSS 27 kB |
| Smoke | dev server + browser | RP level 600: auto rotation with shares, manual preset, forced Divine Dazzle, boss plan label, alternatives, PL/EN, legacy `h` link |

### Testing strategy

- **Unit, per module.**

  | Area | Files and tests |
  |---|---|
  | Data | `src/data/index.test.ts` (20), `src/data/wheel/wheel.test.ts` (38: planner facts, graph, vessels, mods, spells), `plannerCode.test.ts` (19: fixtures, legacy codes, 200 random builds vs the planner WASM), `damage.test.ts` (22), `character.test.ts` (14) |
  | Engine | `model.test.ts` (37), `spells.test.ts` (13), `gems.test.ts` (11: Hungarian vs brute force, placement, mitigation model), `optimizer.test.ts` (69: random-path validity, determinism, perf, reference builds), `iteration3.test.ts` (23: character, RM look-ahead, spots, alternatives, planner code), `iteration4.test.ts` (9: EHP, rotations, transit, forced spells) |
  | UI helpers | `src/lib/*.test.ts` (39) and `src/i18n/i18n.test.ts` (6: PL/EN parity including every engine key, `engineText` fallback) |

- **Integration (`src/integration.test.ts`, 165).** Runs the real data through the UI facade and the real engine.
  - 5 vocations × 2 fight contexts × 5 budgets (100–4000) with owned gems.
  - Checks the directed unlock path, that Avatar is valued only in boss mode, vessel placement and quality, recommendations, and that i18n keys resolve.
  - Iteration 4: no capacity / max-mana gem mods, forced spells reach the allocation, manual presets honoured (`auto=false`, alternatives too), `fromRevelation` only with the revelation active, Avatar only in boss rotations with its revelation, boss-plan label, planner codes with forced spells.
  - Iteration 3: D16 for every vocation, planner codes of 30 random inputs (main + alternatives) decode to the same allocation and gems and load identically in the official planner WASM, distinct labelled alternatives, weighted spots, character stats, new URL keys.
  - Also covers levels, priority extremes, real monsters, edge budgets, determinism, URL/localStorage round-trips and untrusted input.
  - Matrix: [`docs/modules/integration.md`](docs/modules/integration.md).
- **Smoke.** `vite build` + `vite preview`, with the page and every chunk served with HTTP 200.
- **Not covered.** DOM/component tests (no jsdom). UI logic is kept in pure, tested helpers instead.
