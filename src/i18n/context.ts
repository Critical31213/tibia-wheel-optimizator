import { createContext, useContext } from 'react';
import { translator } from './lang';
import type { Lang, TFunction } from './lang';

export interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFunction;
}

export const I18nContext = createContext<I18n>({ lang: 'en', setLang: () => undefined, t: translator('en') });

export const useI18n = (): I18n => useContext(I18nContext);
export const useT = (): TFunction => useContext(I18nContext).t;
