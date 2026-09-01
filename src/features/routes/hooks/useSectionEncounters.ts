/**
 * Hook for section encounters - one entry per (section, direction) for an activity.
 * This is the canonical data source for the activity sections tab.
 */

import { useState, useMemo, useEffect } from 'react';
import { getEngine } from '@/shared/native/engine';
import type { SectionEncounter } from 'veloqrs';

export interface UseSectionEncountersResult {
  encounters: SectionEncounter[];
  isLoading: boolean;
}

/**
 * `preComputedEncounters` lets a caller that already read the activity detail
 * bundle skip this hook's own FFI call.
 */
export function useSectionEncounters(
  activityId: string | undefined,
  preComputedEncounters?: SectionEncounter[]
): UseSectionEncountersResult {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const skipOwnFfiCall = preComputedEncounters !== undefined;

  useEffect(() => {
    if (skipOwnFfiCall) return;
    const engine = getEngine();
    if (!engine) return;
    return engine.subscribe('sections', () => setRefreshTrigger((r) => r + 1));
  }, [skipOwnFfiCall]);

  const { encounters, engineReady } = useMemo(() => {
    if (skipOwnFfiCall) return { encounters: preComputedEncounters, engineReady: true };
    if (!activityId) return { encounters: [], engineReady: true };
    const engine = getEngine();
    if (!engine) return { encounters: [], engineReady: false };
    try {
      return { encounters: engine.getActivitySectionEncounters(activityId), engineReady: true };
    } catch {
      return { encounters: [], engineReady: true };
    }
  }, [activityId, refreshTrigger, skipOwnFfiCall, preComputedEncounters]);

  return { encounters, isLoading: !engineReady };
}
