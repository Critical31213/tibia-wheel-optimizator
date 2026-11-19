import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import type { ModDefinition, OwnedGem } from '../types';
import { getWheel } from './api';
import { mergeImported, readGems, toOwnedGems, type ImportedGem } from './gemImport';

const png = (path: string) => PNG.sync.read(readFileSync(path));
const sheets = { basic: png('public/gem-mods/basic.png'), supreme: png('public/gem-mods/supreme.png') };
const mods: ModDefinition[] = getWheel('paladin').mods;
const ids = (g: ImportedGem) => g.mods.map((m) => `${m.modId}/${m.grade}`).join(' ');
const read = (name: string) => readGems(png(`src/lib/fixtures/atelier-${name}.png`), sheets, mods);

describe('gem import from Gem Atelier screenshots (D63)', () => {
  it('reads greater gems with supreme variants and frame grades', () => {
    const g = read('greater');
    expect(g).toHaveLength(8);
    expect(g.every((x) => x.quality === 'greater' && !x.uncertain)).toBe(true);
    // Mitigation Multiplier, Earth/Ice Resistance, Aug. Divine Grenade +6% base damage (selected gem's text).
    expect(ids(g[0])).toBe('30/1 12/1 26/1');
    // Hit Points in the gold (grade IV) frame.
    expect(ids(g[1])).toBe('31/4 6/1 26/1');
    expect(g[2].mods[2].modId).toBe(40);
  });

  it('reads regular and lesser pages', () => {
    const r = read('regular');
    expect(r).toHaveLength(15);
    expect(r.every((x) => x.quality === 'regular')).toBe(true);
    expect(ids(r[0])).toBe('4/1 5/1');
    expect(ids(r[2])).toBe('31/4 14/1');
    const l = read('lesser');
    expect(l).toHaveLength(7);
    expect(ids(l[0])).toBe('40/1');
  });

  it('turns imported gems into owned gems and shares their grades', () => {
    const [gem] = toOwnedGems([{ quality: 'regular', uncertain: false, mods: [{ modId: 31, grade: 4, distance: 0, margin: 99 }, { modId: 5, grade: 1, distance: 0, margin: 99 }] }], mods);
    expect(gem.basic1).toEqual({ modId: 31, grade: 4 });
    const old: OwnedGem = { id: 'a', quality: 'lesser', basic1: { modId: 31, grade: 1 }, basic2: null, supreme: null };
    const all = mergeImported([old], [gem]);
    expect(all).toHaveLength(2);
    expect(all[0].basic1).toEqual({ modId: 31, grade: 4 });
  });
});
