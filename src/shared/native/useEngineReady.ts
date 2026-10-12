/**
 * The engine handle, or null until the root layout has opened it.
 *
 * Hooks mount before that init effect runs, so an effect that reads the engine
 * at mount reaches a null handle. This re-renders on the ready nonce the init
 * bumps, so those effects run again the moment the handle exists, in place of
 * the 200 ms poll each of them used to carry.
 */
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';

import { getEngine } from './engine';

export function useEngineReady(): ReturnType<typeof getEngine> {
  // Read on every render the nonce changes, never cached: the handle is
  // replaced by a clear or a quarantine, not only by the first open.
  useEngineStatus((s) => s.readyNonce);
  return getEngine();
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
 * Whether the engine is still opening: no handle yet, and the init has not
 * failed. A read that throws meanwhile is a load still under way rather than a
 * failure, and an effect keyed on `useEngineReady` reads again once it opens.
 */
export function useEngineOpening(): boolean {
  const engine = useEngineReady();
  const initFailed = useEngineStatus((s) => s.initFailed);
  return engine == null && !initFailed;
}
