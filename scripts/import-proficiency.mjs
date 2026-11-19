/**
 * Offline import of weapon proficiency data (D45).
 *
 * Usage: npm run import:proficiency [-- --refresh]
 *
 * Sources (cached in scripts/.cache/proficiency/, see THIRD_PARTY_NOTICES.md):
 *   - TibiaPal (MIT): weapon proficiency trees and perk shaping options (the latter compiled from tibiawiki.com.br).
 *   - tibiopedia.pl: weapon stats (attack + element, defence, class, imbuement slots, specials, level, vocation).
 *
 * Perks are read from TibiaPal's structured fields (Type, Value, SkillId, SpellId, ...), which come from the game
 * client. The English descriptions were scraped from wikis earlier and are partly stale (rebalanced lines) or belong
 * to other weapons; they are only cross-checked and disagreements are listed in `meta.issues`.
 *
 * Perk icons (CipSoft graphics, as mirrored in the TibiaPal repository) are downloaded, deduplicated by content and
 * written to public/proficiency/; `icons` in the JSON maps a perk icon key (see `iconKeys`) to a file.
 *
 * Output: src/data/proficiency/proficiency.json. Problems are printed and listed in `meta.issues`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', '.cache', 'proficiency');
const OUT = join(ROOT, 'src', 'data', 'proficiency', 'proficiency.json');
const PAL = 'https://raw.githubusercontent.com/PawelKusnierek/TibiaPal/HEAD/_site/data/proficiency/';
const ICONS = join(ROOT, 'public', 'proficiency');
const PAL_REPO = 'https://raw.githubusercontent.com/PawelKusnierek/TibiaPal/HEAD/';
const WEAPONS_URL = 'https://tibiopedia.pl/items/weapons';
const UA = 'wheel-optimizer-research';
const refresh = process.argv.includes('--refresh');

async function cached(name, url, headers = {}) {
  const file = join(CACHE, name);
  if (!refresh && existsSync(file)) return readFileSync(file, 'utf8');
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.text();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, text);
  return text;
}

async function cachedBinary(path) {
  const file = join(CACHE, 'img', path.replace(/\//g, '__'));
  if (!existsSync(file)) {
    const res = await fetch(PAL_REPO + path, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return readFileSync(file);
}

/** Icon keys of a perk: [base] or, for spell augments, [spell, augment overlay]. Mirrors src/data/proficiency. */
const iconKeys = (p) =>
  p.kind === 'augment' ? [`spell:${p.spell}`, `aug:${p.augment}`] : [[p.kind, p.skill, p.element, p.bestiary].filter(Boolean).join(':')];

/** key → { "path#frame/frames": votes }; the most common image wins (the wiki crops are a little noisy). */
const iconVotes = new Map();
function voteIcon(key, ref) {
  if (!iconVotes.has(key)) iconVotes.set(key, new Map());
  const v = iconVotes.get(key);
  v.set(ref, (v.get(ref) ?? 0) + 1);
}

const issues = [];
const issue = (msg) => issues.push(msg);
const norm = (s) => s.toLowerCase().replace(/[’'`]/g, "'").replace(/\s+/g, ' ').trim();
const slug = (s) => norm(s).replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------------------------------------------------------------------------
// Perks
// ---------------------------------------------------------------------------

const SKILLS = { 1: 'magic', 6: 'shielding', 7: 'distance', 8: 'sword', 9: 'club', 10: 'axe', 11: 'fist', 13: 'fishing' };
/** ElementId follows the descriptions (TibiaPal's `element` field swaps fire and energy). */
const ELEMENTS = { 1: 'physical', 8: 'fire', 16: 'earth', 32: 'energy', 64: 'ice', 128: 'holy', 256: 'death', 1048576: 'healing' };
const AUGMENTS = { 2: 'baseDamage', 3: 'healing', 6: 'cooldown', 14: 'lifeLeech', 15: 'manaLeech', 16: 'critDamage', 17: 'critChance' };
const BESTIARY = [
  'Amphibic', 'Aquatic', 'Bird', 'Construct', 'Demon', 'Dragon', 'Elemental', 'Fey', 'Giant', 'Human', 'Humanoid',
  'Lycanthrope', 'Magical', 'Mammal', 'Plant', 'Reptile', 'Slime', 'Undead', 'Vermin', 'Extra Dimensional', 'Inkborn',
];
/**
 * Perk kinds by TibiaPal `Type`. Units: `pct` values are fractions (0.04 = 4 %), `flat` values are points,
 * cooldown is seconds (negative).
 */
const KINDS = {
  0: 'attack', 1: 'defence', 2: 'defenceMod', 3: 'skill', 4: 'magicLevel', 5: 'augment', 6: 'bestiary', 7: 'boss',
  8: 'critChance', 9: 'elementCritChance', 10: 'runeCritChance', 11: 'autoCritChance', 12: 'critDamage',
  13: 'elementCritDamage', 14: 'runeCritDamage', 15: 'autoCritDamage', 16: 'manaLeech', 17: 'lifeLeech',
  18: 'manaOnHit', 19: 'lifeOnHit', 20: 'manaOnKill', 21: 'lifeOnKill', 22: 'rangeDamage', 23: 'hitChance',
  24: 'range', 25: 'autoSkillScaling', 26: 'spellSkillScaling', 27: 'healSkillScaling', 28: 'alphaStrike',
  29: 'omegaStrike', 30: 'armorPenetration', 31: 'pierce', 32: 'homingMissile',
};
const PCT = new Set([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 23, 25, 26, 27, 28, 29, 30, 31]);

/** Client spell ids (TibiaPal proficiency-calculator/app.js, MIT). */
const SPELL_IDS = {
  1: 'Light Healing', 2: 'Intense Healing', 13: 'Energy Wave', 19: 'Fire Wave', 21: 'Sudden Death', 22: 'Energy Beam',
  23: 'Great Energy Beam', 24: "Hell's Core", 43: 'Strong Ice Wave', 56: 'Wrath of Nature', 57: 'Strong Ethereal Spear',
  59: 'Front Sweep', 61: 'Brutal Strike', 62: 'Annihilation', 80: 'Berserk', 84: 'Heal Friend', 87: 'Death Strike',
  88: 'Energy Strike', 89: 'Flame Strike', 105: 'Fierce Berserk', 106: 'Groundshaker', 107: 'Whirlwind Throw',
  112: 'Ice Strike', 113: 'Terra Strike', 118: 'Eternal Winter', 119: 'Rage of the Skies', 120: 'Terra Wave',
  121: 'Ice Wave', 122: 'Divine Missile', 123: 'Wound Cleansing', 124: 'Divine Caldera', 125: 'Divine Healing',
  141: 'Inflict Wound', 148: 'Physical Strike', 150: 'Strong Flame Strike', 153: 'Strong Terra Strike',
  154: 'Ultimate Flame Strike', 155: 'Ultimate Energy Strike', 156: 'Ultimate Ice Strike', 157: 'Ultimate Terra Strike',
  158: 'Intense Wound Cleansing', 169: "Apprentice's Strike", 173: 'Chill Out', 177: 'Buzz', 178: 'Scorch',
  238: 'Divine Dazzle', 240: 'Great Fire Wave', 258: 'Divine Grenade', 260: 'Great Death Beam', 261: "Executioner's Throw",
  263: 'Ice Burst', 264: 'Avatar of Steel', 265: 'Avatar of Light', 266: 'Avatar of Storm', 267: 'Avatar of Nature',
  268: 'Divine Empowerment', 270: 'Lesser Ethereal Spear', 271: 'Lesser Front Sweep', 283: 'Avatar of Balance',
  287: 'Flurry of Blows', 288: 'Chained Penance', 289: 'Greater Flurry of Blows', 290: 'Mystic Repulse',
  292: 'Greater Tiger Clash', 293: 'Devastating Knockout', 294: 'Sweeping Takedown', 301: 'Thousand Fist Blows',
  302: 'Divine Barrage', 303: 'Ethereal Barrage', 310: 'Death Echo', 316: 'Shield Slam', 318: 'Forked Thorns',
};

/** Spell names, checked against the descriptions (only disagreements are reported). */
function spellNames(perks) {
  const names = new Map(Object.entries(SPELL_IDS).map(([id, n]) => [Number(id), n]));
  const wrong = new Set();
  for (const p of perks) {
    if (p.Type !== 5 || !p.sourceDescription) continue;
    const said = p.sourceDescription.replace(/^.* for /, '').replace(/’/g, "'");
    const known = names.get(p.SpellId);
    if (!known) names.set(p.SpellId, said);
    else if (known !== said && !known.startsWith(said) && !said.startsWith(known)) wrong.add(`SpellId ${p.SpellId}: "${known}" (described as "${said}")`);
  }
  wrong.forEach(issue);
  return names;
}

function toPerk(p, spells, where) {
  const kind = KINDS[p.Type];
  if (!kind) {
    issue(`${where}: skipped Type ${p.Type} "${p.sourceDescription ?? ''}"`);
    return null;
  }
  const perk = { kind, value: p.Value };
  if (p.Type === 3 || p.Type === 25 || p.Type === 26 || p.Type === 27) perk.skill = SKILLS[p.SkillId];
  if (p.Type === 4) perk.element = ELEMENTS[p.DamageType];
  if (p.Type === 9 || p.Type === 13 || p.Type === 31 || p.Type === 32) perk.element = ELEMENTS[p.ElementId];
  if (p.Type === 6) perk.bestiary = BESTIARY[p.BestiaryId - 1];
  if (p.Type === 5) {
    perk.spell = spells.get(p.SpellId);
    perk.augment = AUGMENTS[p.AugmentType];
  }
  if (p.Type === 22) perk.range = p.Range;
  if (p.Type === 32) {
    perk.value = p.Probability;
    perk.levelMultiplier = p.Multiplier;
  }
  for (const [k, v] of Object.entries(perk)) {
    if (v === undefined || (typeof v === 'number' && !Number.isFinite(v))) {
      issue(`${where}: ${kind} without ${k} ${JSON.stringify({ ...p, sprite: undefined })}`);
      return null;
    }
  }
  // Cross-check the client value against the (older) description.
  const d = p.sourceDescription;
  if (d && p.Type !== 32 && !(p.Type === 5 && p.AugmentType === 6)) {
    const n = Number(/[\d.]+/.exec(d)?.[0]);
    const expect = PCT.has(p.Type) ? Math.round(p.Value * 10000) / 100 : p.Value;
    if (Math.abs(n - expect) > 1e-6) issue(`${where}: ${kind} ${expect} (description: "${d}")`);
  }
  return perk;
}

// ---------------------------------------------------------------------------
// Shaping options (dust)
// ---------------------------------------------------------------------------

const SHAPING_KINDS = {
  'Alpha Strike Extra Damage': 'alphaStrike', 'Armor Penetration': 'armorPenetration',
  'Auto-Attack Critical Extra Damage': 'autoCritDamage', 'Auto-Attack Critical Hit Chance': 'autoCritChance',
  'Highest Combat Skill Percentage Auto-Attack Damage': 'autoSkillScaling',
  'Highest Combat Skill Percentage Spell Damage': 'spellSkillScaling',
  'Highest Combat Skill Percentage Spell Healing': 'healSkillScaling', 'Life Gain on Hit': 'lifeOnHit',
  'Life Gain on Kill': 'lifeOnKill', 'Mana Gain on Kill': 'manaOnKill', 'Omega Strike Extra Damage': 'omegaStrike',
  'Rune Critical Extra Damage': 'runeCritDamage', 'Rune Critical Hit Chance': 'runeCritChance',
};
const SHAPING_AUGMENTS = {
  'Base Damage': 'baseDamage', 'Critical Extra Damage': 'critDamage', 'Critical Hit Chance': 'critChance',
  'Life Leech': 'lifeLeech', 'Mana Leech': 'manaLeech',
};
const SHAPING_ICON = new WeakMap();
const GROUPS = { 'Todas as Vocações': 'all', Knight: 'knight', Paladin: 'paladin', Monk: 'monk', Sorcerer: 'sorcerer', Druid: 'druid' };
const num = (s) => Number(/[\d.,]+/.exec(s)[0].replace(',', '.'));

function shaping(file) {
  const out = [];
  for (const [group, list] of Object.entries(file.groups)) {
    for (const o of list) {
      const percent = o.rank0.includes('%');
      const r = { group: GROUPS[group], rank0: num(o.rank0) / (percent ? 100 : 1), rank10: num(o.rank10) / (percent ? 100 : 1) };
      const aug = /^Spell Augment (.+) (Base Damage|Critical Extra Damage|Critical Hit Chance|Life Leech|Mana Leech)$/.exec(o.name);
      const best = /^Bestiary Damage (.+)$/.exec(o.name);
      if (aug) out.push({ kind: 'augment', spell: aug[1].replace(/’/g, "'"), augment: SHAPING_AUGMENTS[aug[2]], ...r });
      else if (best) out.push({ kind: 'bestiary', bestiary: best[1], ...r });
      else if (SHAPING_KINDS[o.name]) out.push({ kind: SHAPING_KINDS[o.name], ...r });
      else issue(`shaping: unknown option "${o.name}"`);
      if (o.icon && out.length) SHAPING_ICON.set(out[out.length - 1], o.icon);
      if (!r.group) issue(`shaping: unknown group "${group}"`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// tibiopedia weapon tables
// ---------------------------------------------------------------------------

/** Table order on the page. */
const TABLES = ['axe', 'club', 'sword', 'fist', 'bow', 'crossbow', 'throw', 'arrow', 'bolt', 'wand', 'rod', 'training'];
const PL_ELEMENTS = { fizyczne: 'physical', ogień: 'fire', ziemia: 'earth', energia: 'energy', lód: 'ice', świętość: 'holy', śmierć: 'death' };
const PL_SKILLS = { 'axe fighting': 'axe', 'club fighting': 'club', 'sword fighting': 'sword', 'fist fighting': 'fist', 'distance fighting': 'distance', 'magic level': 'magic' };
const PL_ATTACK_ELEMENT = { lodu: 'ice', ognia: 'fire', ziemi: 'earth', energii: 'energy', śmierci: 'death' };
const VOCATION_OF = { axe: 'knight', club: 'knight', sword: 'knight', fist: 'monk', bow: 'paladin', crossbow: 'paladin', throw: 'paladin', wand: 'sorcerer', rod: 'druid' };

/** Average wand/rod damage missing on tibiopedia (TibiaWiki "damagerange"); others stay unknown. */
const WAND_DAMAGE = { 'amber rod': 106, 'gilded eldritch wand': 95, 'cobra wand': 97, 'grand sanguine coil': 114 };

const strip = (s) =>
  s.replace(/<br\s*\/?>/g, '; ').replace(/<img[^>]*title="([^"]*)"[^>]*>/g, ' [$1]').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const int = (s) => (s && /^-?\d+$/.test(s) ? Number(s) : undefined);

function parseSpecials(text, name) {
  const sp = {};
  for (const raw of (text ?? '').split(';').map((s) => s.trim().replace(/,$/, '')).filter((s) => s && s !== '-')) {
    let m;
    if ((m = /^\+(\d+) (?:(\w+) )?magic level$/.exec(raw))) {
      const el = m[2] ? { fire: 'fire', ice: 'ice', earth: 'earth', energy: 'energy', holy: 'holy', death: 'death', healing: 'healing' }[m[2]] : null;
      if (el) (sp.elementMagicLevel ??= {})[el] = Number(m[1]);
      else if (!m[2]) (sp.skills ??= {}).magic = Number(m[1]);
      else issue(`${name}: special "${raw}"`);
    } else if ((m = /^\+(\d+) (axe|club|sword|fist|distance) fighting$/.exec(raw))) (sp.skills ??= {})[PL_SKILLS[`${m[2]} fighting`]] = Number(m[1]);
    else if ((m = /^\+(\d+) atak \(atk\)$/.exec(raw))) sp.attack = Number(m[1]);
    else if ((m = /^\+(\d+) ataku żywiołu (\S+)$/.exec(raw))) sp.elementAttack = { element: PL_ATTACK_ELEMENT[m[2]], value: Number(m[1]) };
    else if ((m = /^([+-]\d+) obrona \(def\)$/.exec(raw))) sp.defenceMod = Number(m[1]);
    else if ((m = /^(\d+(?:\.\d+)?)% szansy na obrażenie krytyczne$/.exec(raw))) sp.critChance = Number(m[1]) / 100;
    else if ((m = /^\+(\d+(?:\.\d+)?)% większe obrażenia krytyczne$/.exec(raw))) sp.critDamage = Number(m[1]) / 100;
    else if ((m = /^\+(\d+(?:\.\d+)?)% wysysania życia$/.exec(raw))) sp.lifeLeech = Number(m[1]) / 100;
    else if ((m = /^\+(\d+(?:\.\d+)?)% wysysania many$/.exec(raw))) sp.manaLeech = Number(m[1]) / 100;
    else if ((m = /^([+-]\d+)% celność$/.exec(raw))) sp.hitChance = Number(m[1]) / 100;
    else if ((m = /^perfect shot \(\+(\d+) at range (\d+)\)$/.exec(raw))) sp.perfectShot = { value: Number(m[1]), range: Number(m[2]) };
    else if ((m = /^\+(\d+(?:\.\d+)?)% cleave$/.exec(raw))) sp.cleave = Number(m[1]) / 100;
    else if (/odporność|pancerz|damage reflection|zatruwa|atak obszarowy/.test(raw)) continue; // defensive / not modelled
    else issue(`${name}: special "${raw}"`);
  }
  return sp;
}

function parseWeaponTables(html) {
  const out = new Map();
  html.split(/<tr class="sticky">/).slice(1).forEach((table, i) => {
    const type = TABLES[i];
    const rows = table.split(/<tr class="itemTabRow/);
    const head = [...rows[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((m) => strip(m[1]));
    if (!VOCATION_OF[type]) return;
    for (const r of rows.slice(1)) {
      const cells = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]));
      const c = Object.fromEntries(head.map((k, j) => [k, cells[j]]));
      const name = c['Nazwa'];
      if (!name) continue;
      const w = { name, type, hands: c['Typ'] === '2ręczna' ? 2 : 1 };
      const atk = /^(-|\d+) \[([^\]]+)\](?: \(\+(\d+) \[([^\]]+)\]\))?$/.exec(c['Atk'] ?? '');
      if (atk) {
        const el = PL_ELEMENTS[atk[2]];
        if (atk[1] !== '-') {
          if (type === 'wand' || type === 'rod') w.damage = Number(atk[1]);
          else w.attack = Number(atk[1]);
        }
        if (el) w.element = el;
        if (atk[3]) w.elementAttack = { element: PL_ELEMENTS[atk[4]], value: Number(atk[3]) };
      } else if (c['Atk']) issue(`${name}: attack "${c['Atk']}"`);
      const def = int(c['Def']);
      if (def !== undefined) w.defence = def;
      const range = int(c['Zasięg'] ?? c['Zasięg; [sqm]']);
      if (range !== undefined) w.range = range;
      const cls = int(c['Klas.']);
      if (cls !== undefined) w.class = cls;
      const slots = int(c['Sloty']);
      if (slots !== undefined) w.imbuementSlots = slots;
      const lvl = int(c['Min.; lvl']);
      w.minLevel = lvl ?? 0;
      if ((type === 'wand' || type === 'rod') && w.damage === undefined && WAND_DAMAGE[norm(name)]) w.damage = WAND_DAMAGE[norm(name)];
      const sp = parseSpecials(c['Speciale'], name);
      // The elemental part of the attack is also listed as a special.
      if (w.elementAttack && sp.elementAttack?.value === w.elementAttack.value) delete sp.elementAttack;
      if (Object.keys(sp).length) w.specials = sp;
      const prev = out.get(norm(name));
      // A few casters are listed both as wand and as rod: usable by sorcerers and druids.
      if (prev && ((prev.type === 'wand' && type === 'rod') || (prev.type === 'rod' && type === 'wand'))) prev.vocations = ['sorcerer', 'druid'];
      else if (prev) issue(`tibiopedia: duplicate "${name}", keeping the first`);
      else out.set(norm(name), { ...w, vocations: [VOCATION_OF[type]] });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const pal = JSON.parse(await cached('weapon-proficiencies.json', PAL + 'weapon-proficiencies.json'));
const shapingFile = JSON.parse(await cached('perk-shaping-options.json', PAL + 'perk-shaping-options.json'));
const html = await cached('weapons.html', WEAPONS_URL, { Cookie: 'tp_lang=pl; tp_layout=library' });

const palWeapons = Object.values(pal.weapons);
const spells = spellNames(palWeapons.flatMap((w) => w.levels.flatMap((l) => l.proficiencies)));
const stats = parseWeaponTables(html);

const weapons = [];
const unmatched = [];
const seen = new Map();
for (const pw of palWeapons) {
  const st = stats.get(norm(pw.name));
  if (!st) {
    unmatched.push(pw.name);
    continue;
  }
  const levels = pw.levels.map((l) =>
    l.proficiencies
      .map((p) => {
        const perk = toPerk(p, spells, `${st.name} L${l.level}`);
        if (perk) {
          const [base, overlay] = iconKeys(perk);
          voteIcon(base, `${p.sprite.file}#${p.sprite.frame}/${p.sprite.frames}`);
          if (overlay && p.iconImage) voteIcon(overlay, `${p.iconImage}#0/1`);
        }
        return perk;
      })
      .filter((p) => p !== null),
  );
  const tree = JSON.stringify(levels);
  // Identical duplicates (e.g. Ferumbras' staff variants) are kept once.
  if (seen.get(st.name) === tree) continue;
  if (seen.has(st.name)) issue(`${st.name}: several different trees, keeping the first`);
  if (seen.has(st.name)) continue;
  seen.set(st.name, tree);
  weapons.push({ id: slug(st.name), ...st, levels });
}
weapons.sort((a, b) => a.vocations[0].localeCompare(b.vocations[0]) || a.minLevel - b.minLevel || a.name.localeCompare(b.name));
for (const u of unmatched) issue(`not on tibiopedia: ${u}`);

const shapingList = shaping(shapingFile);
// Shaping-only options (e.g. life gain on kill) take the shaping page's icon.
for (const o of shapingList) {
  const [key] = iconKeys(o);
  if (!iconVotes.has(key) && SHAPING_ICON.has(o)) voteIcon(key, `images/proficiency/shaping/${SHAPING_ICON.get(o).split('/').pop()}#0/1`);
}

rmSync(ICONS, { recursive: true, force: true });
mkdirSync(ICONS, { recursive: true });
const icons = {};
for (const [key, votes] of [...iconVotes].sort(([a], [b]) => a.localeCompare(b))) {
  const [ref] = [...votes].sort((a, b) => b[1] - a[1])[0];
  const [path, frame] = ref.split('#');
  const bytes = await cachedBinary(path);
  // Some mirrored .gif files are really WebP: the extension follows the content.
  const ext = bytes.subarray(0, 4).toString('latin1') === 'RIFF' ? '.webp' : bytes.subarray(0, 3).toString('latin1') === 'GIF' ? '.gif' : '.png';
  const name = createHash('sha1').update(bytes).digest('hex').slice(0, 10) + ext;
  writeFileSync(join(ICONS, name), bytes);
  icons[key] = frame === '0/1' ? name : `${name}#${frame}`;
}

const out = {
  meta: {
    sources: ['TibiaPal weapon-proficiencies.json + perk-shaping-options.json (MIT)', WEAPONS_URL],
    weapons: weapons.length,
    withoutTree: [...stats.values()].filter((w) => !palWeapons.some((p) => norm(p.name) === norm(w.name))).map((w) => w.name).sort(),
    issues,
  },
  weapons,
  shaping: shapingList,
  icons,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`Wrote ${weapons.length} weapons, ${out.shaping.length} shaping options, ${Object.keys(icons).length} icons (${readdirSync(ICONS).length} files), ${out.meta.withoutTree.length} weapons without a tree.`);
if (issues.length) console.log(`Issues (${issues.length}):\n  ${issues.join('\n  ')}`);
