import { useMemo } from 'react';
import type { LibraryCoverage } from 'veloqrs';

import { useEngineRead } from './useEngineSubscription';

/**
 * How much of the signed-in athlete's library is on the device.
 *
 * Read on the `activities` channel rather than on a timer: a window sync or a
 * track landing is exactly what moves these counts, and both announce.
 *
 * `null` is no engine, no credential, or a census never pulled, which every
 * caller renders as nothing to report.
 */
export function useLibraryCoverage(): LibraryCoverage | null {
  const readEngine = useEngineRead(['activities']);

  return useMemo(() => {
    try {
      const coverage = readEngine((engine) => engine.libraryCoverage());
      if (!coverage || coverage.upstream === 0) return null;
      return coverage;
    } catch {
      // A throw is the engine refusing the read, which reports nothing.
      return null;
    }
  }, [readEngine]);
}
