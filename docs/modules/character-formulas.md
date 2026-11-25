# Character formulas (`src/data/character/`)

Base character stats used by the damage model and by the engine's survivability valuation.
Everything is static TypeScript; no network access.

## API

| Function | Returns |
|---|---|
| `maxHitPoints(voc, level)`, `maxMana(voc, level)`, `capacity(voc, level)` | Naked base values (no equipment, wheel or other bonuses). |
| `defaultCharacterStats(voc, level)` | Typical `{ level, mainSkill, magicLevel, shielding }` (interpolated). |
| `resolveCharacterStats(voc, stats)` | User `CharacterStats` with missing fields filled from the defaults. |
| `mitigationPercent(voc, level, { shielding?, offhand?, offhandDefense?, wheelMultiplierPct? })` | Mitigation in % (1.0 = 1 %); `offhand`: shield, spellbook, quiver or none. |
| `mitigationBreakdown(...)` | `{ shielding, offhand, total }` as in the Cyclopedia. |
| `defaultOffhandDefense(offhand, level)`, `DEFAULT_OFFHAND` | Typical offhand defense and default offhand per vocation (D19). |
| `effectiveHp(hp, mitigationPct)` | `hp / (1 − m)` (D18). |
| `mitigationBreakEvenPercent(voc, level, hpPerPoint, totalHp?)` | Base mitigation at which a Mitigation Multiplier point equals an HP point in effective HP. |

## HP, mana, capacity

Every character has 185 HP, 90 mana and 470 oz at level 8. Below level 8 they gain 5 HP, 5 mana and 10 oz per level.
From level 8 on, each level adds:

| Vocation | HP | Mana | Cap |
|---|---|---|---|
| Knight | 15 | 5 | 25 |
| Paladin | 10 | 15 | 20 |
| Sorcerer / Druid | 5 | 30 | 10 |
| Monk | 10 | 10 | 25 (approximate) |

Same per-level values as the community calculator's `CHARM_STAT_GAIN_BY_VOCATION`.

## Default skills (approximate)

These are typical trained values per level, including common equipment and loyalty bonuses but **without**
stance bonuses (Blood Rage, Sharpshooter, Virtue of Justice). Values for 200 / 400 / 600 / 800 / 1000 / 1250 / 1500
are interpolated linearly; above 1500 the last slope is extended, below 200 the value tapers.

| Vocation | Main skill | Magic level | Shielding |
|---|---|---|---|
| Knight (melee) | 100 → 133 | 10 → 14 | 88 → 121 |
| Paladin (distance) | 105 → 140 | 22 → 39 | 72 → 102 |
| Sorcerer / Druid | – | 85 → 133 | 28 → 40 (D19 calibration) |
| Monk (fist) | 95 → 128 | 30 → 50 | 60 → 82 |

For comparison, community pre-fills these end-game values, which **include** the stance bonus: knight 160,
paladin 180, monk 140, paladin magic level 35, caster magic level 120, shielding knight/paladin 110,
monk 70, mages 30.

## Mitigation (D19)

There are no fight modes in the current game. The structure follows the in-game mitigation:

```
mitigation % = (shielding × vocFactor + offhandFactor × defense) / 100 × (1 + wheelMultiplier%/100)
```

Generic server constants (multiplier S/D 1.26, P/M 1.28, K 1.3; primaryShield 2.0–2.08;
secondaryShield 1.2–1.25, applied to spellbooks and as a ×1.2 *bonus* for quivers) do **not** reproduce the
in-game Cyclopedia values. These values (no wheel) are used for calibration and take priority (D108 replaced an
older paladin pair that suggested a quiver penalty; D110 replaced an older druid pair with unknown shielding and
spellbook). The Cyclopedia **truncates** to 0.01 (D111): only then do all readings fit one set of constants.

| Point | Cyclopedia | Model | Inputs |
|---|---|---|---|
| RP level 855, shielding 108, quiver | 1.18 % | 1.188 % | 108 × 1.1/100 |
| Same RP, shielding 110, Gnome Shield: shielding part | 1.21 % | 1.21 % | 110 × 1.1/100 |
| Same RP with the shield: shield part | 1.28 % | 1.28 % | defense 50 × 2.56/100 |
| ED level 96, shielding 36, no offhand | 0.38 % | 0.385 % | 36 × 1.07/100 |
| Same ED with a Spellbook of Mind Control: spellbook part | 0.61 % | 0.614 % | defense 26 × 2.36/100 |
| EK level 52, shielding 103: shielding part | 1.13 % | 1.133 % | 103 × 1.1/100 |
| Same EK, Dragon Shield only (no weapon): shield part | 1.04 % | 1.0496 % | defense 41 × 2.56/100 |
| Same EK, Fire Sword only (one-handed): weapon part | 0.50 % | 0.506 % | defense 20 × 2.53/100 |
| Monk, shielding 72: shielding part | 0.77 % | 0.770 % | 72 × 1.07/100 |
| Same monk, Soulkamas (two-handed): weapon part | 0.51 % | 0.5145 % | defense 21 × 2.45/100 |

How the constants were inferred:

- **Shielding factor.** With truncation, RP 108 → 1.18 %, RP 110 → 1.21 % and EK 103 → 1.13 % bound the knight
  and paladin factor to 1.100–1.102 %/100 points; 1.1 is used for both. The druid's 0.38 % at 36 bounds its factor
  to 1.056–1.083 and the monk's 0.77 % at 72 to 1.069–1.083 (D117); 1.07 is used for both (the sorcerer follows, not
  measured). An older EK
  reading (119 → 1.34 %) does not fit and probably included a wheel Mitigation Multiplier.
- **No quiver factor (D108).** A quiver does not change mitigation (checked in-game).
- **Offhand factor per 100 defense:** shields 2.56 (Gnome Shield, defense 50 → 1.28 %; Dragon Shield, defense 41 →
  1.04 %; together 2.560–2.561), spellbooks 2.36 (Spellbook of Mind Control, defense 26 → 0.61 %, bounds 2.346–2.385). Item defense values come from the TibiaWiki item data
  (`scripts/.cache/damage-api/meta/shields.json`).
- **Weapon defense (D112)** counts only without a shield or spellbook: one-handed 2.53 %/100 defense (EK readings:
  Fire Sword, defense 20, alone 0.50 %; Dragon Shield alone 1.04 %; both 1.09 %, so with a shield the weapon adds
  only ~0.05 % and is ignored). Two-handed weapons give less, as TibiaWiki states (D117): Soulkamas, defense 21 →
  0.51 %, bounds 2.429–2.476; 2.45 is used (`weaponTwoHanded`, default by vocation in `TWO_HANDED_WEAPON`: monk
  yes, knight no). Without a known weapon the typical defense of the level is used (`WEAPON_DEFENSE`: knight 30–36,
  monk 17–22; bows, wands and rods have none).
- **Utamo Tempo** (not modelled, temporary): the same EK with 133 shielding showed 1.48 % from shielding and
  1.06 % / 0.51 % / 1.12 % from shield / sword / both, i.e. the raised shielding times about 1.018 on every part.
- **Mage default shielding** is 34/35/36/38/38/39/40 (levels 200…1500): a level 96 ED already has 36, and an older
  level 781 ED reading (0.40 %) implies about 38.

**Uncertainty.** The spellbook factor rests on one item (Spellbook of Mind Control).
Whether the offhand part depends on the vocation or the shielding is not known; the model uses one factor per item
type. The sorcerer is not measured; the two-handed weapon factor rests on one item (Soulkamas).

**Defaults (`DEFAULT_OFFHAND`)**
- Paladin: quiver, both for the hunt bow and the boss crossbow.
- Sorcerer and druid: spellbook.
- Knight and monk: none.
- A knight uses a shield only in the shield rotation. The caller then passes `offhand: 'shield'`.

**Typical offhand defense (`OFFHAND_DEFENSE`, nearest lower bracket)**

| Level | 200 | 400 | 600 | 800 | 1000 | 1250 | 1500 |
|---|---|---|---|---|---|---|---|
| Shield | 46 | 50 | 51 | 52 | 54 | 55 | 55 |
| Spellbook | 32 | 34 | 34 | 36 | 36 | 36 | 36 |

Shields: Demon Shield, Great/Gnome Shield, Eldritch Shield, Falcon Escutcheon, Refined Stag Shield, Soulbastion.
Spellbooks: Spellbook of Lost Souls, Stag Spellbook/Eldritch Folio, Arboreal Tome/Arcanomancer Folio.

The build's stats show this split (`stat.mitigationTotal`, D113): shielding and defense part, total, with the
wheel's and gems' Mitigation Multiplier applied and truncated like the Cyclopedia.

**Results with the defaults**

| Level | EK (weapon) | EK (shield) | RP (quiver) | Mage (spellbook) | Monk |
|---|---|---|---|---|---|
| 200 | 1.73 % | 2.15 % | 0.79 % | 1.12 % | 1.06 % |
| 800 | 2.03 % | 2.53 % | 0.99 % | 1.26 % | 1.27 % |
| 1500 | 2.24 % | 2.74 % | 1.12 % | 1.28 % | 1.42 % |

`effectiveHp(hp, m) = hp / (1 − m/100)` (D18).

### Mitigation vs. Hit Points

As effective HP (`HP / (1 − m)`), a Mitigation Multiplier point is worth `m × 0.00075`, while an HP point is worth
`hpPerPoint / maxHP`. The two are equal when:

```
m* = hpPerPoint / (maxHP × 0.00075)
```

| Case | m* | Realistic m |
|---|---|---|
| EK level 1200 (3 HP/point) | ≈ 22 % | ≈ 1.3 % (≈ 2.7 % with shield) |
| RP level 1500 (2 HP/point) | ≈ 18 % | ≈ 1.0 % |

So **as pure effective HP, HP dedication always wins** at levels 200–1500. Mitigation earns its value as *sustained*
damage reduction: it cuts the damage taken (and the healing and mana needed) on every hit, while extra HP only
raises the buffer against spikes.

The guidance for the engine (D12) is that the crossover must come out of the valuation, not from a hard rule.
- Weigh mitigation as sustain: about `m × damage taken per turn`.
- Weigh HP as spike safety, with a value that falls as `maxHP` grows relative to the threats.

With that split, mitigation can overtake HP once the HP pool is large (≈ 1200+ EK, ≈ 1500+ RP).

## Sources

- Public damage calculator (`CHARM_STAT_*`, `DEFAULT_*` constants).
- In-game mitigation structure.
- User in-game Cyclopedia values (calibration, D19).
- TibiaWiki item data (shield/spellbook defense, TibiaWiki-sourced).
- player measurements (older composition; superseded).
- tibia.gg article "Mitigation, Armor and Defense" (stances removed in 15.25; formula not published).
