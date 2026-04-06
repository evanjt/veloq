/**
 * Hook for matching an activity against existing sections
 * and force-matching to specific sections.
 */

import { useState, useCallback } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { SectionMatch } from 'veloqrs';

interface UseActivityRematchResult {
  /** All section matches found for the activity. */
  matches: SectionMatch[];
  /** Scan an activity against all sections. */
  scan: (activityId: string) => void;
  /** Force-match an activity to a specific section with relaxed thresholds. */
  rematch: (activityId: string, sectionId: string) => boolean;
  /** Whether a scan or rematch is in progress. */
  isRematching: boolean;
}

export function useActivityRematch(): UseActivityRematchResult {
  const [matches, setMatches] = useState<SectionMatch[]>([]);
  const [isRematching, setIsRematching] = useState(false);

  const scan = useCallback((activityId: string) => {
    const engine = getRouteEngine();
    if (!engine) return;
    setIsRematching(true);
    try {
      const results = engine.matchActivityToSections(activityId);
      setMatches(results);
    } finally {
      setIsRematching(false);
    }
  }, []);

  const rematch = useCallback((activityId: string, sectionId: string): boolean => {
    const engine = getRouteEngine();
    if (!engine) return false;
    setIsRematching(true);
    try {
      return engine.rematchActivityToSection(activityId, sectionId);
    } finally {
      setIsRematching(false);
    }
  }, []);

  return { matches, scan, rematch, isRematching };
}
