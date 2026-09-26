import { useMemo } from 'react';

import { getAllSectionDisplayNames } from '@/features/routes/lib/sectionDisplayNames';
import { useEngineRead } from '@/shared/native/useEngineSubscription';

/**
 * Section display names, re-read whenever the engine says they moved.
 *
 * Three screens read them straight from the engine inside a `useMemo` keyed on
 * their own inputs, so a detection run or a rename while the screen was open
 * left the old names on it until the screen was re-entered. Detection
 * announces on `detectionApplied`, and a rename, a split and a retire all go
 * out on `sections`.
 */
export function useSectionDisplayNames(): Record<string, string> {
  const readSections = useEngineRead(['sections', 'detectionApplied']);

  // The reader is called for its identity as much as its engine: the names come
  // from a helper that opens the engine itself, and the reader is what says the
  // answer moved.
  return useMemo(() => {
    readSections(() => undefined);
    return getAllSectionDisplayNames();
  }, [readSections]);
}
