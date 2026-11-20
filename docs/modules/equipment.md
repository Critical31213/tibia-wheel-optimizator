# Equipment (D74)

The user's equipment (paper doll: helmet, amulet, armor, legs, boots, ring, off-hand, plus the tier and imbuements of
the weapon the engine picks) and what it changes in the engine.

## Data

| Path | Contents |
|---|---|
| `scripts/import-equipment.mjs` | `npm run import:equipment`: item pages of tibiopedia.pl per slot (helmets, armors, legs, boots, shields, spellbooks, quivers, amulets, rings), cached in `scripts/.cache/equipment/` (gitignored), low request rate. Parses vocation, required level, armor, defense, class, imbuement slots and bonuses (skills, element magic levels, resistances, critical chance, leech). Speed, reflection and other unmodelled bonuses are skipped. Same-name variants get their first skill in the name. A shield only mages can use is a spellbook. |
| `src/data/equipment/equipment.json` | Generated items (`{ meta, items }`). |
| `src/data/equipment/index.ts` | `ITEMS`, `getItem`, `itemsFor(slots, vocation)`, paper-doll slots (`GEAR_SLOTS`, `SLOT_ITEMS`), imbuements (`IMBUEMENTS`, `imbuementsFor(slot, vocation)`), forge tiers (`TIER_EFFECT`, `TIER_CHANCE`, `maxTier(class)`, `tierChance`). |

Imbuements (Basic / Intricate / Powerful): Strike 5/5/10 % chance and +5/15/50 % extra (Powerful = the engine's
crit default; lower tiers approximate), Vampirism 5/10/25 %, Void 3/5/8 %, skill imbuements +1/+2/+4, protections
3/8/15 %, elemental damage 10/25/50 % of the physical damage converted. Skill imbuements are offered only for the
vocation's skills; mages get no damage imbuements.

Forge tiers (chance %): Onslaught (weapon, +60 % damage), Ruse (armor), Momentum (helmet), Transcendence (legs),
Amplification (boots, multiplies the others). Values for tiers 1–6 follow community-published forge tables; 7–10 are
extrapolated. Highest tier: class 4 → 10, classes 1–3 → their number, no class → 0.

## Storage and effects (`src/lib/gear.ts`)

- `GearPrefs { pieces, weapon }` per vocation in localStorage (`wheel-optimizer:gear:v1:<vocation>`), sanitised on
  load (unknown or unusable items, out-of-range tiers, duplicate or foreign imbuements dropped).
- `gearEffects(gear, vocation, meleeSkill, fallback)` → `GearEffects` (`OptimizerInput.equipment`), or `undefined` when
  nothing is set: the engine then keeps its previous assumptions (typical weapon and shield, Powerful Strike,
  Vampirism on weapon and armor).
- Once something is set, empty slots follow the fallback mode (temporary review switch, see below):
  `slot` keeps the assumption per empty slot; `all` drops every assumption (no imbuements, no off-hand).
- Skills entered in Character are base values; item and imbuement skills are added to the entered fields only
  (empty fields stay estimated from level). Knights count the trained melee skill (else the best melee bonus).

## Engine

| Effect | Where |
|---|---|
| Main skill, magic level, shielding | `modelInputs` (added to entered skills) |
| Element magic levels | `buildSpellModel` (merged into `elementMl`) |
| Strike (crit) | shift vs the default crit on spells and auto attacks (`gearModel`); weapon loadouts use the chosen Strike instead of the default |
| Elemental damage imbuement | physical part of weapon spells and auto attacks converted (`convertedPhysical`) |
| Onslaught | damage × (1 + chance × 0.6) |
| Life / mana leech | `leechEhp` and weapon perk valuation (`loadoutParts`) use the chosen values; `leechPoint` values +1 pp when the leech is 0 |
| Resistances | `resistParts` divides by the damage still taken after the equipment resistances |
| Off-hand | worn shield defense (or no off-hand) in mitigation |

Not modelled: armor value, Ruse (shown only), Momentum, Transcendence, speed, Mantra, Perfect Shot.

## UI (`EquipmentPanel.tsx`)

Paper doll (Tibia layout; backpack and ammunition are not modelled), all slots empty by default. A slot opens its
editor: item search for the slot, tier (with the effect), imbuements per the item's slots, change / remove. The
weapon slot shows the engine's pick and sets its tier and up to 3 imbuements ("back to default" clears them).
Below: the bonus totals and the owned weapons list (`OwnedWeapons.tsx`).

Temporary (D74 review): a variant switch (`useDesignVariants`, localStorage) for the fallback mode and the editor
(modal window or inline below the doll). The chosen variant stays, the switch goes.
