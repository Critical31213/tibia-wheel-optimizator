/** Browser side of the gem import: images → pixels (canvas). Nothing leaves the page. */
import type { ModSheets, Raster } from './gemImport';

async function rasterOf(src: Blob): Promise<Raster> {
  const bmp = await createImageBitmap(src);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bmp, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    // Drop the canvas pixels right away; only the extracted gems are kept.
    canvas.width = canvas.height = 0;
    return { data, width, height };
  } finally {
    bmp.close();
  }
}

export const imageRaster = (file: Blob): Promise<Raster> => rasterOf(file);

let sheets: Promise<ModSheets> | null = null;
/** Mod icon sheets (planner graphics, © CipSoft GmbH), loaded on first import. */
export function loadModSheets(): Promise<ModSheets> {
  const get = async (name: string) => rasterOf(await (await fetch(`${import.meta.env.BASE_URL}gem-mods/${name}.png`)).blob());
  sheets ??= Promise.all([get('basic'), get('supreme')]).then(([basic, supreme]) => ({ basic, supreme }));
  sheets.catch(() => (sheets = null));
  return sheets;
}
