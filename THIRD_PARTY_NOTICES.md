# Third-party notices

This project uses facts, data and software from the sources below. Every new data source or bundled
dependency must be listed here with its license before it is used (a test checks the hosts used by the
scripts and the licenses of runtime dependencies). The built site ships this file together with the
license texts of all bundled packages as `third-party-licenses.txt`.

## Tibia and the Wheel of Destiny — CipSoft GmbH

Tibia is a registered trademark of CipSoft GmbH. Game names, texts and the Wheel of Destiny layout are
© CipSoft GmbH. This is an unofficial, non-commercial fan project, not affiliated with or endorsed by CipSoft.
The wheel data is extracted offline from the official planner (test.tibia.com); no CipSoft code or graphics
are committed or shipped, only the derived facts needed to compute builds.

## TibiaPal — MIT License

Spell damage formulas are fitted on the public damage calculator of TibiaPal (tibiapal.com); community
averages (hits per spell when hunting), rotation presets and related spell data come from TibiaPal
(https://github.com/PawelKusnierek/TibiaPal). TibiaPal is licensed as follows:

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

Monster facts (element modifiers, damage types, hit points, experience) come from https://tibiopedia.pl.
They are collected offline at a low request rate and shipped as static JSON; the app makes no requests to the
site and shows no images from it. Each monster keeps a link to its source page. The site publishes no
license for its data; on request of its owners the data will be removed or replaced.

## TibiaWiki

Some spell cooldowns and stance values were checked against TibiaWiki (https://tibia.fandom.com). Only
individual facts (numbers) are used; no wiki text is copied. TibiaWiki text is licensed under CC BY-SA.

## Bundled software

Runtime packages bundled into the site (React, React DOM, scheduler, fflate, the Cinzel font via @fontsource) keep their
own licenses (MIT, SIL Open Font License 1.1). Their full license texts are generated at build time into
`third-party-licenses.txt`.
