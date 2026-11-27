# Third-party notices

This project uses facts, data and software from the sources below. Every new data source or bundled
dependency must be listed here with its license before it is used (a test checks the hosts used by the
scripts and the licenses of runtime dependencies). The built site ships this file together with the
license texts of all bundled packages as `third-party-licenses.txt`.

## Tibia and the Wheel of Destiny — CipSoft GmbH

Tibia is a registered trademark of CipSoft GmbH. Game names, texts and the Wheel of Destiny layout are
© CipSoft GmbH. This is an unofficial, non-commercial fan project, not affiliated with or endorsed by CipSoft.
The wheel data is extracted offline from the official planners (test.tibia.com for the announced wheel,
www.tibia.com for the live wheel); no CipSoft code is committed or shipped, only the derived facts needed to compute builds.

The only CipSoft graphics shipped are the weapon proficiency perk icons in `public/proficiency/` (© CipSoft GmbH),
taken unmodified from the copies in the TibiaPal repository (see below), which mirror TibiaWiki, and the gem mod
icon sheets in `public/gem-mods/` (© CipSoft GmbH), unmodified copies of the official Wheel of Destiny planner's
sheets (test server), and the wheel graphics in `public/wheel/` (© CipSoft GmbH: backdrop, vocation fronts, corner art,
perk, socket and gem icon sheets), unmodified copies of the same planner's images, used to draw the wheel and the vessel
gems the way the planner does. The mod icons are used only as reference images to recognise gems in screenshots the user
imports (locally, in the browser); the cropped Gem Atelier screenshots in `src/lib/fixtures/` (© CipSoft GmbH game
graphics) serve only as test inputs. All are credited in the app ("Icons © CipSoft GmbH") and are not covered by
TibiaPal's MIT license or by CC BY-SA. On request of CipSoft they will be removed.

## TibiaPal — MIT License

Spell damage formulas are fitted on the public damage calculator of TibiaPal (tibiapal.com); community
averages (hits per spell when hunting), rotation presets and related spell data come from TibiaPal
(https://github.com/PawelKusnierek/TibiaPal). The weapon proficiency trees, the perk shaping options and the
client spell ids used to read them come from TibiaPal's proficiency data and calculator; the Divine Empowerment usage assumption (3 turns per field, cast at 80 % of
the cooldown rate) follows that calculator; the shaping options were
compiled there from TibiaWiki BR (see below). They are downloaded offline from the repository
(raw.githubusercontent.com). TibiaPal is licensed as follows:

```
MIT License

Copyright (c) 2022 Pawel Kusnierek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## tibiopedia.pl

Monster facts (element modifiers, damage types, hit points, experience, bestiary class) and weapon facts (attack and
element, defence, class, imbuement slots, bonuses, required level and vocation, ammunition attack and element) and equipment facts (armor,
defence, class, imbuement slots, bonuses, required level and vocation) come from
https://tibiopedia.pl.
They are collected offline at a low request rate and shipped as static JSON; the app makes no requests to the
site and shows no images from it. Each monster keeps a link to its source page. The site publishes no
license for its data; on request of its owners the data will be removed or replaced.

## TibiaWiki

Some spell cooldowns, stance values, a few wand damage values, imbuement protection values, the stacking of
protections, the offensive charm values (chances, damage, caps), the skill food and potion bonuses, the character's own critical hit and the Strike
imbuement values were checked against TibiaWiki, and the item augments (spell, effect, value) and the monk items'
mantra are read from its item infoboxes through the MediaWiki API (`scripts/import-item-augments.mjs`), the creatures of each hunting place are
read from its `CreatureList` (`scripts/import-hunting-spots.mjs`), and the elements and maximum damage of each
creature's attacks are read from its infobox (`scripts/import-monster-damage.mjs`)
(https://tibia.fandom.com). Only individual facts (numbers) are used; no wiki text is copied. TibiaWiki text is
licensed under CC BY-SA.

## TibiaData

The hunting spot weights are shares of the weekly kill statistics of all worlds (© CipSoft GmbH, published on
tibia.com), read offline through the TibiaData API (https://api.tibiadata.com, `scripts/import-hunting-spots.mjs`).
Only the kill counts are used, summed over the worlds and turned into shares; the app makes no requests to the API.

## TibiaWiki BR

The rank 0 and rank 10 values of weapon proficiency perk shaping options come from TibiaWiki BR
(https://www.tibiawiki.com.br), through TibiaPal's export. Only the numbers and effect names are used; no wiki
text is copied. TibiaWiki BR text is licensed under CC BY-SA.

## Bundled software

Runtime packages bundled into the site (React, React DOM, scheduler, fflate, the Cinzel font via @fontsource) keep their
own licenses (MIT, SIL Open Font License 1.1). Their full license texts are generated at build time into
`third-party-licenses.txt`.
