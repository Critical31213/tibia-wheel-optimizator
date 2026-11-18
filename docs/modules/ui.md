# UI module (S3 UI)

## Purpose

Single-page React UI: the user picks a vocation, promotion points, an optional
target monster and a DPS ↔ survivability priority; the optimized wheel build is
recomputed live (no "Calculate" button) and shown as an SVG wheel plus a text
breakdown. English only, dark "Tibian" theme, works from 360 px wide; on `lg`
screens it is two columns (controls left, results right).

## Files owned

| File | Role |
|------|------|
| `src/App.tsx` | Layout, state wiring, memoized `optimize` call. |
| `src/components/Panel.tsx` | Bordered section card with numbered heading. |
| `src/components/VocationPicker.tsx` | 5 toggle cards, `radiogroup`. |
| `src/components/VocationIcon.tsx` | Stroke icon per vocation. |
| `src/components/PointsInput.tsx` | Points input + "or character level" helper + promotion-scroll points (0–50). |
| `src/components/MonsterSearch.tsx` | Debounced ARIA combobox + selected `MonsterCard`. |
| `src/components/MonsterCard.tsx` | Name, HP/exp, element chips, damage types. |
| `src/components/PrioritySlider.tsx` | 0–100 range slider. |
| `src/components/WheelChart.tsx` | SVG wheel, fill-order badges, tooltip, legend. |
| `src/components/ResultsPanel.tsx` | Scores, revelations, convictions, stats, rationale, fill order. |
| `src/hooks/useDebouncedValue.ts` | Generic debounce hook. |
| `src/hooks/usePersistentInputs.ts` | Inputs state persisted to localStorage + URL. |
| `src/lib/api.ts` | UI facade over `src/engine` + lazily loaded `src/data` (`loadMonsterData`, `useMonsterData`). |
| `src/lib/geometry.ts` | Pure SVG geometry helpers (tested). |
| `src/lib/inputState.ts` | Input (de)serialisation + validation (tested). |
| `src/lib/labels.ts` | Labels, colours, `clamp`, `cx`, `modifierKind`, `priorityLabel` (tested). |
| `src/index.css`, `index.html`, `public/favicon.svg` | Theme, fonts, icon. |

## Component tree

```
App
├─ VocationPicker      value, onChange(vocation)
├─ PointsInput         value, max (= wheel.totalCapacity), onChange(points)
├─ MonsterSearch       value: Monster | null, ready (dataset loaded), onChange(monster | null)
│  └─ MonsterCard      monster
├─ PrioritySlider      value, onChange(priority)
├─ Panel › WheelChart  wheel, result | null
└─ Panel › ResultsPanel wheel, result   (empty-state text when points = 0)
```

Components never import `src/engine` / `src/data` directly — only `src/lib/api.ts`.

## State flow

1. `usePersistentInputs()` holds `{ vocation, points, monsterId, priority }`.
   Initial value = defaults ← localStorage (`wheel-optimizer:inputs:v1`) ← URL query
   (`?v=druid&p=420&m=demon&prio=75`; URL wins). Every change is written back to
   localStorage (try/catch) and to the URL with `history.replaceState`.
   All values are sanitised (`sanitize`) — unknown vocation dropped, points clamped to 0–`MAX_POINTS` (4000 = wheel
   capacity), priority to 0–100. Once the monster dataset is loaded, an unknown monster id is reset to `null`
   (`withKnownMonster`).
2. `App` derives `wheel = getWheel(vocation)` (memo) and clamps points to `wheel.totalCapacity`.
3. `useDeferredValue(inputs)` keeps the slider/typing responsive; `optimize()` runs in a
   `useMemo` keyed on the deferred vocation/points/monster/priority. `points = 0` → `result = null` → empty state.

## Theme tokens (`src/index.css`, Tailwind v4 `@theme`)

- `ink-950…500` warm near-black backgrounds; `parchment-50…400` text; `gold-300…700` accent.
- Semantic: `weak` (green), `resist` (red), `immune` (grey), `offense`, `defense`, `utility`.
- `font-display` = Cinzel (Google Fonts) for headings.
- Component classes: `.panel`, `.section-title`, `.field`, `.priority-range`.
- Domain colours (`DOMAIN_COLORS` in `labels.ts`): topLeft green, topRight red,
  bottomLeft purple, bottomRight blue — each with `base` (filled), `dim` (empty), `text`.

## Accessibility

- Vocation: `role="radiogroup"` / `role="radio"` + `aria-checked`, roving tabindex, arrows/Home/End.
- Monster search: ARIA 1.2 combobox (`aria-expanded`, `aria-controls`, `aria-activedescendant`,
  `role="listbox"`/`option`); ↑/↓ move, Enter selects, Esc closes (second Esc clears text);
  "Clear" button resets to "No monster (generic build)". Selected card is in an `aria-live` region.
- Slider has `aria-valuetext` ("Balanced (50 of 100)"); the "Balanced" label resets to 50.
- Score bars use `role="meter"`; revelation pips have an `aria-label` ("Stage 2 of 3").
- Wheel slices are focusable (`tabIndex=0`, `role="img"`, descriptive `aria-label`); hover and
  focus show the same tooltip. Gold `:focus-visible` outline globally; reduced-motion respected.

## Wheel geometry

Angles are degrees clockwise from 12 o'clock, matching `Slice.indexInRing`:

- Slice angles: `[i·360/n, (i+1)·360/n]` with `n = slicesInRing`. Domains therefore land at
  topRight 0–90° (12→3 o'clock), bottomRight 90–180°, bottomLeft 180–270°, topLeft 270–360°.
- Point at angle `a`, radius `r`: `(cx + r·sin a, cy − r·cos a)` (SVG y points down).
- Rings are laid out evenly between hub radius 34 and outer radius 192 (viewBox 400):
  `inner = hub + (ring−1)·w`, `outer = hub + ring·w`, `w = (outer−hub)/ringCount`.
- Partial fill is **area-proportional**: `r_fill = √(inner² + f·(outer² − inner²))`, `f = points/capacity`.
- Each sector is `M outerStart A outer … L innerEnd A inner … Z`, large-arc flag when span > 180°;
  a full 360° span is clamped to 359.9° (an SVG arc can't start and end on the same point).
- Fill-order badges sit at the sector centroid (mid angle, mid radius) and show the 1-based
  index of the slice in `result.path`.

## Monster data loading

The monster dataset (~950 kB JSON) is code-split. `main.tsx` calls `loadMonsterData()` before the first
render so the `data` chunk downloads in parallel; `useMonsterData()` (a `useSyncExternalStore` hook) flips
to `true` when it resolves. Until then `searchMonsters` returns `[]` (the listbox says "Loading monster
data…") and `getMonsterById` returns `undefined`, so the first build is generic and is recomputed once
the selected monster resolves. The engine is bundled eagerly (it is small).

## Work log

- 2026-11-18 — Theme tokens, fonts, favicon; `lib/` helpers (geometry, input state, labels) with tests;
  persistence hooks; fixture fallback facade.
- 2026-11-18 — All components (`VocationPicker`, `PointsInput`, `MonsterSearch`, `MonsterCard`,
  `PrioritySlider`, `WheelChart`, `ResultsPanel`) and `App` layout; fixed `-0` / full-circle arc
  rounding in `geometry.ts`. `tsc -b`, `vitest run src/lib` (16 tests) and `npm run build` pass.
- 2026-11-18 — (S4) Fixture fallback removed; monster data lazy-loaded; scroll points field; `MAX_POINTS` = 4000.
