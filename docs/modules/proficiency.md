# Weapon proficiency data (D45)

Weapon proficiency: static data (D45), the perk model and the joint choice with the wheel (D46, see
"Engine" below) and the UI (D47, see `docs/modules/ui.md`: `WeaponsPanel`, `WeaponResultPanel`).

## Import

`npm run import:proficiency [-- --refresh]` (`scripts/import-proficiency.mjs`) downloads three files into the
gitignored `scripts/.cache/proficiency/` and writes `src/data/proficiency/proficiency.json`:

| Source | Used for |
| --- | --- |
| TibiaPal `weapon-proficiencies.json` (MIT) | proficiency tree of each weapon (levels × 1–3 perks) |
| TibiaPal `perk-shaping-options.json` (MIT, compiled from TibiaWiki BR) | dust shaping options, rank 0 and rank 10 values |
| tibiopedia.pl `/items/weapons` | attack + element, defence, class, imbuement slots, specials, level, vocation |
| TibiaPal `images/proficiency/…` (CipSoft graphics, D50) | perk icons |

Weapons are joined by name (case and apostrophes ignored). Only weapons present in both sources are written
(432). The ~235 weapons on tibiopedia without a TibiaPal tree (older and common weapons, Carving/Mayhem/Remedy
variants, replicas) are listed in `meta.withoutTree`; the game gives every weapon a tree, but those trees are not
in the data.

Perk icons (D50): each perk has an icon key — `kind[:skill][:element][:bestiary]`, or for spell augments
`spell:<name>` plus the overlay `aug:<augment>` (`iconKeys`, mirrored in the script). The script takes the most
common TibiaPal sprite per key (its wiki crops are slightly noisy), shaping-only options fall back to the shaping
page icon, downloads them (cached in `scripts/.cache/proficiency/img/`), names them by content hash (extension from
the content: some `.gif` mirrors are WebP) into `public/proficiency/` and writes `icons` (key → file, `#frame/frames`
for sprite strips). `perkIcon(perk)` resolves them; a test checks every perk and shaping option has a shipped file.

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

## Engine (D46)

`src/engine/proficiency.ts` turns a weapon and one chosen perk per unlocked level (a loadout) into model inputs:

| Perk | Effect |
| --- | --- |
| skill | main skill when it matches the weapon (knight: its type; paladin: distance; monk: fist), magic level, shielding (mitigation) |
| attack, weapon attack | spell formulas and auto-attack (bow / crossbow + the picked ammunition, see below; melee incl. element attack) |
| magicLevel | element magic level of spells; healing magic level → healing |
| augment | base damage (boosted part), crit chance / extra damage, cooldown (s), life / mana leech × the spell's damage share, healing × heal share |
| crit, element crit, auto crit | spell / auto-attack crit (pp) |
| pierce | the element's creature sensitivity via `pierceDamageMod`, on top of stance pierce |
| bestiary | hunting only (assumed not to work on bosses): spot-weighted damage multiplier of the class |
| boss | boss mode only |
| alpha / omega strike | × (1 + share × value); shares hunt 0.1 / boss 0.005 and 0.15 (assumptions, halved in D54) |
| spell / auto / heal skill scaling | flat damage or healing = value × skill (no skill = the highest one; fishing = 0) |
| rangeDamage, perfect shot | auto-attack flat × 0.25 (share of shots from range; D54) |
| homing missile | chance × level multiplier × level per offensive cast (1 per turn) |
| life / mana leech | sustain (D29/D31 leech point), mana leech as for convictions |

Rending Inferniarch weapons cannot take the critical hit (Strike) imbuement: their loadout removes the default
Powerful Strike crit (10 % chance, +50 % extra damage) from spells and auto-attack (D48). Siphoning
Inferniarch weapons cannot take the life leech imbuement (−half of `K.LIFE_LEECH_IMBUE`, the weapon's item) and
Draining ones not the mana leech one (−8 pp, Powerful Void) (D49).

Ammunition (D51, `src/data/proficiency/ammo.ts`, tibiopedia arrow / bolt tables): bows choose between Diamond Arrow
(37, physical, 5x5 area) and the four storm arrows (21, all damage fire / ice / earth / energy, 13-square diamond area
(D52)); while hunting a shot hits `Ammo.targets` creatures on average (D59: diamond 6, storm 5.3; spectral bolt 1). Shatterstorm and Crystalline Arrows are left out;
crossbows use Spectral Bolt (78); only ammunition usable at the character
level. `rankWeapons` picks the ammunition with the best loadout score before and after the perk choice, so elemental
arrows win only where they pay off (e.g. physical-immune monsters) and bosses end up with crossbow + Spectral Bolt.
`WeaponPick.ammo` reports it. Knights: with `meleeSkill` set, weapons of the other melee types are skipped (owned and
suggested). `RotationUsage.autoAttack` is the auto-attack share of the build's damage (it was already in the model).

Not valued: defence, armor penetration, hit chance, on-hit / on-kill, rune crit, mage auto-attack (skipped). Skills
are entered without weapon bonuses; the main skill is assumed for every weapon type of the vocation.

**Choice.** `planSpecs` ranks the owned weapons per plan with a cheap score (rotation vs the reference, shielding
mitigation, sustain) and automatic perks (`choosePerks`: coordinate descent, 2 passes, manual choices kept); the
best two get their own stance pick (`pickStances` with the loadout). After the search, perks and weapon are
re-chosen with the build's rotation (stages, augments); a different choice is re-searched and kept when better.
Two-handed weapons do not fit a plan requiring a shield.

**Result** (`OptimizerResult.weapon`): `best` and `ranking` (objective difference vs the chosen weapon),
`reshapes` (shaping option at rank 10 taken at a level without a reshape, best level per option, top 3; none
below proficiency level 3 or with two reshaped slots) and, with `suggestWeapons`, up to three unowned weapons for
the level that beat the chosen one (all levels unlocked; Ice Rapier excluded, it breaks on use).

## Monsters

`Monster.bestiaryClass` (21 classes) is parsed from the tibiopedia "Klasa" link, see `docs/modules/data.md`.

## Better perks (D56)

When the chosen weapon has manual perks, `weaponResult` also ranks it with every perk free (same scorer, ammunition
re-chosen) and returns `WeaponResult.better` if that beats the manual loadout by more than `MIN_WEAPON_GAIN`.

D62: weapon damage types. Auto attacks and weapon spells (`weaponElement` in the spell data: knight exori…, monk spells)
deal the weapon's main element (`element`: monk elemental bond, amber weapons; physical otherwise) plus its elemental
part (`elementAttack`), split by attack shares, each with its pierce perks; ammunition still turns the whole shot into its
element. Monk bonds in the data match TibiaWiki's `elementalbond`; the whole hit takes the bond element (confirmed in-game).
