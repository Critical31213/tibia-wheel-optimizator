import { useState } from 'react';
import { useT } from '../i18n';

/** Temporary (D60): copies the exact optimizer input as JSON so a reported build can be reproduced. */
export function DebugCopy({ input }: { input: unknown }) {
  const t = useT();
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const json = JSON.stringify(input);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setState('copied');
    } catch {
      setState('manual');
    }
  };
  return (
    <div className="text-center">
      <button type="button" onClick={copy} disabled={!input} className="text-xs text-parchment-400 underline hover:text-gold-300 disabled:opacity-50">
        {state === 'copied' ? t('debug.copied') : t('debug.copy')}
      </button>
      {state === 'manual' && (
        <textarea readOnly value={json} rows={4} onFocus={(e) => e.currentTarget.select()} className="field mt-1 font-mono text-[10px]" aria-label={t('debug.copy')} />
      )}
    </div>
  );
}
