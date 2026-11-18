# Integration & QA (S4 Integration)

## Iteration 3 (2026-11-18)

### Files changed

| File | Change |
|------|--------|
| `src/lib/planner.ts` | Duplicate `PLANNER_URL`/`plannerUrl` removed. They are now re-exported from `src/data/wheel/plannerCode.ts`, the single source of the planner format. |
| `src/data/wheel/plannerCode.ts` | `plannerUrl` trims the code. This behaviour was previously only in the UI copy. |
| `src/engine/optimizer.ts` | Three fixes. (1) If an alternative's search beats the main build on the main objective, it is promoted to main and the alternatives are recomputed (up to 3 rounds). Before, `relativeScore` reached 106 % (paladin, hunt, 1200 points). (2) Alternatives are sorted by `relativeScore`. (3) A revelation-focus label names every revelation at the top stage, which avoids two identical "Ascetic focus" labels (monk, solo). |
| `src/engine/optimizer.ts` | `SpellUsage.share` is set again for useful damage spells. Iteration 3 had dropped it, so the UI "% dmg" never showed. |
| `src/engine/messages.ts`, `src/i18n/pl.ts` | `rationale.hunt` no longer says that single-target spells count for 1 target, which contradicted D16. PL wording was reviewed for the new keys (`rationale.character/singleTarget/spot/hpOverMitigation/mitigationOverHp`, `spell/gem.singleTargetHunt`, `alt.*`). It follows the UI terms "Hunt", "spell na pojedynczy cel" and "Expowisko", and keeps planner names in English (Hit Points, Mitigation Multiplier, Revelation). |
| `vite.config.ts` | The comment documents the new main chunk contents. The 800 kB limit is unchanged. |
| `src/integration.test.ts` | Iteration 3 E2E tests (see below). |

### Bundle

| Chunk | Size | Gzip | Contents |
|-------|------|------|----------|
| main | 724 kB | 158 kB | React, engine, wheel data, damage formulas (127 kB JSON), fflate `inflateSync` (tree-shaken) |
| data (lazy) | 699 kB | 76 kB | monsters |
| CSS | 27 kB | 6 kB | |

`optimize()` needs the damage formulas and the planner encoder synchronously for the first render, so both stay in the main chunk. fflate is used only for decoding; encoding uses the in-repo zlib-compatible deflater.

### Test matrix additions (`src/integration.test.ts`, 200 tests total, +65)

| Area | Cases |
|------|-------|
| D16 | 5 vocations × solo / team-lure / team-box (level 800, owned gems). Every single-target damage spell has `useful = false`, no share and `spell.singleTargetHunt`. No gem recommendation (main build or alternatives) boosts a single-target spell, and `rationale.singleTarget` is present. In boss mode, single-target spells are evaluated normally (at least 3 vocations have one). |
| Planner code | 30 seeded random inputs (vocation, 0–4000 points, priority, context, gems, character level). For the main build and each alternative, the code decodes to the same vocation, tile points and the vessel gems the planner can store. The export URL is checked too. |
| Planner WASM | The same 30 inputs: `updateByCode` returns 1, and the planner's tile points and vessel mods equal ours. Skipped if `scripts/.cache/wod/skillgrid.cjs` is missing. |
| Alternatives | 5 vocations × boss / solo at 1200 points. There are exactly 2 alternatives, pairwise ≥ 120 points apart (10 % of the budget). Codes and labels are distinct and `relativeScore` is in (0, 100]. Each alternative passes the full validity, directed-path and message checks, and its labels resolve in PL and EN. |
| Hunting spot | Askarak Demon (fire 125 %) + Chakoya Windcaller (energy 115 %) for a sorcerer in team-box. At 9:1 the top damage spell is not energy; at 1:9 it is. The allocations differ, scale-free weights give the same build, and the `rationale.spot` list reads "Askarak Demon 90%, Chakoya Windcaller 10%". The URL → `resolveMonsters` path gives the same engine input. |
| Character | A level 400 paladin gets `hpOverMitigation` and no lesser Mitigation Multiplier gem. A knight at level 400 vs 1500 (priority 100): the HP/mitigation ratio drops, Mitigation Multiplier becomes the lesser gem, and HP grows. Skills change gem gains. `characterOf` sends only the vocation's skills. |
| URL state | `lv sc sk sh ml m=id*w_…` round-trip. In a full link, absent optional keys clear their fields. Legacy `monsterId` migrates. Unknown ids, duplicates and invalid weights are dropped. |

### Browser check (dev server, T3 preview)

Paladin, level 600 → 550 points, with Dragon Lord + Demon added (URL `m=dragon-lord_demon`).
- Best, Alt 1 and Alt 2 each switch the shown build. Each has a different code, a label, a score and a trade-off.
- Copy code, Copy planner link and Open planner are present, and the link points to test.tibia.com with the code.
- In PL, boss mode gives "Nastawiony na Avatara (Avatar of Light)". The rationale lines render with no `{param}` left over.
- No console errors or warnings and no Vite overlay.

### Gate results (2026-11-18)

| Gate | Result |
|------|--------|
| `npx tsc -b` | 0 errors |
| `npx vitest run` | 17 files, 494 tests passed (WASM tests ran) |
| `npm run lint` | 0 warnings / errors |
| `npm run build` | OK (sizes above) |

### Open issues

- Healing formulas are approximate (canary), and the cooldowns of the 2026 spells are estimates.
- Armor is not modelled. Base mitigation assumes default equipment.
- Alternatives are absent near a full wheel: there is no room for a build ≥ 10 % different.
- UI polish is postponed (D15). There are no DOM/component tests.
- The header score is rounded ("92 %") while the trade-off text shows one decimal ("92.3 %"). This is cosmetic.

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
