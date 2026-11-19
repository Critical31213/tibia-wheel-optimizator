# WORKLOG — Tibia Wheel of Destiny Optimizer

Ongoing journal of the development process: what was done, issues encountered,
architectural decisions, and work in progress. Newest entries at the bottom of
each section. Every agent appends its own entries, prefixed with its role.

Roles:
- **Coordinator** — main agent, sets up the project and delegates.
- **S1 Data** — Data & Scraper Specialist (`src/data`, `scripts/`).
- **S2 Engine** — Algorithm & Logic Engineer (`src/engine`).
- **S3 UI** — Frontend & UI Designer (`src/components`, `src/App.tsx`, styling).
- **S4 Integration** — Integration & Testing Lead (whole repo, docs, QA).

---

## Decisions (ADR-style, short)

| # | Date | Decision | Reason |
|---|------|----------|--------|
| D1 | 2026-11-18 | Stack: Vite 8 + React 19 + TypeScript + Tailwind CSS v4, Vitest for tests. | Static SPA is enough — no server required at runtime; fast dev loop; Tailwind fits a custom dark Tibian theme. |
| D2 | 2026-11-18 | Monster data is scraped **offline** by a Node script into a committed JSON file; the app ships static data. | tibiopedia.pl does not send CORS headers for browser use, and scraping a third-party site on every page view would be slow and impolite. |
| D3 | 2026-11-18 | One shared type contract in `src/types/index.ts`; each module exposes a small public API via its `index.ts`. | Lets the three implementation subagents work in parallel without touching each other's files. |
| D4 | 2026-11-18 | The 5 classes are Knight, Paladin, Sorcerer, Druid, Monk. | Monk was added to Tibia in 2025 and has its own Wheel of Destiny. |
| D5 | 2026-11-18 | Priority slider is a single number 0–100 (0 = max DPS, 100 = max survivability). | Simplest possible mental model for the user and a single weight for the optimizer. |
| D6 | 2026-11-18 | Node.js 26 LTS installed portably in `%LOCALAPPDATA%\node-portable` (no admin install). | Node was not present on the dev machine. |
| D7 | 2026-11-18 | Wheel data source switched to the **official test-server planner** (test.tibia.com, upcoming update). Its WASM module (`skillgrid.js`) + `SkillwheelStringsJsonLibrary.json` are downloaded manually via a browser (Cloudflare blocks scripts) into gitignored `scripts/.cache/wod/`; a Node script runs the WASM and generates static JSON. | Most up-to-date data (new spells, gems, vessels). The CipSoft binary itself is never committed or shipped. |
| D8 | 2026-11-18 | Fight context: Hunt/Boss toggle (manual only); Avatar revelations valued only in Boss mode. Hunt style Solo / Team-lure (~4–6 mobs) / Team-box (~8–10 mobs); Boss ≈ single target. Baseline spell target counts from community data `spell-average-hits` (cached in `scripts/.cache/hunt-data/`). | User requirement; counts are estimates to be verified. |
| D9 | 2026-11-18 | Spell augments valued automatically by context: expected targets, spell element vs monster resistances, single-target vs area. | User requirement. |
| D10 | 2026-11-18 | Gems: user-owned gem inventory (quality, mods, grades I–IV) placed optimally into vessels + recommendations of best gems and most valuable mod-grade upgrades. | User requirement. |
| D11 | 2026-11-18 | UI language switch PL / EN. | User requirement. |
| D12 | 2026-11-18 | Realistic mitigation: depends on shielding/level; tiny at mid levels (user's RP ≈ 1%). Target audience level 200–1500; HP preferred below ~1200 (EK) / ~1500 (RP) — must emerge from the math, not a hard rule. | User feedback. |
| D13 | 2026-11-18 | Character inputs per vocation: EK level+melee+shielding; RP level+distance+shielding+mlvl; MS/ED level+mlvl; Monk level+fist+mlvl. | Needed for HP/mana, mitigation, spell damage and healing (e.g. RP mas san scales with mlvl). |
| D14 | 2026-11-18 | Flat "Damage and Healing" bonus valued relative to real per-hit damage/healing; consider Revelation Mastery gems that reach the next revelation stage (bigger flat bonus). Leech slices strongly devalued. | User guidance. |
| D15 | 2026-11-18 | Multiple monsters per hunting spot with weights; best build + 2 alternatives; export-only planner code (incl. gems); gem/upgrade ranking by gain only (no cost). UI polishing postponed until functionality is accepted. | User answers. |
| D16 | 2026-11-18 | **Hunt mode (AoE hunting) never values single-target spells** (all hunt styles); single-target spells count only in Boss mode. | User rule. |
| D17 | 2026-11-18 | Damage model calibrated on a public damage-calculator API (`GET /meta/{vocations,stances,weapons,ammo,shields,perks,spells,creatures,charms}`, `POST /damage`). Datamined **offline** (polite: low rate, cached) into fitted per-spell formulas + perk effects committed as static data; no runtime dependency. | User: community estimates are very good; avoid hammering a third-party API on every slider move. |
| D18 | 2026-11-18 | Defense valued as effective HP (EHP = HP / (1 − mitigation)); the arbitrary "spike" factor is removed. Gem slot 1 offers only Hit Points or Mitigation Multiplier; capacity and max mana have no value (potions + mana-leech imbuement assumed). Default resistance: physical unless the spot's monsters favour another. | User discussion; mitigation never beats HP on 200–1500 with real values. |
| D19 | 2026-11-18 | Real mitigation formula (no fight modes in the current game): ≈ shielding/100 % + shield/spellbook/quiver defense × vocation factor; calibration points: RP shielding 108 → 1.07 %; RP + shield 2.5 % total (shield part 1.28 %); ED 781 → 0.4 % shielding + 0.87 % spellbook. RP: quiver (hunt, bow) / crossbow (boss); mages: spellbook; EK: shield only in the shield rotation. | User data + game source. |
| D20 | 2026-11-18 | Hunt styles removed (hunt targets = community averages; boss = 1). Damage based on rotation presets (`src/data/damage/rotations.ts`): engine auto-picks the best preset for the spot/build (user may override); revelation-unlocked spells (Divine Grenade, Executioner's Throw, Ice/Terra Burst, Spiritual Outburst; Avatars in boss) are added when the revelation is active; druid ultimate area spell (Eternal Winter / Wrath of Nature) chosen by resistance. Augments of spells outside the rotation (transit slices) have no value. | User guidance. |
| D21 | 2026-11-18 | Forced spells: the user can force wheel augments of chosen spells (utility, e.g. Divine Dazzle, Mystic Repulse, Heal Friend). Healing gems excluded for ED/MS; for RP/EK/Monk valued on the defense side. Ballistic Mastery (bow: +4 % physical/holy pierce; crossbow: +10 % crit extra damage) and Positional Tactics (+3 distance 70 % of the time, else +3 holy/healing mlvl) valued exactly. | User guidance + planner texts. |
| D22 | 2026-11-18 | community hunt target averages already include the wheel's area augment (Expanded Shape); without it a spell hits 0.5 fewer. Gem picks maximise overall damage; mods within 10 % of the chosen one's gain are listed as near-equal substitutes (`GemRecommendation.similar`); greater gem shown once with substitutes. | User guidance (EK Front Sweep vs Fierce Berserk tie). |
| D23 | 2026-11-18 | A vessel holds only a gem the player added; unlocked vessels without an owned gem stay empty (never a recommended gem). The search values Gem Vessel slices only by the slice's own effects (+1 flat) and owned gems the new vessel can hold; gem recommendations stay advice (all qualities) and do not affect the allocation. | User: priority 50 sorcerer chose "no revelation" because 3 vessel slices were worth ~20 pp EHP from assumed grade-IV gems. |
| D24 | 2026-11-18 | Stances (Vocation Adjustments 2026, TibiaWiki after the 7 July 2026 patch) are modelled and picked automatically per rotation plan by their build-independent value (damage vs the shared reference T0 + % EHP) at the user's priority. One stance per vocation; sorcerers one elemental + one aura. Elemental stances convert the next other-element spell: converted share = min(1, element casts / other casts). Serene uptime 80 %, 30 % of incoming damage from non-adjacent enemies (Divine Defiance dodge); Divine Defiance's healing magic level is valued through healing (e.g. Salvation). Monk presets carry their virtue. Elemental pierce capped at 2× sensitivity. | User request; values confirmed by the user (Q1–Q4). |
| D25 | 2026-11-18 | Base spell cooldowns follow TibiaWiki where the damage API datamine differs (`COOLDOWN_OVERRIDES`, applied on load): Shield Bash 4, Death Echo 6, Great Death Beam 6, Forked Glacier 6, Forked Thorns 6, Strong Ice Wave 4, Devastating Knockout 8, Mystic Repulse 8, Thousand Fist Blows 8, Intense Wound Cleansing 120 s. The rotation display includes the build's augment mods (cooldowns). | User: the DE – EW – DE – GDB rotation needs Death Echo's −2 s augment (DE was 4 s in the datamine). |
| D26 | 2026-11-18 | Gem steps: recommended gems are valued at grade I (a newly revealed gem); Fragment Workshop upgrades (+1 grade) are listed only once every unlocked vessel holds a gem. Revelation Mastery gems are valued by re-optimizing the wheel with the gem owned (greater, grade I): RM value = re-optimized objective with vs without the mod (beam width 16), plus the gem's basics; avatar RM is skipped outside boss mode; a full wheel keeps the static value. | User: players without gems or with small gems need small steps; an RM gem changes the best wheel, not only the stage. |
| D27 | 2026-11-19 | Mod grades belong to the character: a mod has the highest grade any owned gem shows, in every gem (`withSharedGrades` on load and in `runOptimizer`; grade edits apply to all gems). Upgrades are per mod (gain summed over placed gems). Recommended gems carry the character's grades. Supreme spell gems are valued against the build's wheel augments on the other spells, so a cooldown gem in an already full preset rotation is worth ~0. Shared-cooldown ties (Ice/Terra Burst) prefer the spell the rotation casts. UI: "Add to my gems" on recommendations, "Upgrade" on upgrades. | User: Fragment Workshop grades apply to every gem; cooldown gems change little when the rotation is fixed and already the best. |
| D28 | 2026-11-19 | A gem fits only a vessel of its own quality (lesser → lesser, regular → regular, greater → greater); previously any gem fitted any vessel with the lower quality's slots active. | User: small gems were placed into every vessel. |
| D29 | 2026-11-19 | Damage also buys sustain through imbuement life leech: +1 % damage adds leech share × HEAL_EHP × threat % EHP (offense weight += defense weight × that). Leech per hit follows the game (damage × leech × (0.1n + 0.9) / n); imbuement leech 50 % for EK/RP/monk (2× Powerful Vampirism), 25 % for ED/MS; the share is vs the main heal cast every turn. Gift of Life is halved while hunting. | User: players use leech imbuements, so damage is also survivability. |
| D30 | 2026-11-19 | A gem recommendation needs room: when every unlocked vessel of its quality holds a gem, it is shown only as a replacement of the weakest one there (gain = difference), otherwise dropped. Recommendation sections per quality are collapsible. | User: with 2× the same gem placed, do not recommend a third if there is no room. |
| D31 | 2026-11-19 | Life leech from wheel nodes, augments and supreme mods is valued by the D29 model: +1 pp = leech EHP / imbuement leech (knight/paladin/monk 50, sorcerer/druid 25). Without gems, leech nodes on the path are now taken when worth it. A notice by the wheel says gems are missing and can change the build a lot. Mana leech unchanged. | User: check whether leech nodes pay off without gems; suggest adding gems. |
| D32 | 2026-11-19 | Manual stance: Auto or a fixed stance set (incl. none) in the rotation panel; stored per vocation with the rotation prefs (localStorage, URL `st`). A manual stance applies to every plan, also over a preset's own stance. | User request. |
| D33 | 2026-11-19 | Monster weight up to 99 999 (step 1, wider field), so a weight can be kills per hour. | User request. |
| D34 | 2026-11-19 | Augment pairs whose value is mostly in stage II (e.g. Strong Ethereal Spear: I −2 s cooldown, II +380 % base damage) get up to 2 extra searches per plan, seeded with the cheapest paths to both slices; the best valid objective wins. The beam valued the first slice by stage I only and missed far pairs (boss paladin 600–800 pts: offense 25 → 56). | User: boss paladin should take 2× Strong Ethereal Spear (SES > Ethereal Barrage > Divine Barrage/Caldera). |
| D35 | 2026-11-19 | Forced augments carry a stage: I = at least one slice (a note says when the engine also takes II because it pays off), II = both slices of the cheapest pair. Forced revelation stages (I–III) in a second column: stages below the forced one get a large penalty in the search tables and fail plan validity. Reach per stage (`revelationOptions`): greedy cheapest domain fill (RM slices +125, partial last slice) vs the budget with owned RM gems → ok / with a new RM gem of grade g / after upgrading the RM gem to g / out of reach; locked stages are disabled in the UI (vessel cost of the gem is not counted). Supreme mods sharing a name get the effect appended (Base Damage / Critical Damage / Cooldown / Healing). Crit stays 10 % / +50 %. | User request; crit: weapon proficiency to come. |
| D47 | 2026-11-19 | Weapon proficiency, stage 4 (UI). "My weapons" panel (search, proficiency level, perk per level: Auto or manual, dust reshapes at rank 10, at most 2) stored per vocation in localStorage like gems; "Weapon" result panel with the chosen weapon and perks, the other owned weapons, worthwhile reshapes and a collapsible section of better unowned weapons (opening it turns on `suggestWeapons`). Perk labels PL/EN from the structured perk fields. | Plan approved by the user (D45). |
| D46 | 2026-11-19 | Weapon proficiency, stages 2–3 (model, joint choice). `src/engine/proficiency.ts` applies a weapon with one perk per unlocked level to the character (weapon-type skill, magic level, shielding), the spell model (weapon + ammo attack, element magic level, augments, crit, pierce, bestiary in hunt only, boss perk in boss mode, alpha/omega strike by assumed shares, flat spell damage from skill scaling, recomputed auto-attack for non-mages) and sustain (leech, healing). Per plan, owned weapons are ranked with auto perks (coordinate descent, manual choices kept); the best two get their own stance pick; after the search, weapon and perks are re-chosen with the build's stages and augments and re-searched if better. Result: ranking, top 3 dust reshapes (rank 10, at most 2 per weapon, from proficiency level 3), optional unowned suggestions. Two-handed weapons exclude the shield rotation. No weapons = unchanged behaviour. | User: assumptions for stage 1 questions (skip treeless weapons, bestiary perk off on bosses, rank 10 shaping, no mage auto-attack). |
| D45 | 2026-11-19 | Weapon proficiency, stage 1 (data). `npm run import:proficiency` joins TibiaPal's proficiency trees (432 weapons) with tibiopedia weapon stats into `src/data/proficiency/proficiency.json` (~25 kB gzip), plus 184 dust shaping options (rank 0/10; ranks in between linear, an estimate). Perks come from the client values, not the older wiki descriptions (139 disagreements, mostly rebalanced lines, listed in `meta.issues`). Monsters get `bestiaryClass` (21 classes, 1967/2006). 235 weapons without a known tree are not selectable yet. Plan: several owned weapons per character, auto or manual perks per level, the engine picks the best weapon with its perks jointly with the wheel; collapsed section for better unowned weapons. | User: proficiency scope, TibiaPal data, bestiary family, reshape recommendations, several weapons. |
| D44 | 2026-11-19 | Revelation Mastery points from several gems with the same mod add up (each in its own greater vessel); `ownedRmOffsets` already sums them. | Confirmed by the user. |
| D43 | 2026-11-19 | Gem recommendations need real room. (1) RM gems from the re-optimization (D26) now pass the D30 room rule, checked on the re-optimized wheel; room that only comes from a vessel the light probe unlocked is confirmed by a full search. (2) The re-optimized wheel must beat the current build, not only the plain probe. (3) The new gem must actually be placed by the vessel assignment there. (4) A placed RM gem is valued with vs without its own points (before it looked worthless, so any gem "replaced" it). Sweep: 170 steps (all vocations, 500–2500 points, hunt/boss), every top recommendation ends up in a vessel; 19 replacements all used. | User: after adding an RM gem, gems with a big gain were still recommended although there was no room and swapping did not pay. |
| D42 | 2026-11-19 | The optimizer runs in a module Web Worker (`useOptimizer`): one request at a time, only the newest pending input kept; the last result stays visible (dimmed, `aria-busy`) until the new one arrives; main-thread fallback without Worker support or after a worker error. The worker bundle (~460 kB, ~100 kB gzip) duplicates the engine, which the main thread still needs for the wheel and revelation reach. | User: keep the UI responsive (~65 ms worst-case compute per change). |
| D41 | 2026-11-19 | Forceable spells are the wheel (conviction) augments only; gem-only supreme spell mods are not listed. Supreme mods in the gem editor: general effects, then all Revelation Mastery mods, then augments by spell (Base Damage, Critical Damage, Cooldown, Healing). Warm performance budget 100 ms (D34 pair tries made the worst case ~65 ms; they win often enough to keep). | User: forced list mixed in gem augments; revelations before augments. |
| D40 | 2026-11-19 | Project license: MIT for the original code and docs (`LICENSE`, `package.json`), explicitly excluding third-party material (CipSoft game data, sources in THIRD_PARTY_NOTICES.md). | User: propose and apply a license. Permissive, compatible with the MIT and other permissive sources used. |
| D39 | 2026-11-19 | "Open planner" keeps the test-server planner: the official tibia.com planner still has the old wheel (Vessel Resonance instead of Gem Vessels, 245 differing strings), so it would misread our codes. `LIVE_PLANNER_URL` is ready; `npm run check:planner` and a weekly workflow fail once tibia.com has the new wheel, then `PLANNER_URL` is switched. | User chose: test link now, official once the update is live. |
| D38 | 2026-11-19 | Revelation reach pays for vessels: an RM gem counts only in an unlocked greater vessel (the 3rd vessel at the earliest), so reach adds the cheapest fill that unlocks enough vessel nodes (nodes on that path count toward the domain). The forced-stage penalty is graded per missing stage, so the search sees progress; before, low-valued revelations (e.g. druid Blessing of the Grove III at 1000 points) were not reached although marked reachable. | User: clarify the RM-gem reach. A sweep (all vocations, revelations, stages, with and without an RM gem, at the fewest reachable points) found no misses. |
| D37 | 2026-11-19 | Third-party notices: THIRD_PARTY_NOTICES.md lists every source with its license (incl. the MIT notice of reused formulas/data); the build ships it plus all bundled package licenses as `third-party-licenses.txt` (footer link). `src/legal.test.ts` fails when a script or app file uses an unlisted host or a runtime package has a non-permissive license. | Keep attribution legally complete and prevent unlisted sources. |
| D36 | 2026-11-19 | The alternative-builds panel is removed; the app requests no alternatives (faster). The engine API still supports them. | User: section not needed. |

---

## Log

### 2026-11-18 — Coordinator
- Created branch `feature/wheel-optimizer`.
- Installed portable Node v26.13.1 (npm 11.20).
- Scaffolded Vite + React + TS, added Tailwind v4 (`@tailwindcss/vite`) and Vitest.
- Wrote shared contract `src/types/index.ts` and stub public APIs:
  `src/data/index.ts` (`MONSTERS`, `searchMonsters`, `getMonsterById`) and
  `src/engine/index.ts` (`getWheel`, `optimize`, `pointsForLevel`).
- Created `WORKLOG.md`, `ARCHITECTURE.md`, `docs/modules/`.
- Delegating S1/S2/S3 in parallel, then S4 for integration.

### 2026-11-18 — S3 UI
- Dark Tibian theme (Tailwind v4 `@theme` tokens, Cinzel headings), favicon.
- Components: VocationPicker, PointsInput, MonsterSearch (ARIA combobox) + MonsterCard,
  PrioritySlider, WheelChart (SVG), ResultsPanel; two-column layout ≥ lg, 360 px OK.
- Inputs persisted to localStorage + URL query; live memoized recompute.
- `src/lib/api.ts` facade with removable fixture fallback (`src/lib/fixtures.ts`).
- `tsc -b`, `vitest run src/lib` (16 tests), `npm run build` green. Docs: `docs/modules/ui.md`.

### 2026-11-18 — S1 Data
- Scraper `scripts/scrape-monsters.ts` (cheerio + tsx; `npm run scrape:monsters`),
  polite: 2 workers, 400 ms gap, generic UA, 4 retries w/ backoff, gitignored HTML cache.
- `src/data/monsters.json`: 2006 monsters scraped from tibiopedia.pl (no fallback needed).
  Handles cookie-gated splash page, legacy text-only attack lists, HP 0 placeholders.
- `src/data/index.ts`: `MONSTERS`, ranked `searchMonsters`, `getMonsterById` + element helpers.
- Tests `src/data/index.test.ts` (20, incl. Dragon/Dragon Lord/Demon/Hydra/Grim Reaper
  spot checks) green; `tsc -b` clean. Docs: `docs/modules/data.md`.

### 2026-11-18 — S2 Engine
- Research: tibia.fandom.com is paywalled (HTTP 402) for automated fetch; used search summaries (fandom
  *Version 13 Updates*, player reports) + game data.
- **Finding:** the wheel has 5 rings (4×50, 8×75, 12×100, 8×150, 4×200 = 4000), not 4 rings; a full domain is
  exactly 1000, so revelation stage 3 needs a full domain. UI geometry is generic (ring count derived), no change needed.
- Implemented `src/engine/wheel/` (geometry builder, perk model, 5 vocation files, build/cache),
  `scoring.ts` (priority blend + monster tailoring), `optimizer.ts` (beam search + revelation look-ahead,
  partial last slice, stats, rationale), `pointsForLevel(level, scrollPoints = 0)`.
- Tests: `geometry.test.ts` + `optimizer.test.ts` (48 tests) green; `tsc -b` clean. Docs: `docs/modules/engine.md`.
- Approximate: perk value units, monk spell elements/passives, Vessel Resonance value; gems not modelled.

### 2026-11-18 — S4 Integration
- Removed the UI fixture fallback (`src/lib/fixtures.ts`, `FIXTURE FALLBACK` branches, `isDemoWheel` + demo banner).
- `MAX_POINTS` 100 000 → 4000 (5-ring wheel capacity, asserted against `getWheel().totalCapacity`); UI ring
  geometry was already generic. Added promotion-scroll points (0–50) to `PointsInput` → `pointsForLevel(level, scrolls)`.
- Bundle: 964 kB single chunk → 267 kB main + 699 kB lazy `data` chunk (dynamic `import('../data')` in
  `src/lib/api.ts`, `useMonsterData()`); `src/data` contract unchanged.
- Bug fixes: unknown monster ids from URL/localStorage were kept forever (now dropped via `withKnownMonster`
  once data loads); URL points could exceed wheel capacity; oxlint `set-state-in-effect` in `PointsInput`.
- `src/integration.test.ts` (31 tests). Gates: typecheck 0 errors, 115 tests pass, lint 0 warnings, build OK,
  `vite preview` serves page + chunks (HTTP 200).
- Docs: README rewritten, ARCHITECTURE unified (layout, gates, testing strategy), `docs/modules/integration.md`.

---

### 2026-11-18 — Coordinator (iteration 2)
- Extracted planner files via the built-in browser; verified the WASM runs in Node (`createModule()` → `SkillwheelPlanner`).
- Findings: 36 tiles = 6×6 grid ids 0–35 (`QTL0..QBR8`); directed unlock graph identical for all vocations; 8 vessels with fixed levels, unlocked in order by filling Gem Vessel slices; mod grades I–IV.
- Extended contract `src/types/index.ts`: `FightContext`, gem/mod/vessel types, new `OptimizerResult` fields (engine returns empty stubs for now).

### 2026-11-18 — S1 Data (iteration 2)
- `scripts/extract-wheel.mjs` (`npm run extract:wheel`): runs the planner WASM in Node, asserts every rule
  empirically, writes `src/data/wheel/wheel-data.json` (~0.5 MB, facts only). Loader `src/data/wheel/index.ts`
  (`getWheelData`, `SPELLS`, `getSpell`, `getWheelSpellNames`), types `src/data/wheel/types.ts`, spells `spells.ts` (57).
- Findings: unlock graph identical for all vocations (fill must be complete); revelation stages at 250/500/1000
  domain points, flat dmg/heal bonus Σ[0,4,9,20][stage]; RM slice = +125 to its own domain, RM gem = +150/165/180/225
  to the named revelation (thresholds only); augments: 2 copies, stage I then II order-independent; vessels
  lesser,regular,greater,lesser,greater,regular,greater,greater, vessel n unlocks at n+1 filled Gem Vessel slices
  (any), +1 dmg/heal per Gem Vessel slice; momentum 0/0.33/0.66/1 % per grade on supreme cooldown mods;
  mitigation dedication 0.075 %/pt. community builds are legacy codes (decoded, slice points only).
- New spells (2026 Vocation Adjustments): Shield Slam, Divine/Ethereal Barrage, Death Echo, Forked Thorns/Glacier,
  Thousand Fist Blows. Approximate: most `maxTargets`, monk elements (assumed physical).
- Contract note (for Coordinator/S2): `ModDefinition` lacks `effects`/numeric values and supreme `spell`/`revelation`/
  `category` detail — engine can read them from `getWheelData()`; consider mapping in `getWheel()`.
- Tests: `src/data/wheel/wheel.test.ts`; `vitest run src/data` 58/58, `tsc -b` clean. Docs: `docs/modules/wheel-data.md`.

### 2026-11-18 — S3 UI (iteration 2)
- Fight context panel (Hunt/Boss, Solo/Team-lure/Team-box, Avatar hint) → `optimize({ context })`; persisted in
  localStorage + URL (`f`, `h`). `InputState` gained `mode`/`huntStyle` (one-line fix in `src/integration.test.ts`).
- "My gems" collapsible editor: quality → slots, mods filtered from `wheel.mods`, inline grade I–IV, edit/remove;
  stored per vocation (`wheel-optimizer:gems:v1:<voc>`), not in URL → `optimize({ gems })`.
- Results "Vessels & gems": vessels, recommended gems, best upgrades, collapsible spells — empty states until S2.
- PL/EN i18n in `src/i18n/` (typed dicts, `useT()`, `<html lang>`, default from `navigator.language`).
- Dev-only mod fixture `src/lib/devFixtures.ts` (stripped from prod) — remove once `wheel.mods` is filled.
- Gates: `tsc -b` 0 errors, 126 tests (incl. i18n key parity, gem slot rules, gem/context persistence), lint 0, build OK.

### 2026-11-18 — S2 Engine (iteration 2)
- Rewrote `src/engine/`:
  - The wheel model now comes from `getWheelData()` (directed unlock graph, twin augments I/II, RM +125, 8 vessels, basic and supreme mods). The hand-written `wheel/vocations/*`, `perks.ts`, `geometry.ts` and `scoring.ts` are removed.
  - New `spells.ts` (context-aware targets, element, damage shares), `values.ts` (Parts per source), `gems.ts` (Hungarian placement, recommendations, upgrades) and `messages.ts` (i18n keys).
- Optimizer: beam search over the directed graph with revelation look-ahead. Vessel value = best placeable gem. Fills `vessels`, `gemRecommendations`, `upgradeRecommendations`, `spells`, `rationaleMsgs` and `labelMsg`.
- Assumptions: heuristic spell weights and baselines; the Mitigation Multiplier mod is taken literally; level ≈ points + 50.
- Tests: 4 engine test files. `tsc -b` clean, all tests pass, lint clean. Perf ≤ 10 ms at 4000 points. Docs: `docs/modules/engine.md`.

### 2026-11-18 — S4 Integration (iteration 2)
- **Mitigation fix.** Per the planner, the Mitigation Multiplier "increases your mitigation multiplicatively".
  - Gain = `BASE_MITIGATION[voc] × multiplier`. Approximate bases: knight 20, monk 14, paladin 10, mages 6 %.
  - It is no longer a flat reduction. Grade IV = +6 % for a knight and +1.8 % for a mage.
  - Offensive mage builds no longer pick it. Tests were added in `engine/gems.test.ts`.
- **Engine ↔ UI.**
  - Removed `src/lib/devFixtures.ts` and the `isFixture` prop.
  - Engine messages are translated (`src/i18n/engine.ts` `engineText`, `engine.*` in PL/EN, with element and hunt-style params translated).
  - The UI shows spell `share` and `gainToMax` (now filled by `gems.ts`). Vessels are labelled `vesselId + 1`.
  - `rationale.threat` was split into `threat`/`threatMax` so no English text travels as a param.
- **Bug fixed: gem names.** They were guessed (sorcerer "Mage", druid "Sage"). They now come from the planner's
  `GemNames` (Sage = sorcerer, Mystic = druid).
- **Integration tests.** 135 in `src/integration.test.ts`. The matrix is 5 vocations × 4 contexts × 5 budgets with owned gems.
  - Checks the directed path, that Avatar is valued only in boss mode, vessel quality and placement, non-empty recommendations, and that PL/EN keys resolve.
  - Also covers persistence round-trips (context in the URL, gems in localStorage) and Avatar stage in boss vs hunt.
  - The i18n parity test now covers every engine key.
- Added `.gitattributes` (`* text=auto eol=lf`).
- **Gates.**
  - typecheck 0 errors. 353 tests in 12 files pass. lint 0.
  - Build: main 629 kB (138 kB gzip; the wheel data is needed for the first render and is kept there on purpose), lazy monster chunk 699 kB (76 kB gzip).
  - `vite preview` serves everything with HTTP 200.
- **Docs.** README, ARCHITECTURE (pipeline diagram, contracts, gates), `docs/modules/integration.md`, `engine.md`, `ui.md`.

### 2026-11-18 — S3 UI (iteration 3)

- `CharacterPanel` replaces `PointsInput`: level drives points (`pointsForLevel`), scroll points, manual points override, per-vocation skills (D13, empty = auto) → `OptimizerInput.character` via `characterOf`.
- Hunting spot: several monsters with weights (max 10, 0.1–100), weighted-average element chips / damage types (`src/lib/monsters.ts`); passed as `monsters` with `monster: null`. Hunt mode notes that single-target spells are ignored (D16).
- `BuildSwitcher` (Best · Alt 1 · Alt 2) switches wheel/summary/export/vessels; `ExportPanel` shows `plannerCode` with Copy code / Copy planner link / Open planner (`src/lib/planner.ts`). Both show empty states until the engine fills `alternatives` / `plannerCode`.
- Persistence: new URL keys `lv sc sk sh ml`, `m` = `id[*w]` joined by `_` (legacy single `m` / `monsterId` migrated; a link with `v` treats absent optional keys as empty). Integration test inputs adapted (`monsters`, `withKnownMonsters`).
- New PL/EN strings; `tsc -b`, `vitest run` (363), lint and build pass.

### 2026-11-18 — S1a Planner code (iteration 3)

- Planner code reverse-engineered: `<V><ver>` + base64url (no padding) of raw deflate of 36 tile bytes (by grid id) + 8×3 vessel bytes `[basic1, basic2, supreme]` (`0xFF` empty). Mod keys = wheel-data ids; no grade stored. WASM uses zlib-ng level 9; re-implemented so codes are byte-identical.
- `src/data/wheel/plannerCode.ts`: `encodePlannerCode`, `decodePlannerCode` (incl. legacy `…0…`), `plannerUrl`, `plannerVesselIssues`, `sliceIdForGrid`/`gridForSliceId` (engine slice id = tile name). New dep `fflate` (inflate).
- Tests: planner fixtures + 200 random builds vs WASM (skip without cache). Spec: `docs/modules/planner-code.md`.

### 2026-11-18 — S1b Damage model (iteration 3)

- `scripts/datamine-damage.mjs` (`npm run datamine:damage`): 279 cached `/damage` + 9 meta requests to the damage API (2.5 s apart, stop on 429). Fits 144 spell variants on a shared level term g(L) (L/5 to 500, then /6, /7, /8…): ≤ 1.7 damage error, 4 monk spells ≤ 1.44 %.
- `src/data/damage/`: `spell-formulas.json` + loader (`spellAverageHit` with stage/part, base-damage % [not on level term], flat bonus × bonusFactor; cooldown turns, element, area, `isSingleTarget` D16, community targets/rotations, crit, game healing). Probe rules (crit, creatures, Combat Mastery, Ascetic, Lord of Destruction) in `rules`.
- `src/data/character/`: HP/mana/cap, default skills, `mitigationPercent` (RP ≈ 1 % mid levels); as pure eHP an HP point always beats a Mitigation point at 200–1500, so the engine should value mitigation as sustain.
- Docs: `docs/modules/damage-model.md`, `docs/modules/character-formulas.md`.

### 2026-11-18 — S2 Engine (iteration 3)

- **Damage model.** `spells.ts` was rewritten around a rotation model that uses `src/data/damage` formulas, character level and skills (`input.character`, default level = points + 50), weighted monsters and crit EV.
  - `off` = % change of rotation damage. Augments, crit, cooldown, the flat bonus (revelation stages and vessel slices), revelation extras and passives (Combat Mastery, Ascetic, Lord of Destruction) are valued as rotation deltas.
  - Healing spells use the healing formulas, on the defense side.
  - Shared cooldowns were added: Hell's Core / Rage of the Skies, Eternal Winter / Wrath of Nature, strikes.
- **D16.** Single-target spells are unusable in hunt mode: no share, no augment or gem value, and the `rationale.singleTarget` / `spell.singleTargetHunt` messages. Boss mode counts 1.2 targets for area spells.
- **Defense.**
  - HP is valued as effective HP vs spike (weighted `maxDamage`).
  - Damage reduction and the Mitigation Multiplier are valued as sustained reduction on the real base mitigation (`src/data/character`).
  - Leech is strongly devalued, and resistances are weighted by the spot's damage types.
  - Result: HP wins clearly at RP 400; mitigation is about equal to HP at EK 1500, and the lesser gem becomes Mitigation Multiplier at priority ≥ 90.
- **RM look-ahead.** RM slices and gems are worth only the next-stage gain. Owned RM gems are included in the search.
- **Multi-monster.** `input.monsters` weights are normalised (they override `monster`), and `rationale.spot` was added.
- **Search.**
  - Allocation-free candidate ranking, and only the top 8 states are completed.
  - A full wheel short-circuits the search.
  - A refine pass damps one revelation at a time and keeps the result if the exact objective improves.
  - Worst case is 31 ms including alternatives (was ~60 ms).
- **Alternatives / planner code.**
  - `alternatives` (default 2, max 5) offer revelation focus, Avatar focus (boss), and more defensive / more offensive builds, with a minimum distance of max(50, 10 % of the budget) points.
  - They come with `label(Msg)`, `tradeoff(Msg)` and `relativeScore`.
  - `plannerCode` is set on the main build and on each alternative; it is verified by decode, by an unlock-path replay and by the official planner WASM round-trip.
- **Messages.**
  - New keys: `rationale.character|singleTarget|spot|hpOverMitigation|mitigationOverHp`, `spell.singleTargetHunt`, `gem.singleTargetHunt`, `alt.revelationFocus|avatarFocus|defensive|offensive|tradeoff`.
  - PL translations were added in `src/i18n/pl.ts` so that `tsc` passes. **S4: please review the wording.**
- **Tests.**
  - New: `src/engine/iteration3.test.ts`.
  - `spells.test.ts`: the "boss favours single-target" check was replaced by D16 checks.
  - `gems.test.ts`: `BASE_MITIGATION` was removed, and `mitigationGain` now takes the valuation.
  - `optimizer.test.ts`: the perf test now uses the best of 3 runs per input, so parallel test workers do not cause false failures.
  - No integration test expectations changed.

### 2026-11-18 — S4 Integration (iteration 3)

- **Wiring.**
  - `src/lib/planner.ts` duplicated `PLANNER_URL`/`plannerUrl`. It now re-exports them from `src/data/wheel/plannerCode.ts`, where `plannerUrl` trims the code.
  - App passes `character` (`characterOf`), `monsters` (`resolveMonsters`, `monster: null`) and `alternatives: 2`. BuildSwitcher drives the wheel, summary, export and vessels.
- **Engine fixes found by E2E.**
  - An alternative could score above the "best" build (up to 106 %). Such a candidate is now promoted to main and the alternatives are recomputed.
  - Alternatives are sorted by `relativeScore`.
  - Revelation-focus labels name every revelation at the top stage, so two "Ascetic focus" labels can no longer appear together.
  - `SpellUsage.share` is restored. It had been dropped, so the UI "% dmg" never showed.
  - `rationale.hunt` no longer says that single-target spells count for 1 target (D16).
- **PL review.** The new engine keys were reworded to natural Polish with UI-consistent terms (Hunt, spell na pojedynczy cel, Expowisko). Planner names stay in English (Hit Points, Mitigation Multiplier, Revelation).
- **E2E tests.** +65 in `src/integration.test.ts` (200 in total).
  - D16 for 5 vocations × 3 hunt styles.
  - Planner codes for 30 random inputs, main build plus alternatives: each decodes to the same tile points and gems, and the official WASM `updateByCode` loads identical points and gems.
  - Alternatives are distinct, labelled and resolve in PL/EN.
  - Weighted spot: Askarak Demon ↔ Chakoya Windcaller flips fire vs energy.
  - Character: RP 400 → HP over mitigation; EK 1500 → Mitigation Multiplier.
  - New URL keys round-trip.
- **Browser** (T3 preview).
  - Paladin, level 600, 2 monsters. Alternatives switch, the export code and copy/open buttons render, and PL/boss rationales render.
  - No console errors.
- **Gates.**
  - `tsc -b` 0 errors. `vitest run`: 17 files, 494 tests. Lint 0.
  - Build: main 724 kB (158 kB gzip, incl. damage JSON and fflate inflate), lazy monsters 699 kB (76 kB gzip).
- **Docs.** README (character, spots, alternatives, export, data notes, `npm run datamine:damage`), ARCHITECTURE (pipeline, contracts, data flow, gates), `docs/modules/integration.md`, `engine.md`, `ui.md`.

### 2026-11-18 — Fix: max mana valued as offense

Max mana was scored as offense, so at DPS-leaning priority lesser gems for every vocation recommended Mana over Hit Points. A bigger mana pool does not raise damage: mana is now utility only (`K.MANA_UTIL`), HP gets a small utility tie-break (`K.HP_UTIL`). Test added in `iteration3.test.ts`; RM look-ahead test now checks the objective instead of the sum of stages.

### 2026-11-18 — S3 UI (iteration 4)

- Hunt style control removed (Hunt/Boss kept); `InputState.huntStyle` dropped, `context = { mode }`; legacy URL key `h` ignored and removed from links.
- New `RotationPanel` (right column): "Auto (best)" + `getRotationPresets(vocation)` with note / requirements; shows the viewed build's `rotation` (share %, ★ revelation spells, auto-picked); "Force augment for spell" select + chips from `getForceableSpells(vocation)` (augment slices + supreme-mod spells, `src/lib/api.ts`). Passes `rotationId` / `forcedSpells` to `optimize`.
- Persistence: `usePersistentSpellPrefs` + `src/lib/spellPrefs.ts` — localStorage `wheel-optimizer:spells:v1:<vocation>`, URL `r` / `fs`; unknown ids → auto; max 8 forced spells (tests in `spellPrefs.test.ts`).
- Tests: integration contexts reduced to boss / hunt; `docs/modules/ui.md` updated.

### 2026-11-18 — S1 Data (iteration 4)
- **Mitigation (D19)** in `src/data/character`:
  - Formula: `(shielding × vocFactor + 2.56 × offhandDefense)/100 × (quiver 0.877) × (1 + wheel%)`. vocFactor is K 1.148, P/M 1.13, S/D 1.112 (the vocation multiplier × 0.883).
  - It reproduces the user's in-game values exactly: RP 108 shielding with quiver → 1.07 %; RP with a shield → 2.50 % total, of which the shield is 1.28 % (assumed defense 50); ED level 781 → 0.40 % shielding + 0.87 % spellbook. The ED values use the defaults: shielding 36 and spellbook defense 34.
  - Generic server constants do not fit these values.
  - Defaults: paladin quiver, mages spellbook, knight and monk none. Typical shield and spellbook defense per level bracket comes from TibiaWiki item data, because tibiopedia.pl cannot be scraped.
  - New: `mitigationBreakdown` and `effectiveHp`.
  - Changed: the default mage shielding is now 28→40, and the `wielding`/`defense` options were removed.
- **Paladin weapons (D21)** in `src/data/damage`:
  - `weaponBracket(voc, level, 'bow' | 'crossbow')`. Bow brackets use Diamond Arrow; use `paladinWeaponFor(mode)` to pick the weapon for a mode.
  - `HitOptions.skillBonus`, `magicLevelBonus` and `paladinWeapon` evaluate Positional Tactics (`POSITIONAL_TACTICS`).
  - `BALLISTIC_MASTERY` holds the bow pierce 4 % and the crossbow +10 % crit extra damage.
  - `pierceDamageMod(mod, pct)`: pierce cancels resistance 1:1 up to a modifier of 1.0, then adds at half rate. This was probed with 6 damage API calls (`scripts/probe-pierce.mjs`, cached) and matched exactly.
- **Revelation spells (D20):** `REVELATION_SPELLS` / `revelationSpell(name)`, plus `unlockedBy` on damage spells. A test checks that every spell in `rotations.ts`, including the `or` alternatives, resolves to a formula.
- Docs: `character-formulas.md` and `damage-model.md` updated.

### 2026-11-18 — S2 Engine (iteration 4)
- **Hunt styles removed:** hunt targets are community averages, and boss mode counts 1 target (area spells 1.2). `huntStyle` is optional and ignored.
- **Defense = % effective HP (D18):**
  - HP +x → x/HP; mitigation or dodge → pp/(100−m); resistance → the same × incoming share.
  - The spike factor and the HP/mana/capacity utility hacks were removed; capacity and max mana are worth 0.
  - Gem slot 1 offers only HP or Mitigation Multiplier.
  - Base mitigation uses the D19 offhand defaults; the knight uses a shield only for `requires.shield` rotations.
  - Result: the lesser gem is Hit Points for every vocation, levels 200–1500.
- **Rotations (D20):**
  - Uses `input.rotationId`, or auto picks the best valid preset jointly with the build. In boss mode a greedy plan (`presetId: 'boss'`) also competes.
  - Revelation spells are cast on cooldown; `or` alternatives are resolved by element vs the spot.
  - One shared damage reference across plans keeps them comparable.
  - `result.rotation` is reported for the main build and for each alternative.
  - Perf: light screening search per plan, full search for the finalists. Worst case ~45 ms.
- **Transit and forced spells (D21):**
  - Augments of spells outside the rotation are worth 0 (`spell.notInRotation`).
  - Forced spells are seeded via the cheapest path to their stage I augment (`rationale.forced` / `forcedImpossible` / `forcedNoAugment`).
- **Gems:**
  - Healing supremes are 0 for sorcerer and druid (including Nature's Embrace cooldown), and valued as EHP for the others.
  - Ballistic Mastery and Positional Tactics are valued as exact damage deltas.
  - Only mods with positive value are recommended.
- **Messages:** new EN and PL keys.
- **Tests:** new `iteration4.test.ts`.
- **Test expectations changed:**
  - EK 1500 lesser gem → Hit Points (D18), in the iteration 3 and integration tests.
  - Hunt-style target tests rewritten.
  - Mitigation Multiplier per-vocation test: it now follows base mitigation (mages have a spellbook).
  - Weighted energy-weak sorcerer spot: the preset rotation keeps Death Echo on top; the test now checks the energy share and the rotation change.
  - Boss single-target spells may be `spell.notInRotation`.
  - i18n `rationale.hunt` no longer takes `{style}` (UI test).
- **Known:** at priority 50 the RP 500–800 hunt build takes Gift of Life 2, because 1 % EHP is weighted like 1 % damage. Divine Grenade (+ Divine Empowerment) wins at priority ≤ 20–35.
- **For the UI:** the greedy boss plan id `boss` needs a label.

### 2026-11-18 — S4 Integration (iteration 4)
- **Wiring:**
  - The greedy boss plan id `boss` is now `GREEDY_ROTATION_ID` in `src/types` (the engine reuses it). The UI labels it `rotation.boss` ("Boss: best plan vs one target" / "Boss: najlepszy plan na jeden cel"), both in `RotationPanel` and in the rationale `{rotation}` param.
  - Verified with no change needed: alternatives show their own `rotation`, `rotationId` / `forcedSpells` reach `optimize`, and legacy `h` links load.
- **PL review:** the new `rotation.*` and `engine.rationale/spell.*` keys were reworded (gender-neutral "Wzięto wymuszone augmenty", "Obrażenia liczone z rotacji", "Revelation" capitalised).
- **E2E (+25, `src/integration.test.ts` 165):**
  - No Capacity or Mana gem mods for any vocation, level, mode or priority.
  - Forced Divine Dazzle, Mystic Repulse and Heal Friend reach the allocation.
  - Every manual preset is honoured (`auto=false`, alternatives too).
  - `fromRevelation` is set only while the revelation is active.
  - The Avatar is in the rotation only in boss mode with its revelation.
  - The boss label is translated.
  - Planner codes work with forced spells.
- **Browser (RP 600):**
  - Auto rotation with shares, then a manual preset with Divine Grenade ★.
  - Forced Divine Dazzle: the slice is filled.
  - Boss label shown in EN and PL; alternatives work.
  - No Vite error overlay. The 2 console entries from page load were not inspected.
- **Gates:** tsc 0, vitest 19 files / 485 passed, lint 0, build OK (main 743 kB / 163 kB gzip).
- **Docs:**
  - README: rotations, forced spells, EHP defense and the real mitigation formula; hunt styles removed.
  - ARCHITECTURE: contracts, gates and tests.
  - `docs/modules/integration.md`.

### 2026-11-18 — D22 area augments + gem substitutesArea-augmented spells use the community average only with the augment (else −0.5 targets; `SpellEval.areaGap`). Gem recommendations carry `similar` (≥90 % of the chosen mod's gain; UI line "Near-equal substitutes"). EK 1200 pts max DPS: greater gem now Augmented Fierce Berserk, Front Sweep listed at 93 %. 487 tests.

### 2026-11-18 — S2 Engine (iteration 4 follow-up)
- **Fair search for revelation-gated presets (`searchPlan`):** when a preset's search misses its required revelation, the engine runs a second full search with that revelation boosted ×10. This only gives the preset a valid build; plans are still compared on the shared objective, with no bias toward beams.
- **Sorcerer at level 300, no monster:** priority 20 now picks Beam Mastery 1 with `ms-echo-gdb` at 250, 300 and 350 points. At 250 points it was missed before: the objective was 8.60 vs 8.52.
- **Priority 50 keeps no revelation:** about 20 pp EHP from the 3 Gem Vessel slices (recommended grade-IV HP gems) outweighs Beam Mastery's +5.5 % damage.
- **Manual mode:** uses the same offense reference as auto mode. Before, it was 1 for gated presets.
- **Alternative labels:** an alternative with no revelation is labelled `alt.noRevelation` ("No revelation" / "Bez objawienia") instead of "- focus".
- **Perf:**
  - Alternatives promote a better build in a single pass instead of up to 3 recompute rounds.
  - Plan screening uses width 8 with 1 completion.
  - Worst case is 45 ms (druid, 3200 points, boss).
- **Tests:** 3 new tests in `iteration4.test.ts`.

### 2026-11-18 — S3 UI (iteration 5)

- **Wheel:** domain captions under the wheel replaced by active revelation perks per quadrant ("Beam Mastery II · 520 pts"); empty when a domain has none.
- **My gems:** split into Lesser / Regular / Greater subsections, each with its own list and "+ Add gem". Amber highlight + note when the viewed build has unlocked vessels of that quality left empty (D23).
- **Vessels:** non-owned unlocked vessels show "Empty — add a gem" (a legacy `recommended` source is treated as empty).
- **Recommended gems:** grouped by quality with gain, reason and near-equal substitutes, or "—".
- **New:** `src/lib/vessels.ts` (`emptyUnlockedByQuality`, `recommendationsByQuality`, `activeRevelationsByDomain`) + 4 tests. tsc, vitest (49), lint, build clean.

### 2026-11-18 — S2 Engine (iteration 5)
- **D23 implemented:** `vesselAssignments` emits only `owned` or `empty`; `vesselTable` values a vessel slice as flat +1 plus the owned-gem placement gain (no recommended-gem assumption). `gemRecommendations` / `upgradeRecommendations` unchanged; planner code carries only owned gems.
- **Alternative labels:** focus alternatives that would share a name now list all active revelations (paladin 1200 hunt: "Gift of Life + Divine Empowerment focus" vs "Gift of Life focus").
- **Sorcerer L300 hunt, no monster:** priority 20 → Beam Mastery 1, `ms-echo-gdb` at 250/300/350 (1–2 vessels). Priority 50 → 250: no revelation (`ms-gfw-echo`, 2 vessels); 300/350: Gift of Life 1 (`ms-gfw-echo`). Beam Mastery still loses at 50 (alt "Lord of Destruction focus" 90/94/83 %).
- **Test expectations changed:** gems.test free unlocked vessels → `empty`; iteration3 owned-RM-gem test at 1200 points (at 1000 the gem now helps a second revelation instead of raising the top stage); iteration3 alternatives `relativeScore > 25` (was 50; paladin 600 boss alts ≈ 35 % once phantom vessel value is gone).
- **Tests:** new `iteration5.test.ts` (6). Engine 173 passed; perf worst ≈ 39 ms (sorcerer 3200 boss).
- **For S4:** `src/integration.test.ts` "character level and skills change the output" compares only gem `gain`s, now equal (3.2/1.8/1.4) although the supreme mod differs (Divine Caldera vs Ethereal Barrage); compare mods too. The `source === 'recommended'` branch there is dead code.

### 2026-11-18 — EK mitigation calibration

User Cyclopedia (EK): 119 shielding → 1.34 % (knight shielding factor 1.148 → 1.126); Ectoplasmic Shield (def 49) → +1.27 % (fits factor 2.56); with Sanguine Hatchet +1.51 % total (one-handed weapon defense not modelled yet, ~+0.24 %). Test added.

### 2026-11-18 — UI: wheel fill-order badges removed

Numbered badges on the wheel, the tooltip step and the `wheel.step` key were removed; the hint no longer mentions numbers. The fill-order list in the results panel stays.

### 2026-11-18 — Stances (D24)

Data `src/data/damage/stances.ts`; engine `src/engine/stances.ts` (character, spell model, defense); `pickStances` in `planSpecs`; result `stances`, rationale `rationale.stances` / `rationale.noStance`; shown in the rotation panel. Tests: `src/engine/stances.test.ts`; two tests updated (elemental conversion makes Energy Wave useful vs energy-immune targets; the energy spot picks Master of Decay since death ≈ energy there). Observed picks at level 600: EK Blood Rage (priority 0–50) / Protector (100); RP Sharpshooter / Divine Defiance (100); MS Decay or Flames + Exposed Weakness (0) / Sapped Strength (50+); ED Elemental Synthesis / Shared Conservation (100); EM Harmony (0) / Sustain (50+).

### 2026-11-18 — Lord of Destruction follows the elemental stance

User: sorcerer 850 points, offense, Master of Decay got Gift of Life instead of Lord of Destruction. Cause: LoD was valued as fire ×1.015–1.030 regardless of stance (only Hell's Core in a death rotation). Per wheel data it boosts the elemental stance type: Flames +2/3/4 % fire damage, Thunder +2/3/4 pp crit chance, Decay +15/25.5/30 pp crit extra damage (applied to natural + converted casts; assumption). LoD stage 1/2/3 with Decay: 0.8/1.6/3.2 → 1.9/3.5/5.4 % damage. 850 points, priority 0 now: Beam Mastery 2 + LoD 2. Tests added.

### 2026-11-18 — Search: augment pair look-ahead

User: is +1 magic level worth more than the second Death Echo augment? No: +1 ML ≈ 0.6 % damage, Death Echo stage II (+12 % base damage) ≈ 3.8 %. Stage I (−2 s cooldown) is worth 0 in the DE – EW – DE – GDB preset (every turn is already used and Death Echo deals less per cast than Energy Wave), so the beam search never filled the first copy and missed the pair (forcing Death Echo gave 25.1 vs 22.6 % damage). `rankOf` now credits stage II × LOOKAHEAD_WEIGHT while one copy is full and the other is affordable (ranking only). 850 points, priority 0: Beam Mastery 2 + LoD 1 + both Death Echo augments (25.2 %). RM look-ahead test relaxed: the plain knight build now already reaches stage 3, so the gem must give a higher stage or the same stage with fewer slice points.

### 2026-11-18 — Cooldowns from TibiaWiki (D25)

All 70 non-rune damage/healing spells checked against TibiaWiki; 10 differed (mostly 2026 spells). With Death Echo at 6 s its first augment (−2 s) is worth ~7.6 % damage (was 0) and stage II ~4 %. 850 points, priority 0: Beam Mastery 2 + LoD 1 + both Death Echo augments; DE 14.3 casts/min shown. The askarak/chakoya spot test no longer expects Master of Flames: with Great Death Beam at 6 s the Decay death-beam rotation wins both spots (Flames still wins at T0 without the wheel). Open: the 7 July 2026 patch also lowered base damage (Death Echo 85 → 75, Great Death Beam 170 → 155); check whether the damage API formulas include it.

### 2026-11-18 — Damage & healing analysis; gem steps (D26)

- +1 flat damage & healing equals 5/6/7/8/9 levels (breaks 500/1100/1800/2600): ~0.2 % rotation damage at level 300, ~0.09 % at 2500. A used spell's augment is worth 5–15× more per wheel point; flat D&H comes from domain points (revelation stages) and vessel slices, not from a separate choice. The engine values it at its marginal value and does not chase it.
- Front Sweep's augment falls at level 2500 (6.8 % → 1.5 %) because Groundshaker out-damages unaugmented Front Sweep in the greedy rotation; the augment's value is the gain over Groundshaker. Not a bug.
- Vessel resonance: +1 per filled Gem Vessel slice confirmed by the user (TibiaWiki's gem-size rule predates the update).
- D26 implemented (`withRmReoptimized`, `NEW_GEM_GRADE`); warm performance budget raised to 75 ms (RM probes ~+60 %).

### 2026-11-19 — Gem buttons, shared grades, cooldown gems (D27)

- The Energy Wave cooldown gem (sorcerer, ms-echo-gdb) was worth ~4 because supreme gems were valued in a rotation without the build's other augments: without Death Echo's −2 s, Death Echo was cooldown-capped and spare turns went to Energy Wave. With the build's augments the rotation is full and ratio-bound, so the gem is worth ~0; Great Death Beam damage now leads.
- D27 implemented (engine `modGrades` / `withSharedGrades`, per-mod `upgrades`; lib `updateGem`, `setModGrade`, `gemFromRecommendation`; VesselsPanel buttons).

## In progress / Next

- [x] S1 Data — scraper + monster dataset + search API.
- [x] S2 Engine — wheel model for 5 vocations + optimizer.
- [x] S3 UI — components, dark Tibian theme, wheel visualization.
- [x] S4 Integration — wire everything, zero TS errors, tests, docs, README.
- [x] Iteration 2 — official planner data extracted (S1), fight context + gems editor + PL/EN UI (S3).
- [x] Iteration 2 — engine on planner data: context-aware spells, Avatar boss-only, gems & vessels (S2).
- [x] Iteration 2 — integration: mitigation fix, engine messages i18n, fixtures removed, E2E matrix (S4).
- [x] Iteration 3 — planner code (S1a), damage model + character formulas (S1b), rotation engine, D16, alternatives (S2), character / spot / alternatives / export UI (S3), integration + E2E (S4).
- [x] Iteration 4 — D18–D21: EHP defense, real mitigation, rotation presets, forced spells, hunt styles removed (S1–S4).
- [ ] User acceptance of iteration 4 functionality, then UI polish (postponed per D15).

Open issues:
- Healing formulas are approximate (community healing formulas); verify against in-game values.
- Cooldowns of the 2026 spells are approximate (community rotation presets).
- Armor is not modelled; base mitigation assumes default equipment per vocation.
- UI polish postponed (D15); no DOM/component tests (jsdom + Testing Library).
- No alternatives near a full wheel (no room for a ≥ 10 % different build).
- Some legacy monsters lack damage types / max damage.
- At priority 50 the RP 500–800 hunt build still goes into the Gift of Life domain after D29 (cheap HP/mitigation slices on the way decide it); Divine Grenade wins at priority ≤ 20. User reviews after D29.
- Paladin mitigation: shield defense 50 confirmed (Gnome Shield); the quiver factor (0.877) still comes from a single data pair.
- Monk at priority 50 picks Virtue of Sustain (healing +63 % → ~23 % EHP via K.HEAL_EHP); same open offense/defense exchange-rate question as RP Gift of Life. Virtue of Harmony uses the Ascetic probe (+1 pp base bonus → ×1.0478 spender damage).
- Rotation preset notes are English-only data strings (not translated in PL).
- Consider a Web Worker for `optimize()` if the beam width or alternative count grows.
