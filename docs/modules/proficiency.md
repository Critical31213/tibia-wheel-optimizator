# Weapon proficiency data (D45)

Stage 1 of the weapon proficiency feature: static data only. The model (perk values), the joint optimization
with the wheel and the UI follow in later stages.

## Import

`npm run import:proficiency [-- --refresh]` (`scripts/import-proficiency.mjs`) downloads three files into the
gitignored `scripts/.cache/proficiency/` and writes `src/data/proficiency/proficiency.json`:

| Source | Used for |
| --- | --- |
| TibiaPal `weapon-proficiencies.json` (MIT) | proficiency tree of each weapon (levels × 1–3 perks) |
| TibiaPal `perk-shaping-options.json` (MIT, compiled from TibiaWiki BR) | dust shaping options, rank 0 and rank 10 values |
| tibiopedia.pl `/items/weapons` | attack + element, defence, class, imbuement slots, specials, level, vocation |

Weapons are joined by name (case and apostrophes ignored). Only weapons present in both sources are written
(432). The ~235 weapons on tibiopedia without a TibiaPal tree (older and common weapons, Carving/Mayhem/Remedy
variants, replicas) are listed in `meta.withoutTree`; the game gives every weapon a tree, but those trees are not
in the data.

## Perks

Perks are read from TibiaPal's structured fields, which come from the game client:

- `Type` → `kind` (see `PerkKind` in `src/data/proficiency/types.ts`).
- `SkillId` (1 magic, 6 shielding, 7 distance, 8 sword, 9 club, 10 axe, 11 fist, 13 fishing).
- `ElementId` / `DamageType` (1 physical, 8 fire, 16 earth, 32 energy, 64 ice, 128 holy, 256 death,
  1048576 healing; TibiaPal's own `element` field swaps fire and energy, the descriptions do not).
- `SpellId` → spell name from the id table of TibiaPal's calculator (e.g. 87 is Death Strike, although one
  description says "Force Strike").
- `AugmentType` (2 base damage, 3 healing, 6 cooldown in seconds, 14 life leech, 15 mana leech,
  16 critical extra damage, 17 critical chance).
- `BestiaryId` 1..21 → bestiary class.

The English `sourceDescription` was scraped from wikis before some lines were rebalanced (Moonsilver,
Umbral Master, Sanguine healing scaling, …) and a few belong to other weapons (Amber Staff). Values always come
from the client field; the 139 disagreements are listed in `meta.issues`. Healing skill scaling is consistently
twice the described value; the client value is kept.

Skipped: two `Type -1` perks on Amber Staff ("+50 % life leech for Annihilation", a knight spell on a monk
weapon) and duplicate Ferumbras' Staff trees (the first is kept).

## Weapons

`Weapon` fields: `type` (axe, club, sword, fist, bow, crossbow, throw, wand, rod), `vocations` (by type; casters
listed both as wand and rod get sorcerer and druid), `minLevel`, `attack` / `elementAttack` (melee, throwing),
`damage` (average wand/rod hit; missing on tibiopedia for 7 casters, 4 filled from TibiaWiki, 3 unknown),
`element`, `defence`, `range`, `class`, `imbuementSlots`, `specials` (skills, magic levels, bow attack, crit,
leech, hit chance, perfect shot; resistances, armor and reflection are not kept) and `levels`.

## Shaping options

184 options: 34 for all vocations (bestiary, alpha/omega strike, armor penetration, auto-attack and rune crits,
highest-skill scaling, on-hit/on-kill) and 30 spell augments per vocation. `shapingValue(option, rank)`
interpolates linearly between rank 0 and 10 (the in-between ranks are an estimate, as in TibiaPal). In the game a
weapon can have at most two reshaped slots.

## Monsters

`Monster.bestiaryClass` (21 classes) is parsed from the tibiopedia "Klasa" link, see `docs/modules/data.md`.
