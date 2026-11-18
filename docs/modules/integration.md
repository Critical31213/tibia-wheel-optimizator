# Integration & QA (S4 Integration)

## Files owned / changed

| File | Change |
|------|--------|
| `src/integration.test.ts` | New end-to-end tests: real dataset + real engine + input parsing (31 tests). |
| `src/lib/api.ts` | Fixture fallback removed; engine re-exported; monster data lazy-loaded (`loadMonsterData`, `isMonsterDataLoaded`, `useMonsterData`). |
| `src/lib/fixtures.ts` | Deleted. |
| `src/App.tsx` | Demo banner / `isDemoWheel` removed; waits for monster data before resolving `monsterId`. |
| `src/main.tsx` | Starts loading the monster chunk before the first render. |
| `src/components/MonsterSearch.tsx` | `ready` prop, "Loading monster data…" state. |
| `src/components/PointsInput.tsx` | Promotion scroll points field (0–50) for the level helper; effect-free text sync (lint). |
| `src/hooks/usePersistentInputs.ts` | Drops unknown monster ids once the dataset has loaded. |
| `src/lib/inputState.ts` | `MAX_POINTS` 100 000 → 4000 (wheel capacity); `withKnownMonster` helper. |
| `vite.config.ts` | `chunkSizeWarningLimit: 800` (the lazy data chunk is ~700 kB by design). |

## Integration decisions

- **No fixtures.** The engine returns real 36-slice, 5-ring, 4000-point wheels for all vocations, and the
  dataset has 2006 monsters, so the UI calls the real modules directly.
- **Rings.** UI geometry derives the ring count from `slice.ring`, so 5 rings needed no change. The only stale
  4-ring/unknown-capacity assumption was `MAX_POINTS = 100_000`; it is now 4000 and a test asserts it equals
  `getWheel(v).totalCapacity` for every vocation.
- **Bundle.** Before: one 964 kB JS chunk (160 kB gzip). After: main 267 kB (84 kB gzip) + lazy `data`
  chunk 699 kB (76 kB gzip). The public `src/data` contract stays synchronous; only the UI facade is lazy.

## Test matrix (`src/integration.test.ts`)

| Area | Cases |
|------|-------|
| Wiring | Facade returns nothing before `loadMonsterData()`, real data after; 5 vocations × (36 slices, 5 rings, 4000 capacity = `MAX_POINTS`, 4 revelations). |
| Levels | 5 vocations × level 100/300/600/1000 → valid path (unlock rule, capacities, only last slice partial), `pointsUsed = min(points, 4000)`, domain sums, revelation stages match thresholds, scores in 0–100. |
| Scrolls | `pointsForLevel(1000, 50) = 1000` reaches a stage ≥ 2 revelation. |
| Priority | Sorcerer vs Fury (energy 110 %, death 110 %): priority 0 has higher offense, priority 100 higher defense; rationale names the weakness. |
| Monster | Knight vs Demon at priority 70: valid build, rationale mentions Demon. |
| Edge budgets | 0, 1, 49, 51, 3999, 4000, 9999 (capped), `NaN`, priority 250. |
| Determinism | Same input → deep-equal result. |
| Search | "dragon" → Dragon first; hits resolve by id; empty query → []. |
| Input parsing | Invalid vocation, unknown monster id, negative / huge / fractional / `Infinity` / `NaN` points & priority, corrupted localStorage payloads, full URL round-trip → valid build. |

## Gate results (2026-11-18)

| Gate | Result |
|------|--------|
| `npm run typecheck` | 0 errors |
| `npm test` | 7 files, 115 tests passed |
| `npm run lint` | 0 warnings |
| `npm run build` | OK — 267 kB main + 699 kB lazy data chunk |
| `vite preview` + curl | HTTP 200 for page, main and data chunks |

## Open issues

- No component/DOM tests (no jsdom/testing-library installed); UI behaviour is covered only by pure-helper tests
  and a manual smoke run.
- Perk values, monk data and Vessel Resonance are approximations (see `engine.md`); gems are not modelled.
- Monster damage/max-damage data is incomplete for some legacy entries (see `data.md`).
- Scroll points are not persisted in the URL/localStorage (only the resulting points are).
