# Data module

## Purpose

Provide the app with a static, searchable dataset of Tibia monsters: hitpoints,
experience, elemental damage modifiers (how much damage the monster *takes* per
element), damage types it *deals*, an estimated max damage, image and source
link. The data is scraped **offline** from [tibiopedia.pl](https://tibiopedia.pl)
and committed as JSON (see decision D2 in `WORKLOG.md`).

Wheel of Destiny data (official planner facts, spell metadata) is documented separately in
[`wheel-data.md`](wheel-data.md).

## Files owned

| File | Role |
|------|------|
| `scripts/scrape-monsters.ts` | Offline scraper (run with `tsx`). |
| `scripts/.cache/` | Raw HTML cache (gitignored). |
| `src/data/monsters.json` | Generated dataset — array of `Monster`, sorted by name. |
| `src/data/spots.json`, `src/data/spots.ts` | D99: hunting spots with their creatures and weights (see below). |
| `src/data/monsters.d.json.ts` | Types the JSON import as `Monster[]` (via `allowArbitraryExtensions`). |
| `src/data/index.ts` | Public API: `MONSTERS`, `searchMonsters`, `getMonsterById` + helpers. |
| `src/data/index.test.ts` | Vitest tests (shape validation, spot checks, search ranking). |

## Public API (`src/data/index.ts`)

| Export | Description |
|--------|-------------|
| `MONSTERS: Monster[]` | Whole dataset, sorted by name. |
| `searchMonsters(query, limit = 10)` | Case/diacritic-insensitive search. Ranking: exact > prefix > word-prefix (`"lord"` → *Dragon Lord*) > substring > space-insensitive substring (`"dragonlord"`); ties by shorter name, then alphabetically. |
| `getMonsterById(id)` | O(1) lookup by slug; `undefined` if unknown. |
| `getModifier(monster, element)` | Damage-taken % for one element, default 100. |
| `getWeakestElements(monster, elements = ATTACK_ELEMENTS)` | Elements sorted by damage taken, highest first; immunities (0) dropped. |
| `getStrongestElements(monster, elements = ATTACK_ELEMENTS)` | Only resisted elements (< 100), strongest resistance first. |
| `getBestAttackElement(monster)` | First entry of `getWeakestElements`, or `physical`. |

The module itself is synchronous. The UI never imports it statically: `src/lib/api.ts` loads it with a
dynamic `import('../data')`, so the dataset ships as a separate ~700 kB (76 kB gzip) chunk.
| `normalizeText(s)` | The normalisation used by search (lowercase, no diacritics, non-alphanumerics → space). |

## Data source and page structure

The site is in Polish. Without cookies every URL redirects to a language
"setup" splash page, so the scraper sends `Cookie: tp_lang=pl; tp_layout=library`.

**List page** — `https://tibiopedia.pl/monsters/all`. One `<table>` per section,
identified by its `<caption>` text. Rows: image, name link
(`/monsters/<Name_With_Underscores>`), exp, HP, … and a coarse
immune/strong/weak summary (no percentages). Sections and whether we import them:

| Section (caption) | Imported |
|-------------------|----------|
| Potwory (bestiary monsters) | yes |
| Bossy (bosses) | yes |
| Potwory powiązane z questami (quest monsters) | yes |
| Pozostałe (other) | yes |
| Gladiatorzy – … (arena, 5 tables) | no |
| Eventowe (event-only) | no |
| Pułapki (traps) | no |

**Detail page** — `https://tibiopedia.pl/monsters/<Name>`; everything lives
inside `table#monsterDetail` (the page also shows *other* monsters' resist boxes
in sidebars, so parsing is scoped to that table):

| Data | Location |
|------|----------|
| name | first text node of `caption` |
| image | `td.monsterPic img[src]` |
| experience | `table.monster_base_stats` row labelled `Doświadczenie:` → `<strong>` |
| hitpoints | same table, row `Życie:` |
| resistances | `div.monster_resist` boxes: `img[src]` = `elements/<Element>.gif`, `img[title]` = Polish name, inner `div` text = `+80%` / `-10%` / blank; inner `div[title]` = description (`Niewrażliwość…`, `Neutralność…`, `Mocna strona…`, `Słaba strona…`) |
| attacks | row after the `Ataki:` header. Modern pages: `span.att_color_<type>` (damage range `70-110`) + `img[src*="attacks/elem_<type>.gif"]`. Legacy pages (~400, mostly old bosses): plain text `Walka w zwarciu(0-2000)` / ` - Death Beam(0-600)` without icons. Unknown: `Ataki nieznane` / `?`. |
| max damage | `table.monster_dmg_types` → text `Max DPS: 245` |

## Scraping logic, step by step

1. Fetch the list page (cached), parse the included section tables into
   `{name, url, section, imageUrl, exp, hp}` entries, dedupe by URL.
2. For each entry fetch the detail page with a pool of **2 workers**, a global
   **400 ms** gap between network requests, a descriptive generic User-Agent
   and up to **4 retries** with exponential backoff (1 s, 2 s, 4 s, 8 s).
   Every response is written to `scripts/.cache/` — re-runs read from disk and
   do not touch the network.
3. Parse the detail page (rules below). Detail values win; list values (exp,
   HP, image) are fallbacks.
4. Sort by name, make slugs unique (`-2`, `-3` suffix on collision), write
   `src/data/monsters.json`. Unmapped icons are printed at the end.

## Element mapping

Resistance boxes are mapped by **icon file name** (language independent); the
Polish `title` is a fallback. Attack icons use `attacks/elem_<name>.gif`.

| Polish label | Resist icon | Attack icon | `Element` key |
|--------------|-------------|-------------|---------------|
| Ataki fizyczne / fizyczne | `Physical.gif` | `elem_physical` | `physical` |
| Ogień | `Fire.gif` | `elem_fire` | `fire` |
| Ziemia | `Earth.gif` | `elem_earth` (`elem_poison`) | `earth` |
| Energia | `Energy.gif` | `elem_energy` | `energy` |
| Lód | `Ice.gif` | `elem_ice` | `ice` |
| Świętość | `Holy.gif` | `elem_holy` | `holy` |
| Śmierć | `Death.gif` | `elem_death` | `death` |
| Wysysanie życia | — | `elem_life_drain` | `lifeDrain` |
| Wysysanie many | — | `elem_mana_drain` | `manaDrain` |
| Tonięcie | — | `elem_drowning` | `drown` |
| Leczenie | — | `elem_heal` (ignored — monster self-heal) | (`healing`) |

The site only lists resistances for the 7 attack elements, so
`elementModifiers` never contains `lifeDrain`/`manaDrain`/`drown`/`healing`.

## Normalization rules

- `id`: name → NFD, diacritics stripped, lowercase, apostrophes removed,
  non-alphanumeric runs → `-`, trimmed (`"Dragon Lord"` → `dragon-lord`).
- `elementModifiers` = percent of damage **taken** (100 = neutral). The site
  shows the *resistance*, so: `+80%` → `20`, `-10%` → `110`, black
  "Niewrażliwość" box → `0`, blank "Neutralność" box → `100`. Boxes whose value
  is unknown on the site (`?%`) are **omitted**, never guessed.
- `damageTypes`: union of attack icons (minus `heal` and `agony`, which has no
  `Element` key), in `Element` order. On legacy text-only pages, melee
  (`Walka w zwarciu`) → `physical` and the element of each spell is inferred
  from keywords in its name (`fire|flame|lava…` → fire, `energy|lightning…` →
  energy, `death|curse…` → death, …); spells with no recognisable keyword are
  ignored.
- `maxDamage`: the site's "Max DPS" (measured standing still without
  equipment). If absent, the highest upper bound of any single attack range.
  Absent if neither exists.
- `hitpoints` / `experience`: integers; `-`/`?` → omitted. The site uses
  `Życie: 0` as a placeholder for "unknown", so HP 0 is omitted, and the
  experience next to it is omitted too unless it is > 0. Experience 0 with
  real HP (summons, quest creatures) is kept.
- `bestiaryClass` (D45): from the "Klasa" link slug (`/monsters/dragons` → `Dragon`); the 21 classes of
  `BESTIARY_CLASSES`. "Pozostałe" (others) has none.
- `imageUrl`: absolute tibiopedia.pl GIF URL (hot-linked). `sourceUrl`: detail page URL.

## Re-running the scraper

```bash
npm run scrape:monsters                 # uses scripts/.cache when present
npm run scrape:monsters -- --refresh    # re-download everything (≈15–35 min)
npm run scrape:monsters -- --limit 20   # quick debug run on the first 20
npx vitest run src/data                 # validate the new JSON
```

## Hunting spots (D99)

`src/data/spots.json` (generated by `npm run import:spots`, `scripts/import-hunting-spots.mjs`; cache in
`scripts/.cache/spots/`, `--refresh` downloads again):

- Spots: pages of TibiaWiki `Category:Hunting_Places` (MediaWiki API); creatures from their `{{CreatureList}}`,
  matched by name to `monsters.json`. Only creatures with a bestiary class (no bosses); creatures killed less than 1 %
  as often as the most killed creature of the spot are dropped; at most 10 per spot (most killed first); spots with
  fewer than two creatures are skipped, and so are places whose highest recommended level (wiki infobox, any vocation)
  is 100 or less (they still count when checking whether a creature lives on one spot only). Places hunted as separate spots are split by hand (`SPLIT` in the script, e.g.
  Podzilla → Podzilla Quaras, Podzilla Rootthings; Book World → Chapters II–IV; Secret Library → Fire, Energy, Ice, Earth Library); creatures not listed there are dropped.
- Curation (D100, `scripts/hunting-spots.overrides.json`, keyed by wiki title): `remove` drops marginal creatures from
  the spot's top 10 (they still count as living there for the weights); `display` shows the spot under its common
  name; `names` adds other common names. Spots carry `aliases` (the other names, incl. the wiki title when renamed),
  shown as a tooltip on the spot button and the combined card. The script fails on an unknown place or creature.
- Weights: last-week kills of every world (TibiaData kill statistics), summed. A spot gets kill shares (%) only when
  each of its creatures is found in the statistics and appears in no other hunting place; otherwise every weight is 1.
- API: `spotsWithMonster(id)` (`src/data/spots.ts`): spots with the monster, the ones where it has the largest share
  first. The spot panel shows up to three of them after the first monster is chosen; a click replaces the list with
  the spot's creatures (the chosen monster first). While the list holds exactly the creatures of a spot (any weights), the combined card is titled with the spot's name (`spotOf`).

## Known limitations

- Values are only as accurate as tibiopedia.pl; some monsters show `?%`
  resistances (omitted) or have no attack data (`damageTypes: []`).
- "Max DPS" is the site's own measurement, not a theoretical maximum.
- Images are hot-linked from tibiopedia.pl; if that becomes a problem they
  should be downloaded into `public/`.
- Coverage of the 2006 records (2026-11-18 run): 489 without HP (site
  placeholder), 811 without any damage type (mostly `Ataki nieznane`), 856
  without `maxDamage`; 11 without any resistance data. Element inference on
  legacy pages is heuristic.
- Spot-checked against Tibia knowledge: Dragon, Dragon Lord, Demon, Hydra,
  Grim Reaper (Grim Reaper takes 20% death damage — 80% resistance — not 0).
- No curated fallback is needed: the site was reachable and the full
  dataset is committed. If the site becomes unreachable, the committed JSON
  (and the local cache, if present) remain the source.
- `scripts/` is not part of any `tsconfig` project, so `tsc -b` does not
  type-check the scraper (tsx runs it without type checking).
- No boss/category flag is stored, because `Monster` has no such field.

## Work log

- 2026-11-18 — Investigated tibiopedia.pl (cookie-gated language splash,
  `/monsters/all` list, `#monsterDetail` structure). Wrote cheerio-based
  scraper with cache/retries/delay, scraped the full list of included
  sections, wrote search API + helpers, tests and this document.
- 2026-11-18 — (resumed after interruption) Completed the scrape: 2006
  monsters (≈2000 pages fetched at 2 workers / 400 ms, all cached). Added
  parsing of legacy text-only attack lists, ignored `agony`, treated HP 0 as
  unknown. Fixed Grim Reaper spot check (death 20). Tests 20/20, `tsc -b` clean.
