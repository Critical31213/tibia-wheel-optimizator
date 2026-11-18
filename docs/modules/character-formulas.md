# Character formulas (`src/data/character/`)

Base character stats used by the damage model and by the engine's survivability valuation.
Everything is static TypeScript; no network access.

## API

| Function | Returns |
|---|---|
| `maxHitPoints(voc, level)`, `maxMana(voc, level)`, `capacity(voc, level)` | Naked base values (no equipment, wheel or other bonuses). |
| `defaultCharacterStats(voc, level)` | Typical `{ level, mainSkill, magicLevel, shielding }` (interpolated). |
| `resolveCharacterStats(voc, stats)` | User `CharacterStats` with missing fields filled from the defaults. |
| `mitigationPercent(voc, level, { shielding?, defense?, wielding?, wheelMultiplierPct? })` | Mitigation in % (1.0 = 1 %). |
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
| Sorcerer / Druid | – | 85 → 133 | 25 → 36 |
| Monk (fist) | 95 → 128 | 30 → 50 | 60 → 82 |

For comparison, tibiapal pre-fills these end-game values, which **include** the stance bonus: knight 160,
paladin 180, monk 140, paladin magic level 35, caster magic level 120, shielding knight/paladin 110,
monk 70, mages 30.

## Mitigation

CipSoft does not publish the formula. The community-documented composition (TibiaQA #36739) is:

```
mitigation % = (shielding × 0.0106 + handDefense × 0.02) × equipment × (1 + wheelMultiplier%/100)
```

- **Shielding:** 0.0106 %/point (TibiaQA worked example: 117 shielding → 1.24 %).
- **Hand defense:** the highest defense of the shield, spellbook or weapon. The 0.02 %/point value is fitted to
  the same example, where a two-handed weapon gave 0.64 %.
- **Equipment multiplier:** knight with a two-handed weapon 0.8 (TibiaQA). Paladin with a crossbow 1.1 is an
  assumption: the source only says it is a buff. Everything else is 1.0.
- **Combat stances** (offensive 0.8, defensive 1.2) were removed in 15.25 (June 2026), so they are not modelled.
- **Wheel "Mitigation Multiplier"** (dedication 0.075 %/promotion point, plus gem mods) multiplies the result.

Default hand setups: knight shield with 50 defense; paladin bow with 0 defense; mages spellbook with 20 defense;
monk weapon with 15 defense.

Calibration with the default skills:

| Level | Knight (shield) | Paladin (bow) | Monk | Mage |
|---|---|---|---|---|
| 200 | ≈ 1.9 % | ≈ 0.8 % | ≈ 0.9 % | ≈ 0.7 % |
| 800 | ≈ 2.2 % | ≈ 1.0 % | ≈ 1.1 % | ≈ 0.7 % |
| 1500 | ≈ 2.3 % | ≈ 1.1 % | ≈ 1.2 % | ≈ 0.8 % |

The user's Royal Paladin reports ≈ 1 % at mid levels, which matches.

### Mitigation vs. Hit Points

As effective HP (`HP / (1 − m)`), a Mitigation Multiplier point is worth `m × 0.00075`, while an HP point is worth
`hpPerPoint / maxHP`. The two are equal when:

```
m* = hpPerPoint / (maxHP × 0.00075)
```

| Case | m* | Realistic m |
|---|---|---|
| EK level 1200 (3 HP/point) | ≈ 22 % | ≈ 2.2 % |
| RP level 1500 (2 HP/point) | ≈ 18 % | ≈ 1.1 % |

So **as pure effective HP, HP dedication always wins** at levels 200–1500. Mitigation earns its value as *sustained*
damage reduction: it cuts the damage taken (and the healing and mana needed) on every hit, while extra HP only
raises the buffer against spikes.

The guidance for the engine (D12) is that the crossover must come out of the valuation, not from a hard rule.
- Weigh mitigation as sustain: about `m × damage taken per turn`.
- Weigh HP as spike safety, with a value that falls as `maxHP` grows relative to the threats.

With that split, mitigation can overtake HP once the HP pool is large (≈ 1200+ EK, ≈ 1500+ RP).

## Sources

- tibiapal.com damage calculator source (`CHARM_STAT_*`, `DEFAULT_*` constants).
- TibiaQA #36739 (mitigation composition and example).
- tibia.gg article "Mitigation, Armor and Defense" (stances removed in 15.25; formula not published).
