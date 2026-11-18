# Integration & QA (S4 Integration)

## Iteration 2 (2026-11-18)

### Files changed

| File | Change |
|------|--------|
| `src/engine/values.ts` | Mitigation Multiplier now scales an estimated `BASE_MITIGATION` per vocation (`mitigationGain`) instead of being valued as a flat percentage. |
| `src/engine/gems.ts` | `UpgradeRecommendation.gainToMax` (gain from the current grade straight to IV). |
| `src/engine/messages.ts`, `optimizer.ts` | `rationale.threat` split into `threat` / `threatMax`, so no English fragment travels as a param. |
| `src/lib/devFixtures.ts` | Deleted; `App` passes `wheel.mods` directly. |
| `src/i18n/engine.ts` (new) | `engineText(t, msg, fallback)`: looks up `engine.<key>`, translates id params (elements, hunt styles, `unknown`), and falls back to the English string. |
| `src/i18n/en.ts`, `pl.ts` | `engine.*` keys: EN is generated from `ENGINE_MESSAGES`, PL is written by hand. New keys `common.unknown`, `common.active`, `upgrades.toMax`, `spells.share`. The dev-fixture key is removed. |
| `src/components/ResultsPanel.tsx` | Stats labels and rationale use `labelMsg` / `rationaleMsgs`. |
| `src/components/VesselsPanel.tsx` | Vessel label is `vesselId + 1`. Reasons are translated. Spell share is shown as "% dmg". Upgrades show "to IV" gain. |
| `src/components/GemsPanel.tsx`, `src/App.tsx` | `isFixture` prop removed. |
| `src/lib/labels.ts` | `gemName` reads `WHEEL_DATA.vessels.gemNames`. The guessed names were wrong: sorcerer is *Sage*, druid is *Mystic*. |
| `.gitattributes` | `* text=auto eol=lf` (stops CRLF warnings). |
| `vite.config.ts` | Comment documents the chunk sizes. |

### Decisions

- **Mitigation.** Effective damage-reduction gain = `BASE_MITIGATION[voc] × multiplier`.
  - Approximate bases: knight 20 %, monk 14 %, paladin 10 %, sorcerer and druid 6 %.
  - In-game: (defense + shielding) × equipment × wheel multiplier × stance.
  - Grade IV is +6 % reduction for a knight and +1.8 % for a mage, valued like a 1 % all-element reduction per point.
  - It stays the top defensive `basic1` choice for knights. Offensive mage builds now prefer mana.
- **Bundle.** `wheel-data.json` (~0.5 MB pretty, ~300 kB minified) is needed synchronously by `getWheel()`/`optimize()` for the first render, so it stays in the main chunk.
  - Main chunk: 629 kB (138 kB gzip). Lazy monster chunk: 699 kB (76 kB gzip). CSS: 26 kB (6 kB gzip).
  - Splitting per vocation would need an async engine API, so it is not worth it at 138 kB gzip.
- **Engine message params.** Proper names (monsters, spells, revelations) stay in English. Element and hunt-style ids are translated in the UI.

### Test matrix additions (`src/integration.test.ts`, 135 tests total)

| Area | Cases |
|------|-------|
| Vocation × context × points | 5 vocations × boss / solo / team-lure / team-box × 100/500/1000/2000/4000 points (100 cases). Each case owns 3 gems (lesser/regular/greater). |
| Per case | Valid path (old checks plus the **directed** planner unlock graph). Avatar spells are `useful` only in boss mode, and no Avatar mods are recommended while hunting. 8 vessels with ids 0–7, unlocked in order. Owned gems are placed at most once, in `min(unlocked, owned)` vessels, and the greater gem goes into a greater vessel when one is unlocked. Recommended gems never exceed the vessel quality. Recommendations are non-empty once a vessel is unlocked. Upgrades are +1 grade with `gainToMax ≥ gain`. Every engine message resolves in PL and EN with no leftover `{param}`. |
| Avatar | At 2000 points and priority 0, boss mode reaches an Avatar stage ≥ 1 and ≥ the hunting stage, for every vocation. |
| Targets | Great Fire Wave expects more targets in team-box than solo, and ≤ 1.2 against a boss. |
| Persistence | Fight context URL round-trip (`f`, `h`), invalid values dropped. Owned gems round-trip per vocation storage key, and corrupted JSON gives `[]`. |

Other new tests: the mitigation model and mage builds (`engine/gems.test.ts`), engine key parity and placeholders
in PL/EN plus `engineText` fallback (`i18n/i18n.test.ts`), and planner gem names (`lib/labels.test.ts`).

### Gate results (2026-11-18)

| Gate | Result |
|------|--------|
| `npm run typecheck` | 0 errors |
| `npm test` | 12 files, 353 tests passed |
| `npm run lint` | 0 warnings / errors |
| `npm run build` | OK. Main 629 kB (138 kB gzip), lazy data 699 kB (76 kB gzip), CSS 26 kB. |
| `vite preview` + curl | HTTP 200 for the page, a deep link with context, both JS chunks and the CSS |

### Open issues

- The mitigation base per vocation, spell `maxTargets`, team target counts and monk elements are estimates.
- tibiapal reference builds are in the legacy code format, and there is no planner export code.
- There are no DOM/component tests (no jsdom). UI logic lives in pure, tested helpers.
- Scroll points are not persisted.

## Iteration 1 (summary)

- Removed the UI fixture fallback. `MAX_POINTS` is 4000 (asserted against `getWheel().totalCapacity`). Added the promotion-scroll field.
- The monster dataset is lazy-loaded through `src/lib/api.ts` (`loadMonsterData`, `useMonsterData`). Unknown monster ids from the URL or storage are dropped.
- 31 integration tests cover levels, priority, monsters (Fury, Demon, Dragon Lord), edge budgets, determinism and untrusted input.
