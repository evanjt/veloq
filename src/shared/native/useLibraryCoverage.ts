import { useMemo } from 'react';
import type { LibraryCoverage } from 'veloqrs';

import { useEngineRead } from './useEngineSubscription';

/**
 * How much of the signed-in athlete's library is on the device.
 *
 * Read on the `activities` and `gpsTrackStored` channels rather than on a
 * timer: a window sync moves these counts and announces on the first, and a
 * track landing during a bulk download announces only on the second.
 *
 * `null` is no engine, no credential, or a census never pulled, which every
 * caller renders as nothing to report.
 */
export function useLibraryCoverage(): LibraryCoverage | null {
  const readEngine = useEngineRead(['activities', 'gpsTrackStored']);

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
