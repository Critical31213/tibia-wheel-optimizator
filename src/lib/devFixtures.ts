/**
 * DEV-ONLY FIXTURE — REMOVE once the engine fills `wheel.mods` (S2, iteration 2).
 * Lets the gem editor be developed while `getWheel().mods` is still empty.
 * Never used in production builds (`import.meta.env.DEV` is false there).
 */
import type { ModDefinition, WheelDefinition } from '../types';

const DEV_MODS: ModDefinition[] = [
  { id: 0, kind: 'basic', name: 'Dodge', category: 'defense', gradeValues: ['0.25%', '0.28%', '0.31%', '0.34%'], slots: [1] },
  { id: 1, kind: 'basic', name: 'Mana Leech', category: 'utility', gradeValues: ['0.40%', '0.44%', '0.48%', '0.52%'], slots: [1, 2] },
  { id: 2, kind: 'basic', name: 'Critical Extra Damage', category: 'offense', gradeValues: ['1.5%', '1.65%', '1.8%', '1.95%'], slots: [1, 2] },
  { id: 3, kind: 'basic', name: 'Fire Resistance', category: 'defense', gradeValues: ['2%', '2.2%', '2.4%', '2.6%'], slots: [2] },
  { id: 0, kind: 'supreme', name: 'Revelation Mastery: Avatar', category: 'offense', gradeValues: ['+50', '+55', '+60', '+65'] },
  { id: 1, kind: 'supreme', name: 'Spell Augment: Cooldown', category: 'utility', gradeValues: ['-1s', '-1.1s', '-1.2s', '-1.3s'] },
];

/** `wheel.mods`, or sample mods in dev mode while the real list is empty. */
export function modsWithDevFallback(wheel: WheelDefinition): { mods: ModDefinition[]; isFixture: boolean } {
  if (wheel.mods.length > 0 || !import.meta.env.DEV) return { mods: wheel.mods, isFixture: false };
  return { mods: DEV_MODS, isFixture: true };
}
