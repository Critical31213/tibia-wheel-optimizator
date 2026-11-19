import { useId, useState } from 'react';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { copyText, plannerUrl } from '../lib/planner';

/** Planner export code of the viewed build: read-only field, copy buttons and a planner link. */
export function ExportPanel({ code }: { code: string | undefined }) {
  const t = useT();
  const id = useId();
  const [status, setStatus] = useState<MessageKey | null>(null);

  if (!code) return <p className="text-sm text-parchment-300">{t('export.none')}</p>;

  const url = plannerUrl(code);
  const copy = async (text: string) => setStatus((await copyText(text)) ? 'export.copied' : 'export.copyFailed');

  return (
    <div>
      <label htmlFor={`${id}-code`} className="text-xs text-parchment-300">
        {t('export.code')}
      </label>
      <input
        id={`${id}-code`}
        type="text"
        readOnly
        value={code}
        onFocus={(e) => e.target.select()}
        className="field mt-1 font-mono text-xs"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => void copy(code)} className="field w-auto px-3 py-1.5 text-xs">
          {t('export.copyCode')}
        </button>
        <button type="button" onClick={() => void copy(url)} className="field w-auto px-3 py-1.5 text-xs">
          {t('export.copyLink')}
        </button>
        <a href={url} target="_blank" rel="noreferrer" className="self-center text-xs text-gold-400 hover:underline">
          {t('export.open')}
        </a>
      </div>
      <p className="mt-2 text-xs text-parchment-400" role="status">
        {status ? t(status) : t('export.hint')}
      </p>
    </div>
  );
}
