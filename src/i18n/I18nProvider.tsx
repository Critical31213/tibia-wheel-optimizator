import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { I18nContext } from './context';
import { initialLang, LANG_STORAGE_KEY, translator } from './lang';
import type { Lang } from './lang';

/** Holds the UI language; persists it and keeps `<html lang>` in sync. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      /* storage blocked */
    }
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t: translator(lang) }), [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
