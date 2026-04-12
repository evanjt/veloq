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
  const [isLoading, setIsLoading] = useState(true);

  // Subscribe to section changes
  useEffect(() => {
    const engine = getRouteEngine();
    if (!engine) return;

    const unsub = engine.subscribe('sections', () => {
      setRefreshTrigger((r) => r + 1);
    });
    return unsub;
  }, []);

  const encounters = useMemo(() => {
    if (!activityId) {
      setIsLoading(false);
      return [];
    }

    const engine = getRouteEngine();
    if (!engine) return [];

    try {
      const result = engine.getActivitySectionEncounters(activityId);
      setIsLoading(false);
      return result;
    } catch {
      setIsLoading(false);
      return [];
    }
  }, [activityId, refreshTrigger]);

  return { encounters, isLoading };
}
