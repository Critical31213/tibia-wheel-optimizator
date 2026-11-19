/// <reference lib="webworker" />
// Runs the optimizer off the UI thread (D42). One request at a time; the hook sends only the newest input.
import { optimize } from '../engine';
import type { OptimizerInput } from '../types';

export interface OptimizeRequest {
  id: number;
  input: OptimizerInput;
}

self.onmessage = (e: MessageEvent<OptimizeRequest>) => {
  const { id, input } = e.data;
  try {
    self.postMessage({ id, result: optimize(input) });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
