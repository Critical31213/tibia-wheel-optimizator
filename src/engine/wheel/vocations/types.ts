import type { Vocation } from '../../../types';
import type { PassiveDef, RevelationDef, SpellDef } from '../perks';

/**
 * Per-vocation data. Dedication numbers are per invested point and come from
 * canary io_wheel.cpp; perk value units (off/def/util) are engine estimates.
 */
export interface VocationSpec {
  vocation: Vocation;
  hpPerPoint: number;
  manaPerPoint: number;
  capacityPerPoint: number;
  skillName: string;
  /** Value units of the +1 skill conviction. */
  skillValue: number;
  /** Spell groups A–E (each appears in two slices). */
  spells: Record<'A' | 'B' | 'C' | 'D' | 'E', SpellDef>;
  passiveGreen: PassiveDef;
  passivePurple: PassiveDef;
  revelations: { green: RevelationDef; red: RevelationDef; purple: RevelationDef; blue: RevelationDef };
  /** Whole vocation is a best-effort model. */
  approximate?: boolean;
}
