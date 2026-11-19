import { LANGS, useI18n } from '../i18n';
import type { Lang } from '../i18n';
import { SegmentedControl } from './SegmentedControl';

/** PL / EN toggle (persisted by `I18nProvider`). */
export function LanguageSwitch({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <SegmentedControl<Lang>
      size="sm"
      label={t('lang.label')}
      value={lang}
      onChange={setLang}
      options={LANGS.map((l) => ({ value: l, label: l.toUpperCase(), title: l === 'pl' ? 'Polski' : 'English' }))}
      className={className}
    />
  );
}
