/**
 * Hook for section encounters — one entry per (section, direction) for an activity.
 * This is the canonical data source for the activity sections tab.
 */

import { useState, useMemo, useEffect } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { SectionEncounter } from 'veloqrs';

export interface UseSectionEncountersResult {
  encounters: SectionEncounter[];
  isLoading: boolean;
}

export function useSectionEncounters(activityId: string | undefined): UseSectionEncountersResult {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    const engine = getRouteEngine();
    if (!engine) return;
    return engine.subscribe('sections', () => setRefreshTrigger((r) => r + 1));
  }, []);

  const { encounters, engineReady } = useMemo(() => {
    if (!activityId) return { encounters: [], engineReady: true };
    const engine = getRouteEngine();
    if (!engine) return { encounters: [], engineReady: false };
    return { encounters: engine.getActivitySectionEncounters(activityId), engineReady: true };
  }, [activityId, refreshTrigger]);

  return { encounters, isLoading: !engineReady };
}
