/**
 * Whether the root layout has opened the engine.
 *
 * Hooks mount before that init effect runs. The handle exists before and
 * after the open, so only this answer moves. It re-renders on the ready nonce
 * the init bumps, so an effect keyed on it runs again the moment the engine
 * opens, in place of the 200 ms poll each of them used to carry.
 */
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';

import { isEngineReady } from './engine';

export function useEngineReady(): boolean {
  // Read on every render the nonce changes, never cached: a clear or a
  // quarantine closes the engine as well as the first open opening it.
  useEngineStatus((s) => s.readyNonce);
  return isEngineReady();
}

/**
 * A count that moves each time the engine opens or its handle is replaced.
 *
 * The handle exists before it opens and answers every read with its empty
 * default, and opening announces nothing on any channel, so a reader that
 * mounted ahead of the open keys on this to read again.
 */
export function useEngineOpenCount(): number {
  return useEngineStatus((s) => s.readyNonce);
}

/**
 * Whether the engine is still opening: not open yet, and the init has not
 * failed. A read that throws meanwhile is a load still under way rather than a
 * failure, and an effect keyed on `useEngineReady` reads again once it opens.
 */
export function useEngineOpening(): boolean {
  const ready = useEngineReady();
  const initFailed = useEngineStatus((s) => s.initFailed);
  return !ready && !initFailed;
}
