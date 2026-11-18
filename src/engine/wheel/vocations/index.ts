import type { Vocation } from '../../../types';
import { druid } from './druid';
import { knight } from './knight';
import { monk } from './monk';
import { paladin } from './paladin';
import { sorcerer } from './sorcerer';
import type { VocationSpec } from './types';

export type { VocationSpec } from './types';

export const VOCATION_SPECS: Record<Vocation, VocationSpec> = { knight, paladin, sorcerer, druid, monk };
