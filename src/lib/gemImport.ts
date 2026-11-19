/**
 * Gem import from Gem Atelier screenshots (runs in the browser; nothing is uploaded).
 * Cells are found by their bevel (light top/left lines); each holds 1–3 mod icons (Lesser / Regular / Greater)
 * centered in a row. Icons are matched against the planner's mod icon sheets (`public/gem-mods/`), the frame colour
 * gives the mod grade (I grey-teal, II bronze, III silver, IV gold).
 */
import type { GemModRef, GemQuality, ModDefinition, ModGrade, OwnedGem } from '../types';
import { createGem, modGrades, withSharedGrades } from './gems';

export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Icon sheets: square icons in one row, index = mod id. */
export interface ModSheets {
  basic: Raster;
  supreme: Raster;
}

export interface ImportedMod extends GemModRef {
  /** RMS colour distance of the best match (0 = identical). */
  distance: number;
  /** Distance gap to the next best mod (small = ambiguous). */
  margin: number;
}

export interface ImportedGem {
  quality: GemQuality;
  mods: ImportedMod[];
  uncertain: boolean;
}

const QUALITY_BY_COUNT: Record<number, GemQuality> = { 1: 'lesser', 2: 'regular', 3: 'greater' };
/** In-game supreme icons are drawn at 34 px (sheet: 35). */
const SUPREME_SCALE = 34 / 35;
const ICON_STRIDE = 51;
const ICON_ROW = 71.5;
const ART_RADIUS = 12.5;
const MAX_DISTANCE = 50;
const MIN_MARGIN = 4;
/** Mean frame colour (ring 16–18 px from the icon centre) per grade. */
const FRAME_COLORS: [ModGrade, number, number, number][] = [
  [1, 0x3e, 0x50, 0x54],
  [2, 0x61, 0x3e, 0x33],
  [3, 0x59, 0x5f, 0x60],
  [4, 0x7f, 0x60, 0x23],
];

const luma = (d: Raster['data'], i: number) => (d[i] + d[i + 1] + d[i + 2]) / 3;
const neutral = (d: Raster['data'], i: number) => Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) < 12;
const isLight = (d: Raster['data'], i: number) => neutral(d, i) && luma(d, i) >= 0x5a && luma(d, i) <= 0x88;

function runs(len: number, on: (k: number) => boolean, min: number): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  for (let k = 0; k <= len; k++) {
    if (k < len && on(k)) {
      if (s < 0) s = k;
    } else if (s >= 0) {
      if (k - s >= min) out.push([s, k - s]);
      s = -1;
    }
  }
  return out;
}

/** Gem Atelier cells: a vertical and a horizontal light line meeting at the top-left corner. */
export function findCells(img: Raster): Rect[] {
  const { width: W, height: H, data: d } = img;
  const horiz = new Map<number, [number, number][]>();
  for (let y = 0; y < H; y++) {
    const r = runs(W, (x) => isLight(d, (y * W + x) * 4), 130).filter(([, w]) => w <= 170);
    if (r.length) horiz.set(y, r);
  }
  const cells: Rect[] = [];
  for (let x = 0; x < W; x++) {
    for (const [y0, h] of runs(H, (y) => isLight(d, (y * W + x) * 4), 90)) {
      if (h > 115) continue;
      for (let dy = -2; dy <= 2; dy++) {
        const hit = (horiz.get(y0 + dy) ?? []).find(([x0, w]) => Math.abs(x0 - x) <= 2 && w >= 140 && w <= 165);
        if (!hit) continue;
        const c = { x, y: y0 + dy, w: hit[1], h };
        if (!cells.some((o) => Math.abs(o.x - c.x) < 10 && Math.abs(o.y - c.y) < 10)) cells.push(c);
        break;
      }
    }
  }
  return cells.sort((a, b) => a.y - b.y || a.x - b.x);
}

interface Template {
  id: number;
  /** Sampled pixels relative to the art centre: dx, dy, r, g, b. */
  px: Float32Array;
}

function sheetTemplates(sheet: Raster, scale: number, badge: boolean): Template[] {
  const S = sheet.height;
  const n = Math.floor(sheet.width / S);
  const T = Math.round(S * scale);
  // Art circle centre in sheet coordinates: basic icons are centred, supreme ones sit low-left (badge top-right).
  const acx = badge ? 14.5 : (S - 1) / 2;
  const acy = badge ? 19.5 : (S - 1) / 2;
  const at = (id: number, x: number, y: number, c: number) => {
    const cx = Math.max(0, Math.min(S - 1, x));
    const cy = Math.max(0, Math.min(S - 1, y));
    return sheet.data[(cy * sheet.width + id * S + cx) * 4 + c];
  };
  const out: Template[] = [];
  for (let id = 0; id < n; id++) {
    const px: number[] = [];
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const sx = (x + 0.5) / scale - 0.5;
        const sy = (y + 0.5) / scale - 0.5;
        const dx = sx - acx;
        const dy = sy - acy;
        const inArt = dx * dx + dy * dy <= (ART_RADIUS / scale) ** 2;
        const inBadge = badge && sx >= 21 && sy <= 13;
        if (!inArt && !inBadge) continue;
        const ix = Math.floor(sx);
        const iy = Math.floor(sy);
        const fx = sx - ix;
        const fy = sy - iy;
        const v = (c: number) =>
          at(id, ix, iy, c) * (1 - fx) * (1 - fy) + at(id, ix + 1, iy, c) * fx * (1 - fy) + at(id, ix, iy + 1, c) * (1 - fx) * fy + at(id, ix + 1, iy + 1, c) * fx * fy;
        if (v(3) < 200) continue;
        px.push(dx * scale, dy * scale, v(0), v(1), v(2));
      }
    }
    if (px.length) out.push({ id, px: Float32Array.from(px) });
  }
  return out;
}

const cache = new WeakMap<ModSheets, { basic: Template[]; supreme: Template[] }>();
function templates(sheets: ModSheets) {
  let t = cache.get(sheets);
  if (!t) {
    t = { basic: sheetTemplates(sheets.basic, 1, false), supreme: sheetTemplates(sheets.supreme, SUPREME_SCALE, true) };
    cache.set(sheets, t);
  }
  return t;
}

function distance(img: Raster, t: Template, cx: number, cy: number): number {
  const { width: W, height: H, data: d } = img;
  let sum = 0;
  let n = 0;
  for (let k = 0; k < t.px.length; k += 5) {
    const x = Math.round(cx + t.px[k]);
    const y = Math.round(cy + t.px[k + 1]);
    if (x < 0 || y < 0 || x >= W || y >= H) return Infinity;
    const i = (y * W + x) * 4;
    sum += (d[i] - t.px[k + 2]) ** 2 + (d[i + 1] - t.px[k + 3]) ** 2 + (d[i + 2] - t.px[k + 4]) ** 2;
    n += 3;
  }
  return Math.sqrt(sum / n);
}

/** Best mod for the icon near (cx, cy), searching ±3 px. */
function matchIcon(img: Raster, list: Template[], cx: number, cy: number) {
  let pos = { x: cx, y: cy, d: Infinity };
  // Locate the icon with the best candidate, then rank all candidates at that spot (±1 px).
  for (const t of list) {
    for (let oy = -3; oy <= 3; oy++) {
      for (let ox = -3; ox <= 3; ox++) {
        const dd = distance(img, t, cx + ox, cy + oy);
        if (dd < pos.d) pos = { x: cx + ox, y: cy + oy, d: dd };
      }
    }
  }
  const ranked = list
    .map((t) => {
      let best = Infinity;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) best = Math.min(best, distance(img, t, pos.x + ox, pos.y + oy));
      return { id: t.id, d: best };
    })
    .sort((a, b) => a.d - b.d);
  return { id: ranked[0]?.id ?? -1, distance: ranked[0]?.d ?? Infinity, margin: (ranked[1]?.d ?? Infinity) - (ranked[0]?.d ?? 0), x: pos.x, y: pos.y };
}

/** Grade from the frame colour around the icon art. */
export function frameGrade(img: Raster, cx: number, cy: number): ModGrade {
  const { width: W, data: d } = img;
  const acc = [0, 0, 0];
  let n = 0;
  for (let y = -18; y <= 18; y++) {
    for (let x = -18; x <= 18; x++) {
      const r = Math.hypot(x, y);
      if (r < 16 || r >= 18 || (y < -10 && Math.abs(x) < 8)) continue;
      const i = (Math.round(cy + y) * W + Math.round(cx + x)) * 4;
      acc[0] += d[i];
      acc[1] += d[i + 1];
      acc[2] += d[i + 2];
      n++;
    }
  }
  const [r, g, b] = acc.map((v) => v / Math.max(1, n));
  let best: ModGrade = 1;
  let bd = Infinity;
  for (const [grade, fr, fg, fb] of FRAME_COLORS) {
    const dd = (r - fr) ** 2 + (g - fg) ** 2 + (b - fb) ** 2;
    if (dd < bd) [best, bd] = [grade, dd];
  }
  return best;
}

/** Share of non-background pixels in the icon art disc (background: neutral grey around 0x48). */
function present(img: Raster, cx: number, cy: number): boolean {
  const { width: W, data: d } = img;
  let on = 0;
  let n = 0;
  for (let y = -10; y <= 10; y++) {
    for (let x = -10; x <= 10; x++) {
      if (x * x + y * y > 100) continue;
      const i = (Math.round(cy + y) * W + Math.round(cx + x)) * 4;
      const l = luma(d, i);
      if (!neutral(d, i) || l < 0x36 || l > 0x5c) on++;
      n++;
    }
  }
  return on / n > 0.5;
}

/** Gems in one Gem Atelier screenshot, for the vocation's `mods`. */
export function readGems(img: Raster, sheets: ModSheets, mods: readonly ModDefinition[]): ImportedGem[] {
  const t = templates(sheets);
  const ids = (kind: ModDefinition['kind']) => new Set(mods.filter((m) => m.kind === kind).map((m) => m.id));
  const basicIds = ids('basic');
  const supremeIds = ids('supreme');
  const basic = t.basic.filter((x) => basicIds.has(x.id));
  const supreme = t.supreme.filter((x) => supremeIds.has(x.id));
  const out: ImportedGem[] = [];
  for (const c of findCells(img)) {
    const cx = c.x + (c.w - 1) / 2;
    const cy = c.y + ICON_ROW;
    if (cy + 20 >= img.height) continue;
    const n = present(img, cx - ICON_STRIDE, cy) && present(img, cx + ICON_STRIDE, cy) ? 3 : present(img, cx - ICON_STRIDE / 2, cy) && present(img, cx + ICON_STRIDE / 2, cy) ? 2 : present(img, cx, cy) ? 1 : 0;
    if (!n) continue;
    const mods: ImportedMod[] = [];
    for (let k = 0; k < n; k++) {
      const x = cx + (k - (n - 1) / 2) * ICON_STRIDE;
      const m = matchIcon(img, k === 2 ? supreme : basic, x, cy);
      mods.push({ modId: m.id, grade: frameGrade(img, m.x, m.y), distance: Math.round(m.distance * 10) / 10, margin: Math.round(m.margin * 10) / 10 });
    }
    // A cell that matches no icon well is not a gem (other windows with similar bevels).
    if (mods.every((m) => m.distance > MAX_DISTANCE)) continue;
    out.push({ quality: QUALITY_BY_COUNT[n], mods, uncertain: mods.some((m) => m.distance > MAX_DISTANCE || m.margin < MIN_MARGIN) });
  }
  return out;
}

/** Owned gems from imported ones; basic mods go into the slot they may occupy (swapped when needed). */
export function toOwnedGems(gems: readonly ImportedGem[], mods: readonly ModDefinition[]): OwnedGem[] {
  const slotsOf = (id: number) => mods.find((m) => m.kind === 'basic' && m.id === id)?.slots;
  const fits = (id: number, slot: 1 | 2) => {
    const s = slotsOf(id);
    return !s || s.includes(slot);
  };
  return gems.map((g) => {
    const ref = (m: ImportedMod | undefined): GemModRef | null => (m && m.modId >= 0 ? { modId: m.modId, grade: m.grade } : null);
    let [b1, b2] = [g.mods[0], g.mods[1]];
    if (b1 && b2 && !(fits(b1.modId, 1) && fits(b2.modId, 2)) && fits(b2.modId, 1) && fits(b1.modId, 2)) [b1, b2] = [b2, b1];
    return { ...createGem(g.quality), basic1: ref(b1), basic2: ref(b2), supreme: ref(g.mods[2]) };
  });
}

/**
 * Adds imported gems; their frame grades are the current in-game ones, so they replace the grades of the same mods
 * in the existing gems (grades are shared per mod).
 */
export function mergeImported(existing: readonly OwnedGem[], imported: readonly OwnedGem[]): OwnedGem[] {
  const fresh = modGrades(imported);
  const kinds = { basic1: 'basic', basic2: 'basic', supreme: 'supreme' } as const;
  const updated = existing.map((g) => {
    const out = { ...g };
    for (const slot of ['basic1', 'basic2', 'supreme'] as const) {
      const ref = g[slot];
      const grade = ref && fresh.get(`${kinds[slot]}:${ref.modId}`);
      if (ref && grade) out[slot] = { ...ref, grade };
    }
    return out;
  });
  return withSharedGrades([...updated, ...imported]);
}

/** Stable key of a gem's content (used to skip the same page imported twice). */
export const gemSignature = (g: ImportedGem) => `${g.quality}:${g.mods.map((m) => `${m.modId}/${m.grade}`).join(',')}`;
