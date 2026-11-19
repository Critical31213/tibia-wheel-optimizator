import type { RotationPreset, Vocation } from '../../types';

/**
 * Suggested hunting rotations (user-confirmed + community presets).
 * `ratio` = relative casts. `or` = element alternatives, engine picks the best vs the spot.
 * Revelation spells (Divine Grenade, Executioner's Throw, Ice/Terra Burst, Avatars in boss mode) are added
 * by the engine when the build reaches the revelation; if listed here they are dropped while it is inactive.
 * Monk: 5 Harmony builders, then a spender (D68). Spiritual Outburst is a spender, cast only through `slot`
 * (in place of Sweeping Takedown while off cooldown, D66).
 */
export const ROTATION_PRESETS: readonly RotationPreset[] = [
  { id: 'ek-mas', vocation: 'knight', name: 'Fierce Berserk – Groundshaker – Berserk', spells: [{ name: 'Fierce Berserk', ratio: 1 }, { name: 'Groundshaker', ratio: 1 }, { name: 'Berserk', ratio: 1 }] },
  { id: 'ek-min', vocation: 'knight', name: 'Fierce Berserk – Front Sweep – Berserk', spells: [{ name: 'Fierce Berserk', ratio: 1 }, { name: 'Front Sweep', ratio: 1 }, { name: 'Berserk', ratio: 1 }] },
  { id: 'ek-shield', vocation: 'knight', name: 'Fierce Berserk – Shield Slam – Berserk (shield)', requires: { shield: true }, spells: [{ name: 'Fierce Berserk', ratio: 1 }, { name: 'Shield Slam', ratio: 1 }, { name: 'Berserk', ratio: 1 }] },

  { id: 'rp-caldera-ethereal', vocation: 'paladin', name: 'Divine Caldera – Ethereal Barrage', note: 'holy vs physical within ~20%', spells: [{ name: 'Divine Caldera', ratio: 1 }, { name: 'Ethereal Barrage', ratio: 1 }] },
  { id: 'rp-caldera-divine', vocation: 'paladin', name: 'Divine Caldera – Divine Barrage', note: 'holy clearly better', spells: [{ name: 'Divine Caldera', ratio: 1 }, { name: 'Divine Barrage', ratio: 1 }] },
  { id: 'rp-barrages', vocation: 'paladin', name: 'Divine Barrage – Ethereal Barrage', spells: [{ name: 'Divine Barrage', ratio: 1 }, { name: 'Ethereal Barrage', ratio: 1 }] },

  { id: 'ms-gfw-echo', vocation: 'sorcerer', name: 'Great Fire Wave – Death Echo', spells: [{ name: 'Great Fire Wave', ratio: 10 }, { name: 'Death Echo', ratio: 10 }, { name: "Hell's Core", ratio: 1 }] },
  { id: 'ms-gfw-geb', vocation: 'sorcerer', name: 'GFW – Energy Wave – GFW – Great Energy Beam', requires: { revelation: 'Beam Mastery' }, spells: [{ name: 'Great Fire Wave', ratio: 10 }, { name: 'Energy Wave', ratio: 5 }, { name: 'Great Energy Beam', ratio: 5 }, { name: "Hell's Core", ratio: 1 }] },
  { id: 'ms-echo-gdb', vocation: 'sorcerer', name: 'Death Echo – Energy Wave – Death Echo – Great Death Beam', requires: { revelation: 'Beam Mastery' }, spells: [{ name: 'Death Echo', ratio: 10 }, { name: 'Energy Wave', ratio: 5 }, { name: 'Great Death Beam', ratio: 5 }, { name: "Hell's Core", ratio: 1 }] },
  { id: 'ms-ew-geb', vocation: 'sorcerer', name: 'Energy Wave – Death Echo – Great Energy Beam – Death Echo', requires: { revelation: 'Beam Mastery' }, spells: [{ name: 'Energy Wave', ratio: 5 }, { name: 'Death Echo', ratio: 10 }, { name: 'Great Energy Beam', ratio: 5 }, { name: "Hell's Core", ratio: 1 }] },

  { id: 'ed-forks', vocation: 'druid', name: 'Forked Thorns – Forked Glacier', spells: [{ name: 'Forked Thorns', ratio: 10 }, { name: 'Forked Glacier', ratio: 10 }, { name: 'Eternal Winter', ratio: 1, or: ['Wrath of Nature'] }] },
  { id: 'ed-forks-burst', vocation: 'druid', name: 'Forks – Burst', spells: [{ name: 'Forked Thorns', ratio: 8 }, { name: 'Forked Glacier', ratio: 9 }, { name: 'Ice Burst', ratio: 2, or: ['Terra Burst'] }, { name: 'Eternal Winter', ratio: 1, or: ['Wrath of Nature'] }] },
  { id: 'ed-glacier-frigo', vocation: 'druid', name: 'Forked Glacier – Strong Ice Wave', spells: [{ name: 'Forked Glacier', ratio: 10 }, { name: 'Strong Ice Wave', ratio: 10 }, { name: 'Eternal Winter', ratio: 1, or: ['Wrath of Nature'] }] },
  { id: 'ed-waves', vocation: 'druid', name: 'Strong Ice Wave – Terra Wave', spells: [{ name: 'Strong Ice Wave', ratio: 10 }, { name: 'Terra Wave', ratio: 10 }, { name: 'Eternal Winter', ratio: 1, or: ['Wrath of Nature'] }] },
  { id: 'ed-thorns-tera', vocation: 'druid', name: 'Forked Thorns – Terra Wave', spells: [{ name: 'Forked Thorns', ratio: 10 }, { name: 'Terra Wave', ratio: 10 }, { name: 'Wrath of Nature', ratio: 1, or: ['Eternal Winter'] }] },

  { id: 'em-voh', vocation: 'monk', name: 'Chain – GFoB – Chain – TFB – Chain – Takedown (Harmony)', stance: 'Virtue of Harmony', spells: [{ name: 'Chained Penance', ratio: 3 }, { name: 'Greater Flurry of Blows', ratio: 1 }, { name: 'Thousand Fist Blows', ratio: 1 }, { name: 'Sweeping Takedown', ratio: 1 }] },
  { id: 'em-voh-so', vocation: 'monk', name: 'Chain – GFoB – Chain – TFB – Chain – Outburst / Takedown (Harmony)', stance: 'Virtue of Harmony', requires: { revelation: 'Spiritual Outburst' }, spells: [{ name: 'Chained Penance', ratio: 3 }, { name: 'Greater Flurry of Blows', ratio: 1 }, { name: 'Thousand Fist Blows', ratio: 1 }, { name: 'Sweeping Takedown', ratio: 1, slot: ['Spiritual Outburst'] }] },
  { id: 'em-voj', vocation: 'monk', name: 'Chain – GFoB – Chain – TFB – Chain – Takedown (Justice)', stance: 'Virtue of Justice', spells: [{ name: 'Chained Penance', ratio: 3 }, { name: 'Greater Flurry of Blows', ratio: 1 }, { name: 'Thousand Fist Blows', ratio: 1 }, { name: 'Sweeping Takedown', ratio: 1 }] },
  { id: 'em-voj-so', vocation: 'monk', name: 'Chain – GFoB – Chain – TFB – Chain – Outburst / Takedown (Justice)', stance: 'Virtue of Justice', requires: { revelation: 'Spiritual Outburst' }, spells: [{ name: 'Chained Penance', ratio: 3 }, { name: 'Greater Flurry of Blows', ratio: 1 }, { name: 'Thousand Fist Blows', ratio: 1 }, { name: 'Sweeping Takedown', ratio: 1, slot: ['Spiritual Outburst'] }] },
  { id: 'em-tfb', vocation: 'monk', name: 'TFB – GFoB – Chain – TFB – Chain – Takedown', spells: [{ name: 'Thousand Fist Blows', ratio: 2 }, { name: 'Greater Flurry of Blows', ratio: 1 }, { name: 'Chained Penance', ratio: 2 }, { name: 'Sweeping Takedown', ratio: 1 }] },
  { id: 'em-tfb-so', vocation: 'monk', name: 'TFB – GFoB – Chain – TFB – Chain – Outburst / Takedown', requires: { revelation: 'Spiritual Outburst' }, spells: [{ name: 'Thousand Fist Blows', ratio: 2 }, { name: 'Greater Flurry of Blows', ratio: 1 }, { name: 'Chained Penance', ratio: 2 }, { name: 'Sweeping Takedown', ratio: 1, slot: ['Spiritual Outburst'] }] },
];

export function getRotationPresets(vocation: Vocation): RotationPreset[] {
  return ROTATION_PRESETS.filter((r) => r.vocation === vocation);
}
