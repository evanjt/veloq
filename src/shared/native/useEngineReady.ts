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
