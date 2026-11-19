import { useEffect, useRef, useState } from 'react';
import type { ModDefinition, OwnedGem } from '../types';
import { useT } from '../i18n';
import { gemSignature, mergeImported, readGems, toOwnedGems, type ImportedGem } from '../lib/gemImport';
import { imageRaster, loadModSheets } from '../lib/gemImportBrowser';

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; n: number }
  | { kind: 'done'; added: number; uncertain: number; duplicates: number; failed: number }
  | { kind: 'confirmReset' };

interface GemImportProps {
  gems: readonly OwnedGem[];
  mods: readonly ModDefinition[];
  /** Panel open: Ctrl+V pastes screenshots. */
  active: boolean;
  onChange: (update: (gems: OwnedGem[]) => OwnedGem[]) => void;
  /** Ids of imported gems whose icons were ambiguous. */
  onFlag: (ids: string[]) => void;
}

/** Import from Gem Atelier screenshots (several at once; recognised locally, images discarded) and reset all gems. */
export function GemImport({ gems, mods, active, onChange, onFlag }: GemImportProps) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const busy = status.kind === 'busy';

  const run = async (files: Blob[]) => {
    if (!files.length || busy) return;
    setStatus({ kind: 'busy', n: files.length });
    const sheets = await loadModSheets().catch(() => null);
    const pages = new Set<string>();
    const found: ImportedGem[] = [];
    let duplicates = 0;
    let failed = 0;
    for (const f of files) {
      try {
        const page = readGems(await imageRaster(f), sheets!, mods);
        if (!page.length) {
          failed++;
          continue;
        }
        const sig = page.map(gemSignature).join('|');
        if (pages.has(sig)) duplicates++;
        else {
          pages.add(sig);
          found.push(...page);
        }
      } catch {
        failed++;
      }
    }
    if (input.current) input.current.value = '';
    const owned = toOwnedGems(found, mods);
    if (owned.length) onChange((all) => mergeImported(all, owned));
    const flagged = owned.filter((_, i) => found[i].uncertain).map((g) => g.id);
    onFlag(flagged);
    setStatus({ kind: 'done', added: owned.length, uncertain: flagged.length, duplicates, failed });
  };

  useEffect(() => {
    if (!active) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      void run(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });

  return (
    <div className="mb-3 rounded-lg border border-ink-700 bg-ink-950/40 p-2.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !mods.length}
          onClick={() => input.current?.click()}
          className="rounded-lg border border-gold-600 bg-gold-700/30 px-3 py-1 text-sm font-medium text-gold-300 hover:bg-gold-700/50 disabled:opacity-50"
        >
          {busy ? t('gems.importing', { n: status.n }) : t('gems.import')}
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => void run([...(e.target.files ?? [])])}
          aria-label={t('gems.import')}
        />
        <span className="min-w-0 flex-1" />
        {status.kind === 'confirmReset' ? (
          <span className="flex items-center gap-2 text-xs">
            <span className="text-resist">{t('gems.resetConfirm', { n: gems.length })}</span>
            <button
              type="button"
              onClick={() => {
                onChange(() => []);
                onFlag([]);
                setStatus({ kind: 'idle' });
              }}
              className="rounded-md border border-resist/60 px-2 py-0.5 text-resist hover:bg-resist/10"
            >
              {t('gems.resetYes')}
            </button>
            <button type="button" onClick={() => setStatus({ kind: 'idle' })} className="rounded-md px-2 py-0.5 text-parchment-300 hover:bg-ink-800">
              {t('gems.resetNo')}
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={!gems.length || busy}
            onClick={() => setStatus({ kind: 'confirmReset' })}
            title={t('gems.reset')}
            aria-label={t('gems.reset')}
            className="rounded-md p-1.5 text-parchment-400 hover:bg-resist/10 hover:text-resist disabled:opacity-40"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4">
              <path d="M3 5h14M8 5V3h4v2M5 5l1 12h8l1-12M8.5 8v6M11.5 8v6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
      <p className="mt-1.5 text-xs text-parchment-400">{t('gems.importHint')}</p>
      {status.kind === 'done' && (
        <p role="status" className="mt-1.5 text-xs text-parchment-200">
          {status.added ? t('gems.imported', { n: status.added }) : t('gems.importNone')}
          {status.uncertain > 0 && <span className="text-amber-300"> {t('gems.importUncertain', { n: status.uncertain })}</span>}
          {status.duplicates > 0 && <span> {t('gems.importDuplicates', { n: status.duplicates })}</span>}
          {status.failed > 0 && status.added > 0 && <span className="text-resist"> {t('gems.importFailed', { n: status.failed })}</span>}
        </p>
      )}
    </div>
  );
}
