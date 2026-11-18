// Extracts Wheel of Destiny facts from the official planner (WASM) into src/data/wheel/wheel-data.json.
// Inputs (gitignored, downloaded manually): scripts/.cache/wod/*, scripts/.cache/tibiapal/*.
// Usage: npm run extract:wheel
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WOD = join(ROOT, 'scripts/.cache/wod');
const PAL = join(ROOT, 'scripts/.cache/tibiapal');
const OUT = join(ROOT, 'src/data/wheel/wheel-data.json');

const STR = JSON.parse(readFileSync(join(WOD, 'SkillwheelStringsJsonLibrary.json'), 'utf8'));
const TEMPLATES = JSON.parse(readFileSync(join(PAL, 'wheelTemplatesData.json'), 'utf8'));
const M = await require(join(WOD, 'skillgrid.cjs'))();

const VOCS = ['knight', 'paladin', 'sorcerer', 'druid', 'monk'];
const VOC_ENUM = { knight: 'Knight', paladin: 'Paladin', sorcerer: 'Sorcerer', druid: 'Druid', monk: 'Monk' };
const QUARTERS = ['TL', 'TR', 'BL', 'BR'];
const DOMAINS = { TL: 'topLeft', TR: 'topRight', BL: 'bottomLeft', BR: 'bottomRight' };
const RING_BY_CAP = { 50: 1, 75: 2, 100: 3, 150: 4, 200: 5 };
const QUALITY = ['lesser', 'regular', 'greater'];
const MEDIUM_CAT = ['unique', 'skillBonus', 'leech', 'augmentation', 'gemVessel', 'revelationMastery', 'other'];
const SUPREME_CAT = ['effect', 'augCrit', 'augCooldown', 'augHealing', 'augDamage', 'augOther', 'revelationMastery'];
const SMALL_NAMES = { 2: 'Hit Points and Mana' };
const GROUP_AUGMENTS = {
  'Special Spells': ['Lightning', 'Strong Energy Strike', 'Strong Flame Strike'],
  'Focus Spells': ["Hell's Core", 'Rage of the Skies'],
  'Forked Spells': ['Forked Thorns', 'Forked Glacier'],
};
const REVELATION_SPELLS = {
  "Executioner's Throw": ["Executioner's Throw"],
  'Avatar of Steel': ['Avatar of Steel'],
  'Divine Grenade': ['Divine Grenade'],
  'Divine Empowerment': ['Divine Empowerment'],
  'Avatar of Light': ['Avatar of Light'],
  'Avatar of Storm': ['Avatar of Storm'],
  'Twin Bursts': ['Ice Burst', 'Terra Burst'],
  'Avatar of Nature': ['Avatar of Nature'],
  'Spiritual Outburst': ['Spiritual Outburst'],
  'Avatar of Balance': ['Avatar of Balance'],
};
const REVELATION_AFFECTS = { 'Beam Mastery': ['Great Death Beam', 'Great Energy Beam'] };

// ---------------------------------------------------------------------------
// helpers
const arr = (v) => { const a = []; for (let i = 0; i < v.size(); i++) a.push(v.get(i)); v.delete(); return a; };
const tileEnum = (id) => Object.values(M.EGridTile).find((e) => e && e.value === id);
const tileName = (id) => Object.entries(M.EGridTile).find(([, e]) => e && e.value === id)[0];
const stripHtml = (s) => String(s ?? '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/li>/gi, '\n').replace(/<li[^>]*>/gi, '- ')
  .replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
const split = (n) => { const [full, short] = String(n).split('|'); return { full, short: short ?? full }; };
const num = (s) => { const m = String(s).match(/[-+]?\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
const assert = (cond, msg) => { if (!cond) throw new Error('Assertion failed: ' + msg); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function planner(voc) {
  const p = new M.SkillwheelPlanner(M.EActiveVocation[VOC_ENUM[voc]]);
  return {
    p,
    tiles: () => arr(p.getSkillParameters()).map((t) => ({ ...t, id: t.id.value, q: t.quarter.value, cat: t.mediumPerkCategory.value })),
    corners: () => arr(p.getCornerParameters()).map((c) => ({ ...c, id: c.id.value })),
    med: () => arr(p.getMediumPerksSummary()).map((m) => ({ ...m, category: m.category.value })),
    small: () => Object.fromEntries(arr(p.getSmallPerksSummary()).map((s) => [s.id, s.value])),
    vessels: () => arr(p.getVesselParameters()).map((v) => ({ ...v, valueBasicMod1: arr(v.valueBasicMod1), valueBasicMod2: arr(v.valueBasicMod2) })),
    fill: (id) => p.fillSkill(tileEnum(id)),
    add: (id, n) => p.addToSkill(tileEnum(id), n),
    clear: (id) => p.clearSkill(tileEnum(id)),
    unlocked: (id) => arr(p.getSkillParameters())[id].unlocked,
    done: () => p.delete(),
  };
}

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

/** Fill whole wheel in a random valid order; returns sequence of fills. */
function randomFullFill(h, seed, onFill) {
  const r = rng(seed); const filled = new Set();
  while (filled.size < 36) {
    const c = h.tiles().filter((t) => t.unlocked && !filled.has(t.id));
    const t = c[Math.floor(r() * c.length)];
    h.fill(t.id); filled.add(t.id); onFill?.(t);
  }
}

// ---------------------------------------------------------------------------
// empirical derivations
function deriveUnlockGraph(voc) {
  const h0 = planner(voc); const initial = h0.tiles().filter((t) => t.unlocked).map((t) => t.id); h0.done();
  const inEdges = {};
  for (let y = 0; y < 36; y++) {
    if (initial.includes(y)) continue;
    const h = planner(voc); const filled = new Set(); const blocked = new Set();
    let progress = true;
    while (progress) {
      progress = false;
      for (const t of h.tiles()) {
        if (!t.unlocked || filled.has(t.id) || blocked.has(t.id) || t.id === y) continue;
        h.fill(t.id);
        if (h.unlocked(y)) { blocked.add(t.id); h.clear(t.id); assert(!h.unlocked(y), 'clear leaf'); }
        else filled.add(t.id);
        progress = true;
      }
    }
    inEdges[y] = [...blocked].sort((a, b) => a - b);
    h.done();
  }
  const edges = {};
  for (let x = 0; x < 36; x++) edges[x] = [];
  for (const [y, xs] of Object.entries(inEdges)) for (const x of xs) edges[x].push(Number(y));
  return { initiallyUnlocked: initial, edges };
}

function deriveRevelationThresholds(voc) {
  const h = planner(voc); const t = h.tiles();
  const order = [14, 13, 8, 12, 2, 6, 1, 0, 7].filter((id) => t[id].q === 0);
  const stageAt = []; const bonusAt = []; let last = 0; let lastB = 0; let pts = 0;
  // avoid RM tile until last so raw points = corner points
  const rmLast = [...order.filter((id) => t[id].cat !== 5), ...order.filter((id) => t[id].cat === 5)];
  for (const id of rmLast) for (let i = 0; i < t[id].maxSkillPoints; i++) {
    h.add(id, 1); pts++;
    const lvl = h.corners()[0].level; const b = h.p.getGridDamageAndHealingBonus();
    if (lvl !== last) { stageAt.push(pts); last = lvl; }
    if (b !== lastB) { bonusAt.push(b); lastB = b; }
  }
  h.done();
  return { thresholds: stageAt, bonusPerStage: [0, ...bonusAt] };
}

function verifyRevelationMastery(voc, rmPerTile) {
  // RM conviction: fill 14, 8, then RM tile 7 (TL)
  const h = planner(voc); h.fill(14); h.fill(8);
  const before = h.corners()[0].currentSkillPoints;
  h.fill(7);
  const after = h.corners()[0].currentSkillPoints;
  const ok = after - before === 100 + rmPerTile;
  // RM supreme gem (Gift of Life, key 5) in greater vessel 2 after 3 Gem Vessel slices
  const h2 = planner(voc); for (const id of [14, 21, 15, 20, 9]) h2.fill(id);
  const c0 = h2.corners()[0].currentSkillPoints;
  const b1 = arr(h2.p.getAvailableBasicModsPos1())[0].id; const b2 = arr(h2.p.getAvailableBasicModsPos2())[0].id;
  h2.p.onModChange(1, b1, 2); h2.p.onModChange(2, b2, 2); h2.p.onModChange(3, 5, 2);
  const gem = h2.corners()[0].currentSkillPoints - c0;
  h.done(); h2.done();
  return { convictionOk: ok, gemBonusAtMaxGrade: gem };
}

function verifyVesselsAndBonuses(voc, bonusPerStage, seeds) {
  const results = [];
  for (const seed of seeds) {
    const h = planner(voc); let gv = 0; const order = [];
    randomFullFill(h, seed, (t) => {
      if (t.cat === 4) { gv++; order.push(t.id); }
      const v = h.vessels(); const unlocked = v.filter((x) => x.isUnlocked).map((x) => x.id);
      assert(same(unlocked, [...Array(gv).keys()]), `${voc} vessels unlock sequentially (seed ${seed})`);
      assert(h.p.getVesselsDamageAndHealingBonus() === gv, `${voc} vessel D&H bonus = filled Gem Vessel slices`);
      const expected = h.corners().reduce((s, c) => s + bonusPerStage[c.level], 0);
      assert(h.p.getGridDamageAndHealingBonus() === expected, `${voc} grid bonus = sum of stage bonuses`);
    });
    results.push(order); h.done();
  }
  return results;
}

function deriveDedication(voc) {
  const h = planner(voc); const perPoint = {}; const totals = {};
  const t0 = h.tiles(); let prev = h.small();
  randomFullFill(h, 7, (t) => {
    const cur = h.small(); const cap = t0[t.id].maxSkillPoints;
    for (const k of Object.keys(cur)) {
      const d = cur[k] - (prev[k] ?? 0);
      if (d) { (totals[k] ??= { delta: 0, pts: 0 }); totals[k].delta += d; }
    }
    const key = t0[t.id].smallPerkId; (perPoint[key] ??= 0); perPoint[key] += cap;
    prev = cur;
  });
  const final = h.small(); h.done();
  return { final, pointsPerSmallPerk: perPoint };
}

function verifyAugmentStacking(voc) {
  const h = planner(voc); const t = h.tiles();
  const augId = t.find((x) => x.cat === 3).mediumPerkId;
  const copies = t.filter((x) => x.mediumPerkId === augId).map((x) => x.id);
  const values = [];
  randomFullFill(h, 3, (x) => {
    if (copies.includes(x.id)) values.push(h.med().find((m) => m.id === augId).value);
  });
  h.done();
  return { augId, copies, summaryValues: values };
}

function supremeCategories(voc, keys) {
  const h = planner(voc); for (const id of [14, 21, 15, 20, 9]) h.fill(id);
  const b1 = arr(h.p.getAvailableBasicModsPos1())[0].id; const b2 = arr(h.p.getAvailableBasicModsPos2())[0].id;
  h.p.onModChange(1, b1, 2); h.p.onModChange(2, b2, 2);
  const out = {};
  for (const k of keys) {
    h.p.onModChange(3, k, 2);
    const s = arr(h.p.getGemsSupremeModSummary()).map((x) => ({ id: x.id, value: x.value, category: x.category.value }));
    const e = s.find((x) => x.id === k);
    out[k] = { category: SUPREME_CAT[e.category], maxGradeValue: e.value, momentumAtMaxGrade: h.p.getVesselsMomentumBonus() };
  }
  h.done();
  return out;
}

// ---------------------------------------------------------------------------
// text helpers
function revelationInfo(largePerkId) {
  const info = STR.LargePerkInfos[largePerkId];
  const generic = info.LongInfoPerLevel[0];
  const groups = [];
  const re = /<font[^>]*>([^<]*)<\/font>\/<font[^>]*>([^<]*)<\/font>\/<font[^>]*>([^<]*)<\/font>/g;
  let m; while ((m = re.exec(generic))) groups.push({ display: [m[1], m[2], m[3]], values: [num(m[1]), num(m[2]), num(m[3])] });
  return {
    largePerkId,
    name: info.Name,
    shortInfo: stripHtml(info.ShortInfo),
    description: stripHtml(generic),
    stageTexts: [1, 2, 3].map((i) => stripHtml(generic.replace(new RegExp(re.source, 'g'), (...g) => g[i]))),
    stageValues: groups,
    spells: REVELATION_SPELLS[info.Name] ?? [],
    affectsSpells: REVELATION_AFFECTS[info.Name] ?? [],
    isAvatar: info.Name.startsWith('Avatar of'),
  };
}

function convictionInfo(tile, revelationName) {
  const info = STR.MediumPerkInfos[tile.mediumPerkId];
  const category = MEDIUM_CAT[tile.cat];
  const n = split(info.Name);
  const base = { id: tile.mediumPerkId, category, value: tile.mediumPerkValue, name: n.full, shortName: n.short, format: info.FormatType };
  if (category === 'augmentation') {
    const subject = n.full.replace(/^Augmented /, '');
    return {
      ...base, value: 0, description: `I: ${info.Aug1Info}\nII: ${info.Aug2Info}`,
      augment: { subject, spells: GROUP_AUGMENTS[subject] ?? [subject], stage1: info.Aug1Info, stage2: info.Aug2Info },
    };
  }
  if (category === 'revelationMastery') {
    return { ...base, name: n.full.replace('<ReplaceMe>', revelationName), shortName: n.short.replace('<ReplaceMe>', revelationName),
      description: stripHtml(info.LongInfo), revelationPoints: tile.mediumPerkValue, displayValue: `+${tile.mediumPerkValue}` };
  }
  let displayValue = '';
  if (info.FormatType === 'PlusPercentWithTwoFloatingpoints') displayValue = `+${(tile.mediumPerkValue / 100).toFixed(2)}%`;
  else if (info.FormatType === 'PlusInteger') displayValue = `+${tile.mediumPerkValue}`;
  else if (info.FormatType === 'PlusFullPercent') displayValue = `+${tile.mediumPerkValue}%`;
  const numericValue = info.FormatType === 'PlusPercentWithTwoFloatingpoints' ? tile.mediumPerkValue / 100 : tile.mediumPerkValue;
  return { ...base, numericValue, displayValue, description: stripHtml(info.LongInfo) };
}

function dedicationInfo(tile) {
  const sp = (id) => STR.SmallPerkInfos[id];
  const perks = [];
  if (tile.smallPerkId === 2) {
    perks.push({ id: 0, name: 'Hit Points', perPoint: tile.smallPerkPrimaryEffectIncrease });
    perks.push({ id: 1, name: 'Mana', perPoint: tile.smallPerkSecondaryEffectIncrease });
  } else if (tile.smallPerkId === 4) {
    // planner stores hundredths of a percent with truncation: floor(points * 7.5) / 100 %
    perks.push({ id: 4, name: split(sp(4).Name).full, perPoint: 0.075, unit: '%' });
  } else {
    perks.push({ id: tile.smallPerkId, name: split(sp(tile.smallPerkId).Name).full, perPoint: tile.smallPerkPrimaryEffectIncrease });
  }
  return {
    smallPerkId: tile.smallPerkId,
    name: SMALL_NAMES[tile.smallPerkId] ?? split(sp(tile.smallPerkId).Name).full,
    primaryIncrease: tile.smallPerkPrimaryEffectIncrease,
    secondaryIncrease: tile.smallPerkHasSecondaryEffect ? tile.smallPerkSecondaryEffectIncrease : null,
    perks,
  };
}

function basicMods(voc, pos1, pos2) {
  const out = [];
  for (const [key, effects] of Object.entries(STR.BasicModConfig)) {
    const id = Number(key);
    if (!Array.isArray(effects) || effects.length === 0) continue;
    const slots = [pos1.includes(id) ? 1 : null, pos2.includes(id) ? 2 : null].filter(Boolean);
    if (!slots.length) continue;
    const eff = effects.map((e) => {
      const info = STR.BasicModEffectInfos[e.EffectId];
      const disp = [0, 1, 2, 3].map((g) => e[voc][g]);
      return { effectId: Number(e.EffectId), name: split(info.Name).full, display: disp, values: disp.map(num) };
    });
    const gradeValues = [0, 1, 2, 3].map((g) => eff.map((e) => `${e.name} ${e.display[g]}`).join(', '));
    out.push({ id, kind: 'basic', name: eff.map((e) => e.name).join(' / '), slots, effects: eff, gradeValues });
  }
  return out;
}

function supremeMods(voc, keys, cats, revelationNames) {
  return keys.map((id) => {
    const info = STR.SupremeModInfos[id];
    const name = split(info.Name || info.NameSummary).full;
    const display = [0, 1, 2, 3].map((g) => info.EffectInfo[g]);
    const isRm = cats[id].category === 'revelationMastery';
    const spell = name.startsWith('Augmented ') ? name.replace(/^Augmented /, '') : null;
    const revelation = isRm ? split(info.NameSummary).full.replace(/^Revelation Mastery /, '') : null;
    if (revelation) assert(revelationNames.includes(revelation), `RM target ${revelation} is a ${voc} revelation`);
    const momentum = display.map((d) => { const m = d.match(/([\d.]+)% Momentum/); return m ? Number(m[1]) : 0; });
    return {
      id, kind: 'supreme', name: isRm ? split(info.NameSummary).full : name,
      category: cats[id].category,
      spell,
      revelation: revelation ?? (spell && revelationNames.includes(spell) ? spell : null),
      gradeValues: display, values: display.map(num),
      momentum: momentum.some(Boolean) ? momentum : undefined,
      maxGradeValue: cats[id].maxGradeValue,
    };
  });
}

function referenceBuilds(voc) {
  const t = TEMPLATES[voc]; if (!t) return { lesserGems: [], greaterGems: [], builds: [] };
  const builds = [];
  for (const b of t.builds) {
    const code = (b.link.match(/code=([-_.~a-zA-Z0-9]+)/) || [])[1];
    const h = planner(voc); const r = h.p.updateByCode(code);
    assert(r >= 0, `decode ${code}`);
    assert(h.p.getVocation().value === M.EActiveVocation[VOC_ENUM[voc]].value, 'build vocation');
    const tiles = Object.fromEntries(h.tiles().filter((x) => x.currentSkillPoints > 0).map((x) => [x.id, x.currentSkillPoints]));
    const vessels = h.vessels().filter((v) => v.keyBasicMod1 >= 0).map((v) => ({ id: v.id, basic1: v.keyBasicMod1, basic2: v.keyBasicMod2 >= 0 ? v.keyBasicMod2 : null, supreme: v.keySupremeMod >= 0 ? v.keySupremeMod : null }));
    builds.push({
      points: b.points, description: b.description, code, legacyCode: r === 0,
      spent: h.p.getSpentSkillPoints(), tiles, vessels,
      revelationStages: h.corners().map((c) => c.level), currentCode: h.p.getCode(),
    });
    h.done();
  }
  return { lesserGems: t.lesser_gems, greaterGems: t.greater_gems, builds };
}

// ---------------------------------------------------------------------------
const findings = {};
const graphs = Object.fromEntries(VOCS.map((v) => [v, deriveUnlockGraph(v)]));
for (const v of VOCS) assert(same(graphs[v], graphs.knight), `unlock graph of ${v} equals knight`);
findings.unlockGraphIdenticalForAllVocations = true;

const rev = Object.fromEntries(VOCS.map((v) => [v, deriveRevelationThresholds(v)]));
for (const v of VOCS) assert(same(rev[v], rev.knight), `revelation thresholds of ${v}`);
assert(same(rev.knight.thresholds, [250, 500, 1000]), 'thresholds 250/500/1000');

const vocations = {};
let vesselDefs = null;
for (const voc of VOCS) {
  const h = planner(voc);
  const tiles = h.tiles(); const corners = h.corners();
  const vesselsRaw = h.vessels();
  const pos1 = arr(h.p.getAvailableBasicModsPos1()).map((m) => m.id);
  const pos2 = arr(h.p.getAvailableBasicModsPos2()).map((m) => m.id);
  const supKeys = arr(h.p.getAvailableSupremeMods());
  h.done();

  const revelations = corners.map((c) => ({ quarter: QUARTERS[c.id], domain: DOMAINS[QUARTERS[c.id]], ...revelationInfo(c.largePerkId) }));
  const revNames = revelations.map((r) => r.name);
  const rmPerTile = tiles.find((t) => t.cat === 5).mediumPerkValue;
  const rm = verifyRevelationMastery(voc, rmPerTile);
  assert(rm.convictionOk, `${voc} RM conviction adds ${rmPerTile} to its quarter`);

  const gemVesselTiles = tiles.filter((t) => t.cat === 4).map((t) => t.id);
  const orders = verifyVesselsAndBonuses(voc, rev.knight.bonusPerStage, [1, 2, 3]);
  const vd = vesselsRaw.map((v) => ({ id: v.id, vesselLevel: v.vesselLevel, quality: QUALITY[v.vesselLevel], unlockOrder: v.id + 1, gemName: STR.VesselInfos.GemNames[v.vesselLevel][voc] }));
  if (!vesselDefs) vesselDefs = vd.map(({ gemName: _g, ...x }) => x);
  assert(same(vesselDefs, vd.map(({ gemName: _g, ...x }) => x)), `${voc} vessel levels equal`);

  const stacking = verifyAugmentStacking(voc);
  assert(same(stacking.summaryValues, [1, 2]), `${voc} augment stacking 1 then 2`);

  const ded = deriveDedication(voc);
  // cross-check per-point increments vs. full-wheel totals
  for (const t of tiles) {
    const d = dedicationInfo(t);
    for (const p of d.perks) assert(p.perPoint > 0, 'positive dedication');
  }
  const expectTotals = {};
  for (const t of tiles) for (const p of dedicationInfo(t).perks) expectTotals[p.id] = (expectTotals[p.id] ?? 0) + (p.id === 4 ? 7.5 : p.perPoint) * t.maxSkillPoints;
  for (const [k, v] of Object.entries(expectTotals)) assert(Math.floor(v) === ded.final[k], `${voc} dedication total ${k}: ${v} vs ${ded.final[k]}`);

  const cats = supremeCategories(voc, supKeys);
  const rmGem = cats[5]?.maxGradeValue;
  assert(rm.gemBonusAtMaxGrade === rmGem, `${voc} RM gem adds ${rmGem}`);

  vocations[voc] = {
    vocation: voc,
    tiles: tiles.map((t) => ({
      gridId: t.id, tileName: tileName(t.id), quarter: QUARTERS[t.q], domain: DOMAINS[QUARTERS[t.q]],
      row: Math.floor(t.id / 6), col: t.id % 6, ring: RING_BY_CAP[t.maxSkillPoints], capacity: t.maxSkillPoints,
      initiallyUnlocked: t.unlocked, isGemVessel: t.cat === 4,
      dedication: dedicationInfo(t),
      conviction: convictionInfo(t, revelations[t.q].name),
    })),
    revelations,
    vessels: vd,
    gemVesselTiles,
    mods: { basic: basicMods(voc, pos1, pos2), supreme: supremeMods(voc, supKeys, cats, revNames) },
    referenceBuilds: referenceBuilds(voc),
    verification: { revelationMasteryGemAtMaxGrade: rm.gemBonusAtMaxGrade, gemVesselFillOrdersTested: orders, augmentStacking: stacking, dedicationTotalsFullWheel: ded.final },
  };
}

const data = {
  meta: {
    source: 'Official Wheel of Destiny planner (test.tibia.com), WASM module run in Node + SkillwheelStringsJsonLibrary.json; reference builds and target counts from tibiapal.com.',
    generatedAt: new Date().toISOString().slice(0, 10),
    totalCapacity: 4000,
    note: 'Facts derived by running the planner; no CipSoft code is included.',
  },
  grid: { rows: 6, cols: 6, quarters: QUARTERS, domains: DOMAINS, ringByCapacity: RING_BY_CAP },
  unlockGraph: { ...graphs.knight, rule: 'A slice can receive points when unlocked; a slice unlocks the listed slices once completely filled. Identical for all vocations.' },
  revelation: {
    thresholds: rev.knight.thresholds,
    damageHealingBonusPerStage: rev.knight.bonusPerStage,
    rule: 'Stage = highest threshold reached by domain points (+ Revelation Mastery). Flat damage & healing bonus = sum over the 4 domains of bonusPerStage[stage].',
    levelNames: STR.LargePerkLevelNames,
  },
  revelationMastery: {
    mediumPerkId: 46,
    pointsPerConvictionSlice: vocations.knight.tiles.find((t) => t.conviction.category === 'revelationMastery').conviction.revelationPoints,
    rule: 'Each filled Revelation Mastery slice adds its points to the revelation of its own domain. Supreme RM mods add their grade value to the named revelation (planner shows grade IV = +225). Both count toward thresholds only, not toward grid capacity.',
  },
  augmentStacking: {
    copiesPerAugment: 2,
    rule: 'Each augmentation conviction exists on two slices. Filling one copy grants stage I, the second copy adds stage II (cumulative), independent of fill order.',
  },
  vessels: {
    list: vesselDefs,
    rule: 'Vessel n (0-based) unlocks when n+1 Gem Vessel slices are completely filled, regardless of which ones. Each filled Gem Vessel slice also gives +1 flat damage & healing.',
    gemQualityMods: { lesser: 1, regular: 2, greater: 3 },
    vesselModsByQuality: 'Lesser vessel activates basic mod 1; regular vessel basic 1+2; greater vessel basic 1+2+supreme.',
    gemNames: STR.VesselInfos.GemNames,
  },
  momentum: {
    perGrade: [0, 0.33, 0.66, 1],
    unit: '%',
    rule: stripHtml(STR.VesselInfos.MomentumTooltip) + ' Applies to supreme cooldown augment mods; additive across gems.',
  },
  dedicationPerks: Object.fromEntries(Object.entries(STR.SmallPerkInfos).filter(([, v]) => typeof v === 'object').map(([k, v]) => [k, { name: SMALL_NAMES[k] ?? split(v.Name).full, format: v.FormatType, info: stripHtml(v.LongInfo) }])),
  texts: {
    conviction: stripHtml(STR.MediumPerkInfos.GeneralInfo),
    augmentation: stripHtml(STR.MediumPerkInfos.AugGeneralInfo),
    revelation: stripHtml(STR.LargePerkInfos.GeneralInfo),
    gems: stripHtml(STR.VesselInfos.GemInfo),
    cooldownLimit: stripHtml(STR.CooldownLimitInfo),
  },
  findings,
  vocations,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
console.log(`wrote ${OUT}`);
for (const v of VOCS) console.log(v, vocations[v].tiles.length, 'tiles,', vocations[v].mods.basic.length, 'basic,', vocations[v].mods.supreme.length, 'supreme,', vocations[v].referenceBuilds.builds.length, 'builds');
