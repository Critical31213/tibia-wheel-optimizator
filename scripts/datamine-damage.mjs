#!/usr/bin/env node
/**
 * Datamines a public damage-calculator API (base URL from the DAMAGE_API env var) into fitted per-spell damage formulas.
 *
 *   npm run datamine:damage              # download (cached) + fit
 *   npm run datamine:damage -- --offline # fit from the on-disk cache only
 *
 * Politeness: sequential requests, >= 2.5 s apart, generic User-Agent, every response
 * cached on disk (scripts/.cache/damage-api/) keyed by a hash of the request, retries
 * with backoff on 5xx/network errors; on HTTP 429 one 65 s back-off, then a hard stop
 * (re-running resumes from the cache). Budget: MAX_REQUESTS network requests per run.
 * See docs/modules/damage-model.md.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEALING, SPELL_META } from './datamine-damage-meta.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.DAMAGE_API ?? '';
const CACHE = join(ROOT, 'scripts/.cache/damage-api');
const OUT_DIR = join(ROOT, 'src/data/damage');
const UA = 'wheel-optimizer-research';
const DELAY_MS = 2500; // the API rate-limits at roughly 25 requests/minute
const MAX_REQUESTS = 400;
const OFFLINE = process.argv.includes('--offline');
const META = ['vocations', 'stances', 'weapons', 'ammo', 'shields', 'perks', 'spells', 'creatures', 'charms'];

let network = 0;
let cached = 0;
let lastAt = 0;
let limited = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(url, init) {
  if (OFFLINE) throw new Error(`offline: ${url} not cached`);
  if (network >= MAX_REQUESTS) throw new Error(`request budget ${MAX_REQUESTS} exhausted`);
  for (let attempt = 0; ; attempt++) {
    const wait = lastAt + DELAY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    network++;
    let res;
    try {
      if (!API) throw new Error("set DAMAGE_API (base URL of the damage API)");
      res = await fetch(url, { ...init, headers: { 'User-Agent': UA, Accept: 'application/json', ...(init?.headers ?? {}) } });
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    if (res.status === 429) {
      if (limited >= 1) throw new Error('HTTP 429 (rate limited) twice - stopping; re-run later to resume from cache.');
      limited++;
      const ra = Number(res.headers.get('retry-after'));
      console.log('  HTTP 429 - backing off');
      await sleep((Number.isFinite(ra) && ra > 0 ? ra : 65) * 1000);
      continue;
    }
    limited = 0;
    if (res.status >= 500 && attempt < 3) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${JSON.stringify(body).slice(0, 300)}`);
    return body;
  }
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v, pretty = false) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, pretty ? 2 : undefined) + '\n');
};

async function meta(name) {
  const p = join(CACHE, 'meta', `${name}.json`);
  if (!existsSync(p)) writeJson(p, await http(`${API}/meta/${name}`));
  return readJson(p).items;
}

const hashOf = (req) => createHash('sha1').update(JSON.stringify(req)).digest('hex').slice(0, 16);

async function damage(req) {
  const p = join(CACHE, 'damage', `${hashOf(req)}.json`);
  if (existsSync(p)) {
    cached++;
    return readJson(p).response;
  }
  const response = await http(`${API}/damage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  writeJson(p, { request: req, response });
  if (network % 25 === 0) console.log(`  ... ${network} network requests`);
  return response;
}

// ---------------------------------------------------------------------------
// Request plan

const LEVELS = [200, 400, 600, 800, 1000, 1250, 1500];
const LEVELS_FACTORIAL = [200, 600, 1000, 1500];
const CURVE_EXTRA_LEVELS = [50, 100, 150, 300, 500, 700, 900, 1100, 1750, 2000];
const CRIT = { critChance: 10, critDamage: 50 }; // community default: Powerful Strike

/** Representative weapons; names resolved against /meta/weapons. Level brackets are typical picks. */
const BRACKET_WEAPONS = {
  knight: { 200: 'Cobra Axe', 400: 'Soulbiter', 600: 'Sanguine Hatchet', 800: 'Grand Sanguine Hatchet', 1000: 'Moonsilver Axe', 1250: 'Stellar Moonsilver Axe', 1500: 'Stellar Moonsilver Axe' },
  paladin: { 200: 'Cobra Crossbow', 400: 'Soulpiercer', 600: 'Sanguine Crossbow', 800: 'Grand Sanguine Crossbow', 1000: 'Moonsilver Crossbow', 1250: 'Stellar Moonsilver Crossbow', 1500: 'Stellar Moonsilver Crossbow' },
  monk: { 200: 'Cobra Bo', 400: 'Soulkamas', 600: 'Sanguine Claws', 800: 'Grand Sanguine Claws', 1000: 'Moonsilver Katar', 1250: 'Stellar Moonsilver Katar', 1500: 'Stellar Moonsilver Katar' },
  sorcerer: { 200: 'Cobra Wand', 400: 'Soultainter', 600: 'Sanguine Coil', 800: 'Grand Sanguine Coil', 1000: 'Moonsilver Channeler', 1250: 'Moonsilver Channeler', 1500: 'Moonsilver Channeler' },
  druid: { 200: 'Cobra Rod', 400: 'Soulhexer', 600: 'Sanguine Rod', 800: 'Grand Sanguine Rod', 1000: 'Moonsilver Sceptre', 1250: 'Moonsilver Sceptre', 1500: 'Moonsilver Sceptre' },
};
const PALADIN_AMMO = 'Spectral Bolt';
const KNIGHT_SHIELD = 'Great Shield';

async function plan() {
  const [weapons, ammo, shields, spells, perks, creatures] = await Promise.all(
    ['weapons', 'ammo', 'shields', 'spells', 'perks', 'creatures'].map(meta),
  );
  for (const m of META) await meta(m);
  const W = (n) => weapons.find((w) => w.name === n) ?? fail(`weapon ${n}`);
  const A = (n) => ammo.find((w) => w.name === n) ?? fail(`ammo ${n}`);
  const S = (n) => shields.find((w) => w.name === n) ?? fail(`shield ${n}`);
  const firstSpell = (voc) => spells.find((s) => s.selectable && s.id !== 1 && s.vocations.includes(voc) && s.spellType === 'spell').id;
  const req = (voc, stats, weapon, extra = {}) => ({
    stats: { vocation: voc, ...stats },
    weapon,
    rotation: extra.rotation ?? [{ id: firstSpell(voc), targets: 1, ratio: 1 }],
    targets: extra.targets ?? [],
    perks: extra.perks ?? [],
  });
  const list = [];
  const add = (tag, r) => list.push({ tag, req: r });

  // --- grid for fits
  const knightW = ['Heroic Axe', 'Cobra Axe', 'Glooth Axe'].map(W);
  const knightGrid = (L, skill, w) => req('knight', { level: L, bonus: 0, ...CRIT, skill }, { id: w.id, shieldId: S(KNIGHT_SHIELD).id });
  for (const L of LEVELS_FACTORIAL) for (const skill of [90, 120, 150]) for (const w of knightW) add('grid', knightGrid(L, skill, w));
  for (const L of LEVELS) if (!LEVELS_FACTORIAL.includes(L)) add('grid', knightGrid(L, 120, knightW[1]));
  for (const L of [400, 1200])
    for (const shielding of [80, 130])
      for (const sh of ['Amazon Shield', 'Soulbastion'])
        add('shield', req('knight', { level: L, bonus: 0, ...CRIT, skill: 120, shielding }, { id: knightW[1].id, shieldId: S(sh).id }));

  const monkW = ['Fists', 'Pair of Iron Fists', 'Crypt Strike'].map(W);
  const monkGrid = (L, skill, w) => req('monk', { level: L, bonus: 0, ...CRIT, skill }, { id: w.id });
  for (const L of LEVELS_FACTORIAL) for (const skill of [90, 120, 150]) for (const w of monkW) add('grid', monkGrid(L, skill, w));
  for (const L of LEVELS) if (!LEVELS_FACTORIAL.includes(L)) add('grid', monkGrid(L, 120, monkW[2]));

  const palCombos = [
    ['Cobra Crossbow', 'Spectral Bolt'],
    ['Sanguine Bow', 'Diamond Arrow'],
    ['Stellar Moonsilver Crossbow', 'Spectral Bolt'],
  ].map(([w, a]) => ({ id: W(w).id, ammoId: A(a).id }));
  const palGrid = (L, skill, magicLevel, w) => req('paladin', { level: L, bonus: 0, ...CRIT, skill, magicLevel }, w);
  for (const L of LEVELS_FACTORIAL)
    for (const skill of [90, 150]) for (const ml of [25, 40]) for (const w of palCombos) add('grid', palGrid(L, skill, ml, w));
  for (const L of LEVELS) if (!LEVELS_FACTORIAL.includes(L)) add('grid', palGrid(L, 120, 30, palCombos[0]));

  for (const voc of ['sorcerer', 'druid']) {
    const w = W(BRACKET_WEAPONS[voc][800]);
    for (const L of LEVELS) for (const ml of [60, 100, 150]) add('grid', req(voc, { level: L, bonus: 0, ...CRIT, magicLevel: ml }, { id: w.id }));
  }

  // --- probes at a reference character (level 800)
  const ref = {
    knight: () => knightGrid(800, 120, knightW[1]),
    monk: () => monkGrid(800, 120, monkW[2]),
    paladin: () => palGrid(800, 120, 30, palCombos[0]),
    sorcerer: () => req('sorcerer', { level: 800, bonus: 0, ...CRIT, magicLevel: 120 }, { id: W(BRACKET_WEAPONS.sorcerer[800]).id }),
    druid: () => req('druid', { level: 800, bonus: 0, ...CRIT, magicLevel: 120 }, { id: W(BRACKET_WEAPONS.druid[800]).id }),
  };
  const withStats = (r, s) => ({ ...r, stats: { ...r.stats, ...s } });
  const withPerks = (r, p) => ({ ...r, perks: p });
  for (const [voc, mk] of Object.entries(ref)) {
    add(`ref:${voc}`, mk());
    for (const bonus of [15, 40]) add(`bonus:${voc}:${bonus}`, withStats(mk(), { bonus }));
    add(`crit:${voc}:0/0`, withStats(mk(), { critChance: 0, critDamage: 0 }));
  }
  add('crit:sorcerer:20/50', withStats(ref.sorcerer(), { critChance: 20 }));
  add('crit:sorcerer:10/100', withStats(ref.sorcerer(), { critDamage: 100 }));
  const P = (name) => perks.find((p) => p.name.trim() === name)?.id ?? fail(`perk ${name}`);
  const perkProbes = {
    knight: ['Fierce Berserk', "Executioner's Throw", 'Shield Slam'],
    paladin: ['Divine Barrage', 'Divine Grenade', 'Ethereal Barrage'],
    sorcerer: ['Great Fire Wave', 'Great Death Beam', 'Death Echo'],
    druid: ['Terra Wave', 'Ice Burst', 'Forked Glacier'],
    monk: ['Chained Penance', 'Spiritual Outburst', 'Thousand Fist Blows'],
  };
  for (const [voc, names] of Object.entries(perkProbes)) {
    add(`perk:${voc}:base10`, withPerks(ref[voc](), names.map((n) => ({ id: P(`${n} base damage`), value: 10 }))));
    add(`perk:${voc}:critdmg20`, withPerks(ref[voc](), names.map((n) => ({ id: P(`${n} critical hit damage`), value: 20 }))));
    add(`perk:${voc}:critchance10`, withPerks(ref[voc](), names.map((n) => ({ id: P(`${n} critical hit chance`), value: 10 }))));
    add(`perk:${voc}:char-critdmg3`, withPerks(ref[voc](), [{ id: P('Critical hit extra damage'), value: 3 }]));
  }
  add('perk:sorcerer:base10+bonus40', withStats(withPerks(ref.sorcerer(), [{ id: P('Great Fire Wave base damage'), value: 10 }]), { bonus: 40 }));
  for (const stage of [1, 2, 3]) {
    add(`rev:knight:combat-mastery:${stage}`, withPerks(ref.knight(), [{ id: P('Combat Mastery'), value: stage }]));
    add(`rev:monk:ascetic:${stage}`, withPerks(ref.monk(), [{ id: P('Ascetic'), value: stage }]));
    add(`rev:sorcerer:lord-of-destruction:${stage}`, withPerks(withStats(ref.sorcerer(), { stanceIds: [5] }), [{ id: P('Lord of Destruction'), value: stage }]));
  }
  add('stance:sorcerer:master-of-flames', withStats(ref.sorcerer(), { stanceIds: [5] }));

  // creatures: element modifiers, armor, mitigation
  const C = (n) => creatures.find((c) => c.name === n) ?? fail(`creature ${n}`);
  const probeCreatures = ['Abyssal Calamary', 'Demon', 'Dragon Lord', 'Juggernaut', 'Grim Reaper'].filter((n) => creatures.some((c) => c.name === n));
  for (const voc of ['sorcerer', 'knight', 'paladin', 'monk', 'druid'])
    for (const n of voc === 'sorcerer' ? probeCreatures : probeCreatures.slice(1, 3)) add(`creature:${voc}:${n}`, { ...ref[voc](), targets: [{ id: C(n).id, ratio: 1 }] });
  add('creature:sorcerer:mix', { ...ref.sorcerer(), targets: probeCreatures.slice(0, 2).map((n, i) => ({ id: C(n).id, ratio: i + 1 })) });

  // level curve: the level term is a shared concave function, tabulated at extra levels
  for (const L of CURVE_EXTRA_LEVELS)
    add('levelcurve', req('sorcerer', { level: L, bonus: 0, ...CRIT, magicLevel: 100 }, { id: W(BRACKET_WEAPONS.sorcerer[800]).id }));

  // rotation/targets: summary scaling
  const gfw = spells.find((s) => s.name === 'Great Fire Wave').id;
  for (const t of [1, 5]) add(`rotation:sorcerer:gfw-targets-${t}`, { ...ref.sorcerer(), rotation: [{ id: gfw, targets: t, ratio: 1 }] });

  // representative bracket weapons (defaults for the loader)
  for (const voc of ['knight', 'paladin', 'monk'])
    for (const L of LEVELS) {
      const w = W(BRACKET_WEAPONS[voc][L]);
      const weapon = { id: w.id, ...(voc === 'paladin' ? { ammoId: A(PALADIN_AMMO).id } : {}), ...(voc === 'knight' ? { shieldId: S(KNIGHT_SHIELD).id } : {}) };
      add(`bracket:${voc}:${L}`, req(voc, { level: L, bonus: 0, ...CRIT, skill: 120, ...(voc === 'paladin' ? { magicLevel: 30 } : {}) }, weapon));
    }
  return { list, meta: { weapons, ammo, shields, spells, perks, creatures } };
}

function fail(what) {
  throw new Error(`not found: ${what}`);
}

// ---------------------------------------------------------------------------
// Fitting

function lstsq(X, y) {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let r = 0; r < X.length; r++)
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) A[i][j] += X[r][i] * X[r][j];
      A[i][k] += X[r][i] * y[r];
    }
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    if (Math.abs(A[c][c]) < 1e-12) return null;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j];
    }
  }
  return A.map((row, i) => row[k] / row[i]);
}

/**
 * Shared level term (found empirically, exact on the API): slope 1/5 up to level 500, then each further
 * segment adds 100 with slope 1/k over 100k levels (1/6 to 1100, 1/7 to 1800, 1/8 to 2600, ...).
 */
export function levelTerm(level) {
  let g = 0;
  let from = 0;
  for (let k = 5; ; k++) {
    const to = k === 5 ? 500 : from + 100 * k;
    if (level <= to) return g + (level - from) / k;
    g += (to - from) / k;
    from = to;
  }
}

const MODELS = {
  // avg = c0 + cL*g(level) + cM*magicLevel
  magic: { terms: ['const', 'levelTerm', 'magicLevel'], x: (s) => [1, levelTerm(s.level), s.magicLevel] },
  // avg = c0 + cL*g(level) + cS*skill + cA*attack + cSA*skill*attack [+ cLSA*g(level)*skill*attack]
  weapon: {
    terms: ['const', 'levelTerm', 'skill', 'attack', 'skillAttack', 'levelSkillAttack'],
    x: (s) => [1, levelTerm(s.level), s.skill, s.attack, s.skill * s.attack, (levelTerm(s.level) * s.skill * s.attack) / 1000],
  },
  // avg = c0 + cL*g(level) + cH*shielding + cD*shieldDefense + cHD*shielding*shieldDefense
  shield: {
    terms: ['const', 'levelTerm', 'shielding', 'shieldDefense', 'shieldingDefense'],
    x: (s) => [1, levelTerm(s.level), s.shielding, s.shieldDefense, s.shielding * s.shieldDefense],
  },
  // Paladin Ethereal spells: weapon and ammunition attack do not change the damage (fitted coefficients ≈ 0).
  distance: {
    terms: ['const', 'levelTerm', 'skill'],
    x: (s) => [1, levelTerm(s.level), s.skill],
  },
};

const round = (v, d = 6) => (Math.abs(v) < 1e-9 ? 0 : Number(v.toFixed(d)));

function fitSpell(samples, modelName, field) {
  const basic = fitSpellWith(samples, modelName, field, ['levelSkillAttack']);
  if (modelName !== 'weapon' || !basic || basic.maxAbsErr <= 3) return basic;
  const ext = fitSpellWith(samples, modelName, field, []);
  return ext && ext.maxAbsErr < basic.maxAbsErr / 2 ? ext : basic;
}

function fitSpellWith(samples, modelName, field, excluded) {
  const pts = samples.filter((s) => typeof s[field] === 'number');
  if (pts.length < 4) return null;
  const m = MODELS[modelName];
  const X = pts.map((s) => m.x(s));
  const y = pts.map((s) => s[field]);
  // drop terms with no variation (e.g. attack for monks on a single weapon) and excluded terms
  const active = m.terms.map((t, i) => !excluded.includes(t) && (i === 0 || new Set(X.map((r) => r[i])).size > 1));
  const idx = active.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
  const beta = lstsq(X.map((r) => idx.map((i) => r[i])), y);
  if (!beta) return null;
  const coef = Object.fromEntries(m.terms.filter((t) => !excluded.includes(t)).map((t) => [t, 0]));
  idx.forEach((i, j) => (coef[m.terms[i]] = round(beta[j])));
  let maxAbs = 0;
  let maxRel = 0;
  let sq = 0;
  pts.forEach((s, r) => {
    const pred = m.terms.reduce((acc, t, i) => acc + (coef[t] ?? 0) * X[r][i], 0);
    const e = pred - y[r];
    maxAbs = Math.max(maxAbs, Math.abs(e));
    if (y[r] > 0) maxRel = Math.max(maxRel, Math.abs(e) / y[r]);
    sq += e * e;
  });
  return { coef, n: pts.length, maxAbsErr: round(maxAbs, 3), rmse: round(Math.sqrt(sq / pts.length), 3), maxRelErr: round(maxRel, 5) };
}

function modelFor(spell) {
  if (spell.scalesWith === 'shielding') return 'shield';
  if (spell.scalesWith === 'distance') return 'distance';
  if (spell.scalesWith === 'melee') return 'weapon';
  return 'magic';
}

// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(join(CACHE, 'damage'), { recursive: true });
  const { list, meta: M } = await plan();
  console.log(`plan: ${list.length} /damage requests`);
  const results = [];
  for (const item of list) results.push({ ...item, res: await damage(item.req) });
  console.log(`requests: ${network} network, ${cached} from cache`);

  const weaponById = new Map(M.weapons.map((w) => [w.id, w]));
  const ammoById = new Map(M.ammo.map((a) => [a.id, a]));
  const shieldById = new Map(M.shields.map((a) => [a.id, a]));
  const spellById = new Map(M.spells.map((s) => [s.id, s]));
  const statsOf = (req) => {
    const w = weaponById.get(req.weapon.id);
    const attack = (w?.attack ?? 0) + (req.weapon.ammoId ? (ammoById.get(req.weapon.ammoId)?.attack ?? 0) : 0);
    return {
      level: req.stats.level,
      skill: req.stats.skill ?? 0,
      magicLevel: req.stats.magicLevel ?? 0,
      attack,
      shielding: req.stats.shielding ?? 0,
      shieldDefense: req.weapon.shieldId ? (shieldById.get(req.weapon.shieldId)?.defense ?? 0) : 0,
    };
  };

  // samples per (vocation, spell id)
  const samples = new Map();
  for (const r of results.filter((x) => x.tag === 'grid' || x.tag === 'shield' || x.tag === 'levelcurve' || x.tag.startsWith('bracket:') || x.tag.startsWith('ref:'))) {
    const voc = r.req.stats.vocation;
    const st = statsOf(r.req);
    for (const sp of r.res.spells ?? []) {
      const key = `${voc}:${sp.id}`;
      if (!samples.has(key)) samples.set(key, []);
      samples.get(key).push({ ...st, min: sp.raw?.min, avg: sp.raw?.avg, max: sp.raw?.max, eff: sp.effective?.avg });
    }
  }

  const formulas = [];
  for (const [key, pts] of samples) {
    const [voc, idStr] = key.split(':');
    const spell = spellById.get(Number(idStr));
    if (!spell || spell.id === 1 || spell.spellType === 'homing-missile') continue;
    const model = modelFor(spell);
    const usable = pts;
    const avg = fitSpell(usable, model, 'avg');
    if (!avg) continue;
    const min = fitSpell(usable, model, 'min');
    const max = fitSpell(usable, model, 'max');
    formulas.push({
      vocation: voc,
      apiId: spell.id,
      apiName: spell.name,
      scope: spell.scope,
      spellType: spell.spellType,
      apiElement: spell.element,
      scalesWith: spell.scalesWith,
      stage: spell.stage ?? null,
      variant: spell.targetsLabel ?? null,
      isExtra: spell.isExtra,
      bundledSpellIds: spell.bundledSpellIds,
      apiTurnCooldown: spell.turnCooldown,
      model,
      avg: avg.coef,
      min: min?.coef ?? null,
      max: max?.coef ?? null,
      fit: { n: avg.n, maxAbsErr: avg.maxAbsErr, rmse: avg.rmse, maxRelErr: avg.maxRelErr },
    });
  }
  formulas.sort((a, b) => a.vocation.localeCompare(b.vocation) || a.apiId - b.apiId);

  // probes summary (raw numbers, interpreted in docs)
  const byTag = Object.fromEntries(results.map((r) => [r.tag, r]));
  const pick = (tag, names) => {
    const r = byTag[tag];
    if (!r) return null;
    const o = {};
    for (const sp of r.res.spells ?? []) if (!names || names.some((n) => sp.name.startsWith(n))) o[sp.name] = { raw: sp.raw?.avg ?? null, eff: sp.effective?.avg ?? null };
    return { summary: r.res.summary, spells: o };
  };
  const probes = {};
  for (const r of results) if (!['grid', 'shield'].includes(r.tag) && !r.tag.startsWith('bracket:')) probes[r.tag] = pick(r.tag);

  const brackets = {};
  for (const r of results.filter((x) => x.tag.startsWith('bracket:'))) {
    const [, voc, L] = r.tag.split(':');
    const w = weaponById.get(r.req.weapon.id);
    (brackets[voc] ??= {})[L] = {
      weapon: w.name,
      weaponId: w.id,
      attack: statsOf(r.req).attack,
      ammo: r.req.weapon.ammoId ? ammoById.get(r.req.weapon.ammoId).name : undefined,
      shield: r.req.weapon.shieldId ? shieldById.get(r.req.weapon.shieldId).name : undefined,
    };
  }
  for (const voc of ['sorcerer', 'druid'])
    brackets[voc] = Object.fromEntries(LEVELS.map((L) => [L, { weapon: BRACKET_WEAPONS[voc][L], weaponId: M.weapons.find((w) => w.name === BRACKET_WEAPONS[voc][L])?.id, attack: 0 }]));

  writeJson(join(CACHE, 'probes.json'), probes, true);
  writeJson(join(CACHE, 'formulas-raw.json'), { formulas, brackets }, true);

  // Small offline fixture: the reference character per vocation (raw avg per spell).
  const fixtures = Object.keys(ref0()).map((voc) => {
    const r = byTag[`ref:${voc}`];
    return {
      vocation: voc,
      stats: statsOf(r.req),
      request: r.req,
      raw: Object.fromEntries((r.res.spells ?? []).filter((s) => s.id !== 1 && typeof s.raw?.avg === 'number').map((s) => [s.id, s.raw.avg])),
    };
  });
  // plus one extreme grid point per vocation (level 1500)
  for (const voc of ['knight', 'paladin', 'sorcerer', 'druid', 'monk']) {
    const r = results.find((x) => x.tag === 'grid' && x.req.stats.vocation === voc && x.req.stats.level === 1500);
    fixtures.push({
      vocation: voc,
      stats: statsOf(r.req),
      request: r.req,
      raw: Object.fromEntries((r.res.spells ?? []).filter((s) => s.id !== 1 && typeof s.raw?.avg === 'number').map((s) => [s.id, s.raw.avg])),
    });
  }
  writeJson(join(OUT_DIR, '__fixtures__/api-samples.json'), fixtures);
  writeJson(join(OUT_DIR, 'spell-formulas.json'), compose(formulas, brackets, probes, M, results.length), true);

  const worst = [...formulas].sort((a, b) => b.fit.maxRelErr - a.fit.maxRelErr).slice(0, 8);
  console.log(`fitted ${formulas.length} spell variants; worst rel. errors:`);
  for (const f of worst) console.log(`  ${f.vocation} ${f.apiName}: maxAbs ${f.fit.maxAbsErr}, maxRel ${(f.fit.maxRelErr * 100).toFixed(2)}%`);
  console.log(`wrote ${join(CACHE, 'formulas-raw.json')} `);
}

const ref0 = () => ({ knight: 1, paladin: 1, sorcerer: 1, druid: 1, monk: 1 });

main().catch((e) => {
  console.error(e.message);
  console.error(`requests: ${network} network, ${cached} from cache`);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Composition of the committed dataset

const VOCS = ['knight', 'paladin', 'sorcerer', 'druid', 'monk'];

/** "Executioner's Throw (Stage 1)" -> { base, label, stage } */
function splitName(name) {
  const m = name.match(/^(.*?) \((.*)\)$/);
  if (!m) return { base: name, label: null };
  return { base: m[1], label: m[2] };
}

function partOf(f) {
  const label = splitName(f.apiName).label ?? '';
  if (/sides|repeat/i.test(label) || (f.isExtra && /stage/i.test(label))) return 'extra';
  return 'main';
}

const round05 = (v) => Math.round(v * 20) / 20;
/** Multiplier of the flat wheel bonus for a variant, measured by the bonus:<voc>:40 probe. */
function bonusFactorOf(f, probes) {
  const a = probes[`bonus:${f.vocation}:40`]?.spells[f.apiName]?.raw;
  const b = probes[`ref:${f.vocation}`]?.spells[f.apiName]?.raw;
  return typeof a === 'number' && typeof b === 'number' ? round05((a - b) / 40) : round05(f.avg.levelTerm ?? 1);
}

/** Probe-derived rules (see docs/modules/damage-model.md). */
const RULES = {
  flatBonus: 'raw += bonus * variant.bonusFactor (per hit, per target, before crit); bonusFactor equals the variant level multiplier',
  baseDamagePct: 'raw = levelPart + (raw - levelPart) * (1 + pct/100), levelPart = bonusFactor * g(L) (the level term is not boosted); probes: ratio 0.100 +- 0.003',
  crit: 'effective = raw * (1 + chance * extra); spell crit perks and the character "Critical hit extra damage" perk add to chance/extra',
  creatures: 'effective *= damageMods[element] * (1 - creature.mitigation/100); physical additionally reduced by armor (~7 % for Demon)',
  revelations: {
    'Combat Mastery': { scope: 'knight spells', effectiveMultiplierByStage: [1.0308, 1.0368, 1.045], note: 'raw unchanged (crit-side effect)' },
    Ascetic: { scope: 'harmony monk spells', rawMultiplierByStage: [1.0478, 1.0957, 1.1446], note: 'at 5 harmony assumed by the API' },
    'Lord of Destruction': { scope: 'fire spells, Master of Flames stance', rawMultiplierByStage: [1.0148, 1.0222, 1.0296] },
    'Master of Flames stance': { scope: 'fire spells', rawMultiplier: 1.0305 },
  },
  targets: 'API summary per turn = per-hit effective * targets of the rotation entry',
};

function compose(formulas, brackets, probes, M, total) {
  const hits = readJson(join(ROOT, 'scripts/.cache/hunt-data/spellAverageHitsData.json'));
  const rotations = readJson(join(ROOT, 'scripts/.cache/hunt-data/rotationPresetsData.json'));
  const perkByScope = {};
  for (const p of M.perks) {
    if (!p.appliesToSpell) continue;
    const key = { 'base-damage': 'baseDamage', 'crit-damage': 'critDamage', 'crit-chance': 'critChance' }[p.bonusType];
    if (key) (perkByScope[p.scopes[0]] ??= {})[key] = p.id;
  }
  const bySpell = new Map();
  // Prefer the fit from the vocation whose grid varies the relevant stat (runes/strikes: sorcerer).
  const prefer = (f) => (f.scalesWith === 'magic' ? ['sorcerer', 'druid', 'paladin', 'monk', 'knight'] : VOCS).indexOf(f.vocation);
  for (const f of [...formulas].sort((a, b) => prefer(a) - prefer(b))) {
    const api = M.spells.find((s) => s.id === f.apiId);
    if (f.model === 'magic' && !f.avg.magicLevel) continue; // no mlvl variation in that grid
    const { base, label } = splitName(f.apiName);
    const name = base.replace(/ Rune$/, '');
    const meta = SPELL_META[base] ?? SPELL_META[name] ?? fail(`SPELL_META for ${base}`);
    let e = bySpell.get(name);
    if (!e) {
      const hitKey = name;
      const area = meta.area;
      e = {
        name,
        apiName: base,
        vocations: api.vocations,
        kind: 'damage',
        spellType: api.spellType,
        element: api.element === 'weapon' ? 'physical' : api.element,
        weaponElement: api.element === 'weapon',
        scalesWith: api.scalesWith,
        model: f.model,
        area,
        singleTarget: area === 'single',
        cooldownSeconds: meta.cd,
        ...(meta.approx ? { cooldownApprox: true } : {}),
        avgTargetsHunt: area === 'single' ? 1 : (hits.spells[hitKey] ?? hits.runes[hitKey] ?? null),
        ...(hits.spells[`${hitKey} (Outer)`] ? { avgTargetsHuntOuter: hits.spells[`${hitKey} (Outer)`] } : {}),
        perkIds: perkByScope[api.scope] ?? null,
        variants: [],
      };
      bySpell.set(name, e);
    }
    if (e.variants.some((v) => v.apiId === f.apiId)) continue;
    e.variants.push({
      apiId: f.apiId,
      label,
      part: partOf(f),
      stage: f.stage ?? null,
      bonusFactor: bonusFactorOf(f, probes),
      avg: f.avg,
      min: f.min,
      max: f.max,
      fit: f.fit,
    });
  }
  const spells = [...bySpell.values()].sort((a, b) => VOCS.indexOf(a.vocations[0]) - VOCS.indexOf(b.vocations[0]) || a.name.localeCompare(b.name));
  for (const s of spells) s.variants.sort((a, b) => (a.part === b.part ? (a.stage ?? 0) - (b.stage ?? 0) : a.part === 'main' ? -1 : 1));

  const healing = HEALING.map((h) => ({
    name: h.name,
    vocations: h.vocations,
    kind: 'healing',
    area: h.area,
    singleTarget: h.area === 'single',
    cooldownSeconds: h.cd,
    model: 'magic',
    min: { const: h.min[2], level: h.min[0], magicLevel: h.min[1] },
    max: { const: h.max[2], level: h.max[0], magicLevel: h.max[1] },
    avg: { const: (h.min[2] + h.max[2]) / 2, level: (h.min[0] + h.max[0]) / 2, magicLevel: (h.min[1] + h.max[1]) / 2 },
    note: ['linear level (not levelTerm)', h.note].filter(Boolean).join('; '),
    source: 'community healing formulas (approximate)',
  }));

  const perks = {};
  for (const p of M.perks.filter((x) => !x.appliesToSpell && ['crit-damage', 'crit-chance', 'magic-level', 'base-harmony-bonus', 'combat-mastery', 'lord-of-destruction'].includes(x.bonusType)))
    perks[p.name.trim()] = { id: p.id, bonusType: p.bonusType, scopes: p.scopes, valueType: p.valueType };

  return {
    meta: {
      source: 'public damage-calculator API',
      generatedBy: 'npm run datamine:damage (scripts/datamine-damage.mjs)',
      requests: { damageRequests: total, metaRequests: META.length, note: 'one /damage response covers every spell of the vocation' },
      note: 'avg/min/max = raw damage per hit per target before crit, creature resistances and mitigation.',
      levelTerm: 'g(L) = L/5 to 500, then +1 per 6 levels to 1100, per 7 to 1800, per 8 to 2600, per 9 above',
      models: {
        magic: 'const + levelTerm*g(L) + magicLevel*M',
        weapon: 'const + levelTerm*g(L) + skill*S + attack*A + skill*attack*SA [+ levelSkillAttack*g(L)*S*A/1000] (attack = weapon + ammo)',
        shield: 'const + levelTerm*g(L) + shielding*H + shieldDefense*D + shielding*shieldDefense*HD',
      },
    },
    rules: RULES,
    critDefaults: { critChance: 10, critDamage: 50, note: 'community default: Powerful Strike imbuement; expected multiplier 1 + chance*extra' },
    weaponBrackets: brackets,
    spells,
    healing,
    characterPerks: perks,
    rotationPresets: rotations,
  };
}
