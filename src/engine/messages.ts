/**
 * Translatable engine messages. The UI looks up `engine.<key>` and fills `{param}` placeholders;
 * the English templates below are the source of truth and the plain-string fallback.
 * Params are numbers, proper names (monsters, spells, revelations) or ids: elements
 * (`physical`, `fire`, …, `unknown`) and gem qualities.
 */
import type { EngineMessage } from '../types';

export const ENGINE_MESSAGES = {
  // Rationale
  'rationale.priority': 'Priority {priority}/100: offense weighted {offense}%, survivability {defense}%.',
  'rationale.character': 'Character level {level}: {hp} base HP, base mitigation ≈ {mitigation}%; spell damage uses your level and skills.',
  'rationale.singleTarget': 'Hunt mode: single-target spells are not valued ({spells}).',
  'rationale.spot': 'Hunting spot: {list}; element and damage-type modifiers are weighted.',
  'rationale.hpOverMitigation': 'At your level one Hit Points dedication point adds ~{ratio}× more effective HP than a Mitigation point.',
  'rationale.mitigationOverHp': 'At your level one Mitigation point adds ~{ratio}× more effective HP than a Hit Points point.',
  'rationale.hunt': 'Hunt: area spells are valued for about {targets} targets each (tibiapal averages); single-target spells are ignored.',
  'rationale.rotationAuto': 'Damage is based on the rotation {rotation} (picked as the best for this build and spot).',
  'rationale.rotationManual': 'Damage is based on your rotation {rotation}.',
  'rationale.rotationRequires': 'Your rotation needs the {revelation} revelation, which this build does not reach.',
  'rationale.stances': 'Stance: {stances} (picked by its damage / survivability value at your priority).',
  'rationale.noStance': 'No stance: none adds value at your priority.',
  'rationale.forced': 'Augments taken because you forced them: {spells}.',
  'rationale.forcedImpossible': 'Not enough points to reach the augment of {spells}.',
  'rationale.forcedNoAugment': '{spells}: no wheel augment; only gem mods can boost it.',
  'rationale.boss': 'Boss fight: every spell counts ~1 target, so single-target damage and Avatar matter most.',
  'rationale.avatarIgnored': '{avatar} is ignored while hunting (valued in boss mode only).',
  'rationale.weak': '{monster} takes {list} damage, so {spells} were favoured.',
  'rationale.noWeakness': '{monster} has no weakness to this vocation\'s elements; element-neutral perks were preferred.',
  'rationale.resists': '{monster} resists {list}: spells of those elements were de-prioritised.',
  'rationale.immune': '{monster} is immune to {list}: {spells} are useless here.',
  'rationale.threat': '{monster} deals {types} damage: defense value scaled ×{threat}.',
  'rationale.threatMax': '{monster} deals {types} damage (up to ~{max}/turn): defense value scaled ×{threat}.',
  'rationale.noMonster': 'No monster selected: generic build without elemental tailoring.',
  'rationale.revelations': 'Revelations reached: {list}.',
  'rationale.noRevelation': 'Not enough points for a revelation (250 in one domain); points go into the best inner slices.',
  'rationale.vessels': '{filled} Gem Vessel slices filled: {unlocked} of 8 gem vessels unlocked.',
  'rationale.surplus': 'Only {capacity} points fit in the wheel; {surplus} are surplus.',
  'rationale.partial': 'Last slice {slice} is partially filled ({points}/{capacity}) with the leftover points.',

  // Spells
  'spell.avatarHunt': 'Avatar: valued only in boss mode.',
  'spell.singleTargetHunt': 'Single-target spell: not valued while hunting (boss mode only).',
  'spell.avatarBoss': 'Avatar: burst window for the boss fight.',
  'spell.immune': '{monster} is immune to {element}.',
  'spell.damage': '~{targets} targets, {element} {modifier}%: {share}% of your damage.',
  'spell.lowShare': '~{targets} targets, {element} {modifier}%: only {share}% of your damage in this context.',
  'spell.revelationLocked': 'Granted by the {revelation} revelation (not reached in this build).',
  'spell.healing': 'Healing spell: valued on the defense side.',
  'spell.teamHealing': 'Group healing: valuable in team hunts.',
  'spell.teamHealingSolo': 'Group healing: little value when hunting solo.',
  'spell.support': 'Support spell: valued for its effect and cooldown.',
  'spell.notInRotation': 'Not in the used rotation: its augments have no value here.',
  'spell.forced': 'Forced by you: augment taken for its utility.',

  // Gems
  'gem.spell': 'Boosts {spell} (~{targets} targets, {share}% of your damage).',
  'gem.singleTargetHunt': 'Boosts {spell}, a single-target spell (useful in boss fights only).',
  'gem.healing': 'Boosts {spell} healing.',
  'gem.cooldown': 'Shorter {spell} cooldown (Momentum from grade II).',
  'gem.avatar': 'Shorter {spell} cooldown: more Avatar windows in boss fights.',
  'gem.rmStage': 'Pushes {revelation} to stage {stage}.',
  'gem.rmNoStage': 'Adds points to {revelation} (no new stage with this build).',
  'gem.rmReoptFree': 'Re-optimize the wheel after getting it: {revelation} keeps its stage with fewer points, the rest goes to other slices.',
  'gem.rmReopt': 'Re-optimize the wheel after getting it: {revelation} reaches stage {stage} (freed points go to other slices).',
  'gem.resistMonster': 'Protects against {monster}\'s {element} damage.',
  'gem.resist': 'Elemental protection ({element}).',
  'gem.survival': 'Raw survivability: {mod}.',
  'gem.effect': 'General bonus: {mod}.',
  'gem.utility': 'Utility: {mod}.',

  // Stat lines
  'stat.hitPoints': 'Hit points',
  'stat.mana': 'Mana',
  'stat.capacity': 'Capacity',
  'stat.mitigation': 'Mitigation multiplier',
  'stat.lifeLeech': 'Life leech',
  'stat.manaLeech': 'Mana leech',
  'stat.skill': '{skill}',
  'stat.flatBonus': 'Damage & healing (revelations + vessels)',
  'stat.augment': '{name}',
  'stat.unique': '{name}',
  'stat.vessels': 'Gem vessels unlocked',
  'stat.gemMod': '{name} (gems)',

  // Alternatives
  'alt.revelationFocus': '{revelation} focus',
  'alt.noRevelation': 'No revelation',
  'alt.avatarFocus': 'Avatar focus ({revelation})',
  'alt.defensive': 'More defensive',
  'alt.offensive': 'More offensive',
  'alt.tradeoff': 'Offense {offense}, defense {defense} vs the best build ({score}% of its value); revelations: {revelations}.',
} as const;

export type EngineMessageKey = keyof typeof ENGINE_MESSAGES;

export function msg(key: EngineMessageKey, params?: Record<string, string | number>): EngineMessage {
  return params ? { key, params } : { key };
}

export function renderMessage(m: EngineMessage): string {
  const template: string = ENGINE_MESSAGES[m.key as EngineMessageKey] ?? m.key;
  return template.replace(/\{(\w+)\}/g, (all, name: string) =>
    m.params && name in m.params ? String(m.params[name]) : all,
  );
}

/** Message + its English rendering. */
export function text(key: EngineMessageKey, params?: Record<string, string | number>): { msg: EngineMessage; text: string } {
  const m = msg(key, params);
  return { msg: m, text: renderMessage(m) };
}
