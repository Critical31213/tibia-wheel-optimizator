/** Renders translatable engine messages (`engine.<key>`) with the English engine string as fallback. */
import { GREEDY_ROTATION_ID, type EngineMessage } from '../types';
import { en } from './en';
import type { MessageKey } from './en';
import type { TFunction, Vars } from './lang';

const ELEMENT_IDS = /\b(physical|fire|earth|energy|ice|holy|death|lifeDrain|manaDrain|drown|healing|unknown)\b/g;
const HUNT_STYLES = new Set(['solo', 'teamLure', 'teamBox']);

const isKey = (k: string): k is MessageKey => k in en;

/** Translates id-valued params (elements, hunt styles); proper names and numbers pass through. */
function translateParams(t: TFunction, params: EngineMessage['params']): Vars | undefined {
  if (!params) return undefined;
  const out: Vars = {};
  for (const [name, value] of Object.entries(params)) {
    if (typeof value !== 'string') out[name] = value;
    else if (name === 'style' && HUNT_STYLES.has(value)) out[name] = t(`context.${value}` as MessageKey);
    else if (name === 'rotation' && value === GREEDY_ROTATION_ID) out[name] = t('rotation.boss');
    else if (name === 'element' || name === 'list' || name === 'types') {
      out[name] = value.replace(ELEMENT_IDS, (id) =>
        id === 'unknown' ? t('common.unknown') : t(`element.${id}` as MessageKey).toLowerCase(),
      );
    } else out[name] = value;
  }
  return out;
}

export function engineText(t: TFunction, m: EngineMessage | undefined, fallback: string): string {
  if (!m) return fallback;
  const key = `engine.${m.key}`;
  return isKey(key) ? t(key, translateParams(t, m.params)) : fallback;
}
