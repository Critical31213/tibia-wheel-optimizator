/**
 * Official Wheel of Destiny planner export code (test.tibia.com), reverse-engineered from the planner WASM.
 * D88: the live planner (www.tibia.com) reads version 0 codes with 4 domain vessels.
 * Format spec: docs/modules/planner-code.md.
 */
import { inflateSync } from 'fflate';
import type { GemQuality, Vocation, WheelVariant } from '../../types';
import { getWheelData, WHEEL_DATA } from './index';

/** Official planner on tibia.com; still the old wheel (Vessel Resonance): reads the live variant's codes (D88). */
export const LIVE_PLANNER_URL = 'https://www.tibia.com/community/?subtopic=wheelofdestinyplanner';
/** Planner that reads our codes. Switch to LIVE_PLANNER_URL when `npm run check:planner` reports the new wheel. */
export const PLANNER_URL = 'https://www.test.tibia.com/community/?subtopic=wheelofdestinyplanner';
export const PLANNER_CODE_VERSION = 1;
export const GRID_SIZE = 36;
export const VESSEL_COUNT = 8;
/** D88: live planner: code version 0, one vessel per domain (id = quarter TL, TR, BL, BR). */
export const LIVE_CODE_VERSION = 0;
export const LIVE_VESSEL_COUNT = 4;
const vesselCount = (variant: WheelVariant = 'current') => (variant === 'live' ? LIVE_VESSEL_COUNT : VESSEL_COUNT);
/** Byte meaning "no mod" in a vessel slot. */
export const NO_MOD = 0xff;

const LETTER: Record<Vocation, string> = { knight: 'K', paladin: 'P', sorcerer: 'S', druid: 'D', monk: 'M' };
const VOC_BY_LETTER = Object.fromEntries(Object.entries(LETTER).map(([v, l]) => [l, v as Vocation]));

/**
 * Gem in a vessel. Mod keys are the planner's keys, identical to `mods.basic[].id` / `mods.supreme[].id`
 * in wheel-data.json (no mapping needed). The planner silently drops a gem whose slots do not match the vessel
 * quality: lesser = basic1, regular = basic1 + basic2, greater = basic1 + basic2 + supreme (grade IV implied).
 */
export interface PlannerVessel {
  vesselId: number;
  basic1?: number;
  basic2?: number;
  supreme?: number;
}

export interface PlannerBuild {
  vocation: Vocation;
  /** D88: target planner (default 'current' = the announced wheel). */
  variant?: WheelVariant;
  /** gridId (0..35) -> promotion points. */
  points: Record<number, number>;
  vessels?: PlannerVessel[];
}

export interface DecodedPlannerCode extends PlannerBuild {
  version: number;
  /** Version 0: the live planner's format (4 domain vessels); the test-server planner reads only its tiles. */
  legacy: boolean;
  vessels: PlannerVessel[];
}

// ---------------------------------------------------------------------------
// grid id <-> engine SliceId (engine slice id === planner tile enum name, e.g. "QTL8")

export function sliceIdForGrid(gridId: number, vocation: Vocation = 'knight'): string {
  const t = getWheelData(vocation).tiles.find((x) => x.gridId === gridId);
  if (!t) throw new RangeError(`Invalid grid id ${gridId}`);
  return t.tileName;
}

export function gridForSliceId(sliceId: string, vocation: Vocation = 'knight'): number {
  const t = getWheelData(vocation).tiles.find((x) => x.tileName === sliceId);
  if (!t) throw new RangeError(`Invalid slice id ${sliceId}`);
  return t.gridId;
}

// ---------------------------------------------------------------------------
// encode / decode

export function vesselQuality(vesselId: number): GemQuality {
  const v = WHEEL_DATA.vessels.list.find((x) => x.id === vesselId);
  if (!v) throw new RangeError(`Invalid vessel id ${vesselId}`);
  return v.quality;
}

/** Reasons the planner would drop (or not show) the given gems; empty when all are valid. */
export function plannerVesselIssues(vocation: Vocation, vessels: PlannerVessel[] = [], variant: WheelVariant = 'current'): string[] {
  const { basic, supreme } = getWheelData(vocation, variant).mods;
  const slot1 = new Set(basic.filter((m) => m.slots.includes(1)).map((m) => m.id));
  const slot2 = new Set(basic.filter((m) => m.slots.includes(2)).map((m) => m.id));
  const sup = new Set(supreme.map((m) => m.id));
  const issues: string[] = [];
  const seen = new Set<number>();
  for (const g of vessels) {
    const at = `vessel ${g.vesselId}`;
    if (!Number.isInteger(g.vesselId) || g.vesselId < 0 || g.vesselId >= vesselCount(variant)) {
      issues.push(`${at}: invalid vessel id`);
      continue;
    }
    if (seen.has(g.vesselId)) issues.push(`${at}: duplicate`);
    seen.add(g.vesselId);
    const has = [g.basic1, g.basic2, g.supreme].map((m) => m !== undefined && m >= 0);
    if (variant === 'live') {
      // Live: any gem quality in any vessel; its mods fill the slots in order.
      if (!has[0] || (has[2] && !has[1])) issues.push(`${at}: a gem needs basic1, then basic2, then supreme`);
    } else {
      const q = vesselQuality(g.vesselId);
      const want = q === 'lesser' ? [true, false, false] : q === 'regular' ? [true, true, false] : [true, true, true];
      if (has.some((h, i) => h !== want[i])) issues.push(`${at}: a ${q} gem needs exactly ${['basic1', 'basic2', 'supreme'].filter((_, i) => want[i]).join(' + ')}`);
    }
    if (has[0] && !slot1.has(g.basic1!)) issues.push(`${at}: basic mod ${g.basic1} not allowed in slot 1`);
    if (has[1] && !slot2.has(g.basic2!)) issues.push(`${at}: basic mod ${g.basic2} not allowed in slot 2`);
    if (has[2] && !sup.has(g.supreme!)) issues.push(`${at}: supreme mod ${g.supreme} not available to ${vocation}`);
  }
  return issues;
}

export function encodePlannerPayload(build: PlannerBuild): Uint8Array {
  const count = vesselCount(build.variant);
  const out = new Uint8Array(GRID_SIZE + count * 3).fill(0);
  out.fill(NO_MOD, GRID_SIZE);
  for (const [k, v] of Object.entries(build.points)) {
    const id = Number(k);
    if (!Number.isInteger(id) || id < 0 || id >= GRID_SIZE) throw new RangeError(`Invalid grid id ${k}`);
    if (!Number.isInteger(v) || v < 0 || v > 200) throw new RangeError(`Invalid points ${v} on grid ${k}`);
    out[id] = v;
  }
  for (const g of build.vessels ?? []) {
    if (!Number.isInteger(g.vesselId) || g.vesselId < 0 || g.vesselId >= count)
      throw new RangeError(`Invalid vessel id ${g.vesselId}`);
    [g.basic1, g.basic2, g.supreme].forEach((m, i) => {
      if (m === undefined || m < 0) return;
      if (!Number.isInteger(m) || m >= NO_MOD) throw new RangeError(`Invalid mod key ${m}`);
      out[GRID_SIZE + g.vesselId * 3 + i] = m;
    });
  }
  return out;
}

/**
 * Encodes a build as a planner code (byte-identical to the planner's own `getCode()`). Throws on gems the
 * planner would drop unless `strict` is false. Tile points are not validated: the planner rejects the whole
 * code (`updateByCode` = -1) if any slice exceeds its capacity or holds points without being unlocked.
 */
export function encodePlannerCode(build: PlannerBuild, { strict = true }: { strict?: boolean } = {}): string {
  const letter = LETTER[build.vocation];
  if (!letter) throw new RangeError(`Invalid vocation ${build.vocation}`);
  if (strict) {
    const issues = plannerVesselIssues(build.vocation, build.vessels, build.variant);
    if (issues.length) throw new Error(`Invalid gems: ${issues.join('; ')}`);
  }
  const version = build.variant === 'live' ? LIVE_CODE_VERSION : PLANNER_CODE_VERSION;
  return letter + version + toBase64Url(deflatePlanner(encodePlannerPayload(build)));
}

export function decodePlannerCode(code: string): DecodedPlannerCode {
  const c = code.trim();
  const vocation = VOC_BY_LETTER[c[0]];
  const version = Number(c[1]);
  if (!vocation || !(version === 0 || version === 1)) throw new Error(`Unknown planner code header "${c.slice(0, 2)}"`);
  const raw = inflateSync(fromBase64Url(c.slice(2)));
  const count = version === 1 ? VESSEL_COUNT : LIVE_VESSEL_COUNT;
  const expected = GRID_SIZE + count * 3;
  if (raw.length !== expected) throw new Error(`Planner code payload has ${raw.length} bytes, expected ${expected}`);
  const points: Record<number, number> = {};
  for (let i = 0; i < GRID_SIZE; i++) if (raw[i]) points[i] = raw[i];
  const vessels: PlannerVessel[] = [];
  for (let v = 0; v < count; v++) {
    const [b1, b2, s] = raw.subarray(GRID_SIZE + v * 3, GRID_SIZE + v * 3 + 3);
    if (b1 === NO_MOD && b2 === NO_MOD && s === NO_MOD) continue;
    const g: PlannerVessel = { vesselId: v };
    if (b1 !== NO_MOD) g.basic1 = b1;
    if (b2 !== NO_MOD) g.basic2 = b2;
    if (s !== NO_MOD) g.supreme = s;
    vessels.push(g);
  }
  return { vocation, variant: version === 0 ? 'live' : 'current', version, legacy: version === 0, points, vessels };
}

/** Planner URL for a code; version 0 codes (live variant, D88) open the live planner. */
export function plannerUrl(code: string): string {
  const c = code.trim();
  return `${c[1] === String(LIVE_CODE_VERSION) ? LIVE_PLANNER_URL : PLANNER_URL}&code=${encodeURIComponent(c)}`;
}

// ---------------------------------------------------------------------------
// base64url (no padding)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let k = 0; k < chars; k++) s += B64[(n >> (18 - 6 * k)) & 63];
  }
  return s;
}

function fromBase64Url(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error(`Invalid planner code character "${ch}"`);
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Raw deflate reproducing the planner (zlib-ng 1.3.1-compat, level 9 = deflate_slow: lazy matching, 3-byte
// hash, nearest of the longest matches, never matching window position 0). Payloads this small always come
// out as one fixed-Huffman block. Verified byte-identical against 500+ planner codes.

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const MAX_MATCH = 258;
const WANT_MIN_MATCH = 4;

class BitWriter {
  bytes: number[] = [];
  private acc = 0;
  private n = 0;
  bits(value: number, count: number) {
    for (let i = 0; i < count; i++) {
      this.acc |= ((value >> i) & 1) << this.n;
      if (++this.n === 8) this.flushByte();
    }
  }
  /** Huffman code, most significant bit first. */
  code(value: number, count: number) {
    for (let i = count - 1; i >= 0; i--) this.bits((value >> i) & 1, 1);
  }
  private flushByte() {
    this.bytes.push(this.acc);
    this.acc = 0;
    this.n = 0;
  }
  finish(): Uint8Array {
    if (this.n) this.flushByte();
    return Uint8Array.from(this.bytes);
  }
}

function fixedLit(w: BitWriter, sym: number) {
  if (sym < 144) w.code(0x30 + sym, 8);
  else if (sym < 256) w.code(0x190 + sym - 144, 9);
  else if (sym < 280) w.code(sym - 256, 7);
  else w.code(0xc0 + sym - 280, 8);
}

function emitMatch(w: BitWriter, len: number, dist: number) {
  let li = LEN_BASE.length - 1;
  while (LEN_BASE[li] > len) li--;
  if (len === 258) li = 28;
  fixedLit(w, 257 + li);
  w.bits(len - LEN_BASE[li], LEN_EXTRA[li]);
  let di = DIST_BASE.length - 1;
  while (DIST_BASE[di] > dist) di--;
  w.code(di, 5);
  w.bits(dist - DIST_BASE[di], DIST_EXTRA[di]);
}

/** zlib-ng deflate_slow (level 9) token choice with exact longest-match search; one fixed-Huffman block. */
export function deflatePlanner(data: Uint8Array): Uint8Array {
  const w = new BitWriter();
  w.bits(1, 1); // BFINAL
  w.bits(1, 2); // BTYPE = fixed Huffman
  const n = data.length;
  const inserted = new Uint8Array(n);
  let matchStart = 0;
  const longest = (pos: number, threshold: number): number => {
    let best = threshold;
    for (let p = pos - 1; p >= 1; p--) {
      if (!inserted[p] || data[p] !== data[pos] || data[p + 1] !== data[pos + 1] || data[p + 2] !== data[pos + 2]) continue;
      let len = 3;
      while (len < MAX_MATCH && pos + len < n && data[p + len] === data[pos + len]) len++;
      if (len > best) {
        best = len;
        matchStart = p;
      }
    }
    return Math.min(best, n - pos);
  };
  let strstart = 0;
  let prevLen = 0;
  let prevMatch = 0;
  let available = false;
  while (strstart < n) {
    const lookahead = n - strstart;
    let headOk = false;
    if (lookahead >= WANT_MIN_MATCH) {
      for (let p = strstart - 1; p >= 1 && !headOk; p--)
        headOk = !!inserted[p] && data[p] === data[strstart] && data[p + 1] === data[strstart + 1] && data[p + 2] === data[strstart + 2];
      inserted[strstart] = 1;
    }
    prevMatch = matchStart;
    let matchLen = 2;
    if (headOk && prevLen < MAX_MATCH) matchLen = longest(strstart, prevLen || 2);
    if (prevLen >= 3 && matchLen <= prevLen) {
      emitMatch(w, prevLen, strstart - 1 - prevMatch);
      const maxInsert = strstart + lookahead - 3;
      const movFwd = prevLen - 2;
      if (maxInsert > strstart) for (let k = 1; k <= Math.min(movFwd, maxInsert - strstart); k++) inserted[strstart + k] = 1;
      prevLen = 0;
      available = false;
      strstart += movFwd + 1;
    } else {
      if (available) fixedLit(w, data[strstart - 1]);
      prevLen = matchLen;
      available = true;
      strstart++;
    }
  }
  if (available) fixedLit(w, data[strstart - 1]);
  fixedLit(w, 256);
  return w.finish();
}
