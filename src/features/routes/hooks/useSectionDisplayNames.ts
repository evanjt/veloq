import { useMemo } from 'react';

import { getAllSectionDisplayNames } from '@/features/routes/lib/sectionDisplayNames';
import { useEngineSubscription } from '@/shared/native/useEngineSubscription';

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
  const trigger = useEngineSubscription(['sections', 'detectionApplied']);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => getAllSectionDisplayNames(), [trigger]);
}
