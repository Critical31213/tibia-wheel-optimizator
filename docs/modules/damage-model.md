# Damage model (`src/data/damage/`)

Per-spell damage formulas fitted offline on a public damage-calculator API. The app makes no network calls; everything lives in `spell-formulas.json`.

## Loader API (`src/data/damage/index.ts`)

| Function | Returns |
|---|---|
| `spellAverageHit(name, character, { vocation?, attack?, shieldDefense?, stage?, part?, baseDamagePct?, flatBonus?, skillBonus?, magicLevelBonus?, paladinWeapon? })` | Average **raw** damage of one hit on one target, before crit, resistances and mitigation. `part: 'extra'` = revelation extra hit (beam sides, Spiritual Outburst repeat, …). |
| `spellVariant(spell, stage, part)` | The fitted variant used for that stage/part. |
| `levelTerm(level)` | Shared level term g(L). |
| `spellCooldownTurns(name, reductionSeconds?)` | Cooldown in 2 s turns (min 1). |
| `spellElement`, `spellArea` (`single`/`area`/`beam`/`chain`), `isSingleTarget` | Metadata. `singleTarget` = D16 flag (never valued in hunt mode). |
| `defaultTargets(name, outer?)` | community "spell average hits" (real hunting data); 1 for single-target spells. |
| `rotationPresets(voc)`, `recommendedRotation(voc)` | community rotation presets, ratios normalized to weights. |
| `critMultiplier(chance%, extra%)` | `1 + chance·extra` (default 10/50 → 1.05). |
| `healingAverage(name, character, …)` | Healing spells (approximate formulas). |
| `weaponBracket(voc, level, paladinWeapon?)` | Representative weapon/attack per level bracket (default `attack`); paladin bow or crossbow (D21). |
| `revelationSpell(name)`, `REVELATION_SPELLS` | Unlocking revelation or null (D20). |
| `pierceDamageMod(mod, pct)`, `BALLISTIC_MASTERY`, `POSITIONAL_TACTICS` | D21 effects (see below). |

Missing character fields are filled by `resolveCharacterStats` (`src/data/character`).

## Model

**Level term** (discovered from a level sweep, exact to ±1 damage):
`g(L) = L/5` up to 500, then +1 per 6 levels up to 1100, per 7 up to 1800, per 8 up to 2600, per 9 above.

| Model | Formula (avg; min/max fitted the same way) |
|---|---|
| magic | `const + a·g(L) + M·mlvl` |
| weapon | `const + a·g(L) + S·skill + A·attack + SA·skill·attack` (+ `LSA·g·skill·attack/1000` for 4 monk spells) |
| distance | `const + a·g(L) + S·skill` (paladin Ethereal spells: no attack terms) |
| shield | `const + a·g(L) + H·shielding + D·shieldDef + HD·shielding·shieldDef` |

`attack` = weapon + ammo. Knight/monk weapon spells are essentially pure `skill·attack`; paladin Ethereal spells are
linear in distance skill only (the fitted attack coefficients were ≈ 0 across three bow/crossbow + ammo setups, so
they are dropped). `a` is the variant's level multiplier (`bonusFactor`): 1 for normal hits,
0.25/0.4/0.7 for Great Death Beam sides, 1.5 Death Echo, 2/2.25/2.5 Executioner's Throw stages, 1.2/1.4/1.6 bursts.

**Fit quality:** 144 variants. All within ≤ 1.7 damage absolute (< 0.7 %), except Sweeping Takedown, Spiritual
Outburst, Devastating Knockout and Greater Tiger Clash (≤ 1.44 %, ≤ 12 damage), which use the extra level×skill×attack term.
The committed fixture `__fixtures__/api-samples.json` (10 API responses) is re-checked by the tests.

## Probe rules (`rules` in the JSON)

- **Flat wheel bonus** (revelation stages, vessels): `raw += bonus × bonusFactor` per hit and target, before crit.
- **Augment "+X % base damage":** boosts everything except the level term:
  `levelPart + (raw − levelPart)·(1 + X/100)`, `levelPart = bonusFactor·g(L)` (probe ratio 0.100 ± 0.003 on 30 variants).
- **Crit:** `effective = raw·(1 + chance·extra)`. Spell crit perks and the character "Critical hit extra damage" perk
  add to chance/extra.
- **Creatures:** `effective × damageMods[element] × (1 − mitigation/100)`. Physical damage is additionally reduced
  by armor (≈ 7 % vs Demon). Weapon-element spells use the weapon damage type (physical unless imbued or bonded).
- **Revelations:**

  | Revelation | Effect by stage 1 / 2 / 3 |
  |---|---|
  | Combat Mastery | effective ×1.031 / 1.037 / 1.045 (crit side) |
  | Ascetic | harmony monk spells raw ×1.048 / 1.096 / 1.145 |
  | Lord of Destruction | elemental stance type only (D24): Flames fire ×1.015 / 1.022 / 1.030 (probe); Thunder +2/3/4 pp crit chance; Decay +15/25.5/30 pp crit extra damage; natural + converted share; nothing without a stance |

  The Master of Flames stance alone gives fire ×1.031.
- **Targets:** the API per-turn value is per-hit × targets of the rotation entry. Use `defaultTargets`.

## Paladin weapons, Ballistic Mastery, Positional Tactics (D21)

**Weapons**
- `weaponBracket('paladin', level, 'bow' | 'crossbow')`: by default the hunt uses a bow and the boss uses a
  crossbow (`paladinWeaponFor(mode)`).
- Bows: Jungle Bow, Soulbleeder, Sanguine Bow, Grand Sanguine Bow, Moonsilver Bow, Stellar Moonsilver Bow, each with
  Diamond Arrow (37). Crossbows: the existing brackets with Spectral Bolt (78).
- Pass `paladinWeapon` in `HitOptions` to choose the weapon.
- Paladin spells do not depend on weapon attack. The weapon choice therefore matters only through Ballistic Mastery,
  auto-attack and the weapon's skill / magic level bonuses.

**Ballistic Mastery** (`BALLISTIC_MASTERY`)
- **Bow: +4 % physical and holy pierce.** A cached damage API probe (`node scripts/probe-pierce.mjs`, 6 API calls)
  shows how pierce changes the creature damage modifier. Pierce first cancels resistance 1:1 until the modifier
  reaches neutral 1.0; the remainder adds at half rate. `pierceDamageMod(mod, pct)` implements this.
  - The probe matched exactly for Behemoth (holy 0.7 → 0.74; with 40 % pierce: 1.05), Dragon Lord (1.0 → 1.02)
    and Demon (1.12 → 1.14) on Divine Caldera.
  - Physical spells gain slightly more, because armor reduction interacts with the modifier (Ethereal Barrage on
    Behemoth: +4.9 % instead of +4.4 %). This is ignored.
  - Immunities (0) are assumed to stay 0.
- **Crossbow: +10 % critical extra damage.** Add it to `critExtraPct` of `critMultiplier`.

**Positional Tactics** (`POSITIONAL_TACTICS`)
- +3 distance for 70 % of the time, otherwise +3 holy/healing magic level.
- Evaluate it with `HitOptions.skillBonus` / `magicLevelBonus` (also `healingAverage({ magicLevelBonus })`).
  Example: +3 magic level adds ≈ 18 to Divine Caldera.

## Stances (D24)

See `src/data/damage/stances.ts` and docs/modules/engine.md. `pierceDamageMod` caps the result at 2× sensitivity (TibiaWiki Elemental Pierce).

## Revelation spells (D20)

- `REVELATION_SPELLS` / `revelationSpell(name)` give the unlocking revelation (wheel-data names):
  - Divine Grenade
  - Executioner's Throw
  - Ice Burst and Terra Burst → Twin Bursts
  - Spiritual Outburst
  - Avatar of Steel, Light, Storm, Nature and Balance. These are buffs without a damage formula.
- Damage spells carry `unlockedBy`.
- A test checks that every spell in `rotations.ts` resolves to a formula for its vocation, including the `or`
  alternatives.

## Single-target spells (D16)

Annihilation, Brutal Strike, Shield Bash, Whirlwind Throw, Divine Missile, Ethereal Spear, Strong Ethereal Spear,
Holy Missile, the elemental Strikes (Strong / Ultimate variants included), Lightning, Death/Physical Strike,
Double Jab, Greater Tiger Clash, Devastating Knockout, Forceful Uppercut, Mystic Repulse, and the target runes
(Sudden Death, HMM, Icicle, Fireball, Stalagmite, LMM).

## Cooldowns and healing

`COOLDOWN_OVERRIDES` (D25): TibiaWiki base cooldowns where the datamine differs, applied on load.


- Cooldowns come from community spell data. 2026 spells without public data are marked
  `cooldownApprox` (Shield Bash/Slam, Divine Grenade, Barrages, Death Echo, Forked spells, Thousand Fist Blows).
- Healing is not in the API. `healing[]` uses community healing formulas with linear `level`, and is approximate.

## Datamine (`npm run datamine:damage`)

`scripts/datamine-damage.mjs` (spell meta in `scripts/datamine-damage-meta.mjs`):

1. Downloads `/meta/*` (9 requests) into the gitignored `scripts/.cache/damage-api/`.
2. Sends a planned set of `POST /damage` requests.
   - The rate limit is about 25 requests per minute, so requests go sequentially, 2.5 s apart, with a generic user agent.
   - Every response is cached by request hash.
   - On a 429 it waits 65 s once and then stops (a re-run resumes from the cache). Hard cap: 400 requests.
3. One response covers every spell of the vocation. Total used: **279 `/damage` + 9 meta**. The plan contains:
   - level / skill / mlvl / weapon grids;
   - level-bracket weapons (200 … 1500);
   - a level sweep;
   - bonus, crit, perk, revelation, creature and target probes.
4. Fits each variant by least squares and writes `spell-formulas.json` and the fixtures.
   `--offline` rebuilds from the cache only.

## Sources and attribution

- Public damage-calculator API: formulas, perks, targets data, rotation presets.
- community spell data: cooldowns and healing formulas.
