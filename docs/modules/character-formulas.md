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

Same per-level values as tibiapal's `CHARM_STAT_GAIN_BY_VOCATION`.

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

For comparison, tibiapal pre-fills these end-game values, which **include** the stance bonus: knight 160,
paladin 180, monk 140, paladin magic level 35, caster magic level 120, shielding knight/paladin 110,
monk 70, mages 30.

## Mitigation (D19)

There are no fight modes in the current game. The structure follows Canary
`PlayerWheel::calculateMitigation`:

```
mitigation % = (shielding × vocFactor + offhandFactor × defense) / 100 × distanceFactor × (1 + wheelMultiplier%/100)
```

Canary's own constants (vocations.xml: multiplier S/D 1.26, P/M 1.28, K 1.3; primaryShield 2.0–2.08;
secondaryShield 1.2–1.25, applied to spellbooks and as a ×1.2 *bonus* for quivers) do **not** reproduce the
in-game Cyclopedia values. These user-reported values are used for calibration and take priority over Canary:

| Point | Cyclopedia | Model | Inputs |
|---|---|---|---|
| RP shielding 108, quiver: shielding part | 1.07 % | 1.07 % | 108 × 1.13/100 × 0.877 |
| Same RP with a shield: shield part | 1.28 % | 1.28 % | defense 50 × 2.56/100 |
| Same RP with a shield: total | 2.50 % | 2.50 % | 1.22 + 1.28 |
| ED level 781: shielding part | 0.40 % | 0.40 % | default shielding 36 × 1.112/100 |
| ED level 781: spellbook part | 0.87 % | 0.87 % | default defense 34 × 2.56/100 |

How the constants were inferred:

- **Shielding factor.** The RP shield total (2.50 − 1.28) gives a shielding part of 1.22 % for 108 shielding, or
  1.13 %/100 points. That is the Canary paladin multiplier 1.28 × 0.883. The other vocations use their Canary
  multiplier scaled by the same 0.883: K 1.148, P/M 1.13, S/D 1.112.
- **Quiver factor 0.877.** With a quiver the same RP shows 1.07 % instead of 1.22 %. So the quiver
  (distance) factor *lowers* mitigation, the opposite of Canary's 1.2.
- **Offhand factor 2.56 %/100 defense**, the same for shields and spellbooks. Item defense values come from the
  TibiaWiki-sourced TibiaTools item meta (`scripts/.cache/tibiatools/meta/shields.json`). tibiopedia.pl only
  serves a JS "setup" page to scripts, so it could not be scraped. A typical ~50-defense shield (Great/Gnome
  Shield) gives 1.28 %. A typical ~34-defense spellbook at level 781 (Stag Spellbook, Eldritch Folio) gives 0.87 %:
  0.87/34 = 0.0256 = 1.28/50. Canary's per-item factors would need defenses of 62–72, which no item has.
- **Mage default shielding** was raised to 28/31/33/36/37/39/40 (levels 200…1500). The ED's 0.40 % implies about
  36 shielding at level 781.

**Uncertainty.** We do not know the RP's shield, the RP's level, or the ED's shielding. The fit assumes a
defense-50 shield and the default ED stats. With a different shield (46–55), the offhand factor would fall
between 2.33 and 2.78. The quiver factor rests on a single pair of observations. Any bow or crossbow paladin
without a quiver is treated like `'none'` (factor 1), which is untested. Monk weapon defense is ignored.

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

**Results with the defaults**

| Level | EK (none) | EK (shield) | RP (quiver) | Mage (spellbook) | Monk |
|---|---|---|---|---|---|
| 200 | 1.01 % | 2.19 % | 0.71 % | 1.13 % | 0.68 % |
| 800 | 1.25 % | 2.58 % | 0.89 % | 1.32 % | 0.82 % |
| 1500 | 1.39 % | 2.80 % | 1.01 % | 1.37 % | 0.93 % |

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

- tibiapal.com damage calculator source (`CHARM_STAT_*`, `DEFAULT_*` constants).
- Canary `PlayerWheel::calculateMitigation` + vocations.xml (structure only).
- User in-game Cyclopedia values (calibration, D19).
- TibiaTools item meta (shield/spellbook defense, TibiaWiki-sourced).
- TibiaQA #36739 (older composition; superseded).
- tibia.gg article "Mitigation, Armor and Defense" (stances removed in 15.25; formula not published).
