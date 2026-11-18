/** Pure gem helpers: slot rules, mod filtering, (de)serialisation. */
import type { GemModRef, GemQuality, ModDefinition, ModGrade, ModKind, OwnedGem, Vocation } from '../types';

export type GemSlot = 'basic1' | 'basic2' | 'supreme';

export const GEM_QUALITIES: readonly GemQuality[] = ['lesser', 'regular', 'greater'];
export const MOD_GRADES: readonly ModGrade[] = [1, 2, 3, 4];
export const GEM_SLOTS: readonly GemSlot[] = ['basic1', 'basic2', 'supreme'];

/** Lesser = 1 basic, regular = 2 basic, greater = 2 basic + 1 supreme. */
export function slotsForQuality(quality: GemQuality): GemSlot[] {
  if (quality === 'lesser') return ['basic1'];
  if (quality === 'regular') return ['basic1', 'basic2'];
  return ['basic1', 'basic2', 'supreme'];
}

export const slotKind = (slot: GemSlot): ModKind => (slot === 'supreme' ? 'supreme' : 'basic');

/** Mods that may go into `slot` (basic mods without `slots` fit both basic slots). */
export function modsForSlot(mods: readonly ModDefinition[], slot: GemSlot): ModDefinition[] {
  if (slot === 'supreme') return mods.filter((m) => m.kind === 'supreme');
  const n = slot === 'basic1' ? 1 : 2;
  return mods.filter((m) => m.kind === 'basic' && (!m.slots || m.slots.includes(n)));
}

export function findMod(mods: readonly ModDefinition[], kind: ModKind, id: number): ModDefinition | undefined {
  return mods.find((m) => m.kind === kind && m.id === id);
}

/** Clears slots the gem's quality does not have. */
export function normalizeGem(gem: OwnedGem): OwnedGem {
  const allowed = new Set(slotsForQuality(gem.quality));
  return {
    ...gem,
    basic1: allowed.has('basic1') ? gem.basic1 : null,
    basic2: allowed.has('basic2') ? gem.basic2 : null,
    supreme: allowed.has('supreme') ? gem.supreme : null,
  };
}

let seq = 0;
export function newGemId(): string {
  seq += 1;
  return `g${Date.now().toString(36)}${seq.toString(36)}`;
}

export function createGem(quality: GemQuality, id = newGemId()): OwnedGem {
  return { id, quality, basic1: null, basic2: null, supreme: null };
}

const isQuality = (v: unknown): v is GemQuality => GEM_QUALITIES.includes(v as GemQuality);
const isGrade = (v: unknown): v is ModGrade => MOD_GRADES.includes(v as ModGrade);

function sanitizeRef(v: unknown): GemModRef | null {
  if (!v || typeof v !== 'object') return null;
  const { modId, grade } = v as Record<string, unknown>;
  if (typeof modId !== 'number' || !Number.isInteger(modId) || modId < 0) return null;
  return { modId, grade: isGrade(grade) ? grade : 1 };
}

/** Validates an untrusted gem list (localStorage); invalid entries are dropped. */
export function sanitizeGems(raw: unknown): OwnedGem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: OwnedGem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const g = item as Record<string, unknown>;
    if (!isQuality(g.quality)) continue;
    const id = typeof g.id === 'string' && g.id && !seen.has(g.id) ? g.id : newGemId();
    seen.add(id);
    out.push(
      normalizeGem({
        id,
        quality: g.quality,
        basic1: sanitizeRef(g.basic1),
        basic2: sanitizeRef(g.basic2),
        supreme: sanitizeRef(g.supreme),
      }),
    );
  }
  return out;
}

export function parseGems(json: string | null): OwnedGem[] {
  if (!json) return [];
  try {
    return sanitizeGems(JSON.parse(json));
  } catch {
    return [];
  }
}

export const serializeGems = (gems: readonly OwnedGem[]): string => JSON.stringify(gems);

export const gemsStorageKey = (vocation: Vocation): string => `wheel-optimizer:gems:v1:${vocation}`;
