# Gem import (D63)

`src/lib/gemImport.ts` (pure, tested on fixtures) and `src/lib/gemImportBrowser.ts` (canvas decoding).
Everything runs in the browser; the screenshot pixels are dropped right after reading.

1. **Cells**: Gem Atelier cells have a light top/left bevel line (neutral grey 0x5a–0x88). `findCells` pairs a
   vertical light run (90–115 px) with a horizontal one (140–165 px) starting at the same corner.
2. **Quality**: icons sit in a row 71.5 px below the cell top, 51 px apart, centred: icons present at ±51 → greater
   (3), at ±25.5 → regular (2), at the centre → lesser (1). Presence = more than half of the art disc is not
   background grey.
3. **Mods**: `public/gem-mods/basic.png` (30 px icons) and `supreme.png` (35 px, drawn at 34 px in game) are the
   planner sheets, icon index = mod id. Only the art disc (r ≤ 12.5 px) is compared, so the grade frame does not
   matter; supreme icons also compare the variant badge (top right). The icon is located by searching ±3 px, then all
   of the vocation's mods are ranked (RMS colour distance). A match is "uncertain" above 50 or with a margin below 4
   to the runner-up. Icons 1–2 are basic mods (swapped if the slot rules require), icon 3 the supreme mod.
4. **Grade**: mean colour of the frame ring 16–18 px from the art centre, nearest of grey-teal (I), bronze (II),
   silver (III), gold (IV). Grades are per mod in the game, so imported grades replace those of the same mods in
   existing gems (`mergeImported` + `withSharedGrades`).

The client must not be rescaled (1:1 screenshot). Fixtures: `src/lib/fixtures/atelier-*.png` (cropped grids).
