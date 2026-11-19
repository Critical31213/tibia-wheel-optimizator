import { useEffect, useMemo, useRef, useState } from 'react';
import { optimize, type BuildResult } from '../lib/api';
import type { OptimizerInput, OptimizerResult } from '../types';
import type { OptimizeRequest } from '../workers/optimize.worker';

type Reply = { id: number; result?: OptimizerResult; error?: string };
interface Finished {
  result: BuildResult;
  input: OptimizerInput;
}
export interface Optimized {
  /** Newest finished result and the input that produced it. */
  result: BuildResult | null;
  input: OptimizerInput | null;
  /** A newer input is being computed. */
  busy: boolean;
}

/**
 * D42: optimizes in a Web Worker so typing and sliders stay responsive. While one input is computed, only the
 * newest pending input is kept. Without Worker support, or after a worker failure, it computes on the main thread.
 */
export function useOptimizer(input: OptimizerInput | null): Optimized {
  const [fallback, setFallback] = useState(() => typeof Worker === 'undefined');
  const [finished, setFinished] = useState<Finished | null>(null);
  const worker = useRef<Worker | null>(null);
  const running = useRef<OptimizeRequest | null>(null);
  const queued = useRef<OptimizeRequest | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (fallback) return;
    const w = new Worker(new URL('../workers/optimize.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (e: MessageEvent<Reply>) => {
      const done = running.current;
      running.current = queued.current;
      queued.current = null;
      if (running.current) w.postMessage(running.current);
      if (!done || done.id !== e.data.id) return;
      // An error is rethrown on the main thread (same behaviour as before the worker).
      setFinished({ result: e.data.result ?? optimize(done.input), input: done.input });
    };
    w.onerror = () => setFallback(true);
    return () => {
      w.terminate();
      worker.current = null;
      running.current = queued.current = null;
    };
  }, [fallback]);

  useEffect(() => {
    const w = worker.current;
    if (!input || !w) return;
    const req = { id: ++seq.current, input };
    if (running.current) queued.current = req;
    else {
      running.current = req;
      w.postMessage(req);
    }
  }, [input, fallback]);

  const direct = useMemo(() => (fallback && input ? { result: optimize(input), input } : null), [fallback, input]);
  if (direct) return { ...direct, busy: false };
  if (!input) return { result: null, input: null, busy: false };
  return { result: finished?.result ?? null, input: finished?.input ?? null, busy: finished?.input !== input };
}
