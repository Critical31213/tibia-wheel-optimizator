/** Pure i18n helpers (no React). */
import { en } from './en';
import type { Dictionary, MessageKey } from './en';
import { pl } from './pl';

export type Lang = 'en' | 'pl';
export const LANGS: readonly Lang[] = ['pl', 'en'];
export const LANG_STORAGE_KEY = 'wheel-optimizer:lang:v1';

export const DICTIONARIES: Record<Lang, Dictionary> = { en, pl };

export type Vars = Record<string, string | number>;
export type TFunction = (key: MessageKey, vars?: Vars) => string;

export const isLang = (v: unknown): v is Lang => v === 'en' || v === 'pl';

/** Default language from the browser: Polish if it starts with "pl", else English. */
export function detectLang(navigatorLanguage: string | undefined): Lang {
  return navigatorLanguage?.toLowerCase().startsWith('pl') ? 'pl' : 'en';
}

/** Replaces `{name}` placeholders; unknown placeholders are left as is. */
export function format(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export function translator(lang: Lang): TFunction {
  const dict = DICTIONARIES[lang];
  return (key, vars) => format(dict[key] ?? en[key] ?? key, vars);
}

export function initialLang(): Lang {
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    /* storage blocked */
  }
  return detectLang(typeof navigator === 'undefined' ? undefined : navigator.language);
}
