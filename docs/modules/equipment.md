# Equipment (D74)

The user's equipment (paper doll: helmet, amulet, armor, legs, boots, ring, off-hand — several owned items per slot —
plus the tier and imbuements of the weapon the engine picks), how the engine wears the best set (D75) and what it
changes in the engine.

## Data

| Path | Contents |
|---|---|
| `scripts/import-equipment.mjs` | `npm run import:equipment`: item pages of tibiopedia.pl per slot (helmets, armors, legs, boots, shields, spellbooks, quivers, amulets, rings), cached in `scripts/.cache/equipment/` (gitignored), low request rate. Parses vocation, required level, armor, defense, class, imbuement slots and bonuses (skills, element magic levels, resistances, critical chance, leech). Speed, reflection and other unmodelled bonuses are skipped. Same-name variants get their first skill in the name. A shield only mages can use is a spellbook. |
| `src/data/equipment/equipment.json` | Generated items (`{ meta, items }`). |
| `src/data/equipment/index.ts` | `ITEMS`, `getItem`, `itemsFor(slots, vocation)`, paper-doll slots (`GEAR_SLOTS`, `SLOT_ITEMS`), imbuements (`IMBUEMENTS`, `imbuementsFor(slot, vocation, item?)`: no imbuement of a skill, element protection, critical hit, life or mana leech the item already has; Epiphany only on mage-exclusive helmets; `weaponImbuements` for weapons: skill imbuements only of the weapon's own skill, also with a native bonus, elemental damage only on melee weapons, bows and crossbows, no Strike on wands / rods below level 150), forge tiers (`TIER_EFFECT`, `TIER_CHANCE`, `maxTier(class)`, `tierChance`). |

Imbuements (Basic / Intricate / Powerful): Strike 5/5/10 % chance and +5/15/50 % extra (Powerful = the engine's
crit default; lower tiers approximate), Vampirism 5/10/25 %, Void 3/5/8 %, skill imbuements +1/+2/+4, protections
3/8/15 %, elemental damage 10/25/50 % of the physical damage converted. Skill imbuements are offered only for the
vocation's skills; mages get no damage imbuements.

Forge tiers (chance %): Onslaught (weapon, +60 % damage), Ruse (armor), Momentum (helmet), Transcendence (legs),
Amplification (boots, multiplies the others). Values for tiers 1–6 follow community-published forge tables; 7–10 are
extrapolated. Highest tier: class 4 → 10, classes 1–3 → their number, no class → 0.

## Storage (`src/lib/gear.ts`)

- `GearPrefs { pieces: slot → GearPiece[], weapon }` per vocation in localStorage (`wheel-optimizer:gear:v1:<vocation>`,
  the older one-item-per-slot format is read too), sanitised on load (unknown or unusable items, out-of-range tiers,
  duplicate or foreign imbuements dropped; at most 20 items per slot). Editing: `addPiece`, `updatePiece`, `removePiece`.
- `gearInput(gear)` → `OptimizerInput.gear`, or `undefined` when nothing is set: the engine then keeps its
  previous assumptions (typical weapon and shield, Powerful Strike, Vampirism on weapon and armor).

## Wearing the best set (`wearBest` in `optimizer.ts`, D75)

Before the wheel search, `runOptimizer` picks one owned item per slot: start with the first item of each slot, then
per slot try every other item with the rest fixed and keep the best (`gearScorer`), up to 3 passes or until nothing
changes. Items above the character level are skipped. The score is the priority blend of damage (best plan vs the
plain character) and EHP: mitigation (shielding, off-hand), resistances against the spot's incoming damage, life leech
(`leechEhp`) and Ruse as dodge. It ignores the wheel. The worn set's `gearEffects` become `input.equipment`;
`result.gear` = `{ worn: slot → index, effects }`.

Two-handed weapons (D78): when a shield or spellbook is worn, `wearBest` also returns the effects without it
(`input.equipmentTwoHanded`). Valuations with a two-handed loadout (`armedWith`) use them; the EHP reference keeps the
off-hand, so the lost mitigation counts against two-handed weapons. When the chosen weapon is two-handed,
`result.gear.effects` is that set and `offhandOff` is set (the panel strikes the off-hand through). Quivers stay.

Weapon tier and imbuements per weapon (D81): an owned weapon may carry its own `gear` (`OwnedWeapon.gear`: tier up
to `maxTier(class)`, imbuements up to its `imbuementSlots`, as allowed by `weaponImbuements`). `wearBest` keeps the worn items
(`input.wornPieces`); `equipmentWith(input, loadout)` rebuilds the effects with that weapon's settings (cached per
weapon and hands) for valuations and the loadout ranking. Weapons without settings, the typical weapon and unowned
suggestions use `gear.weapon` ("default for weapons without their own settings"), else the assumption.
`result.gear.effects` follows the chosen weapon.

## Effects (`src/engine/gear.ts`)

- `gearEffects(worn, vocation, meleeSkill)` → `GearEffects`.
- Empty slots keep their assumption (D77): no weapon tier or imbuements set → Powerful Strike and half the default
  Vampirism; no armor → the other half; no off-hand → the vocation's typical one.
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
| Resistances | Protections of items and imbuements stack multiplicatively (D80): taken = Π (1 − r), `resist` holds the combined %. `resistParts` values a new protection on the element's remaining damage, divided by the damage still taken |
| Off-hand | worn shield defense (or no off-hand) in mitigation |

Not modelled: armor value, Momentum, Transcendence, speed, Mantra, Perfect Shot. Ruse counts only in the choice of items.

## UI (`EquipmentPanel.tsx`)

Paper doll (Tibia layout; backpack and ammunition are not modelled), all slots empty by default; a slot shows the worn
item and the number of owned items. A slot opens its editor in a modal window (`<dialog>`): owned items (worn one marked; tier with its effect,
imbuements per the item's slots, remove) and "add item" (search for the slot). The
weapon slot (wider window) shows the engine's pick, sets its tier and up to 3 imbuements ("back to default" clears
them) and holds the owned weapons with their proficiency (`OwnedWeapons.tsx`). Below the doll: the bonus totals.
