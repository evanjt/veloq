/**
 * Hook for getting sections that an activity belongs to.
 * Used to display matched sections in the activity detail view.
 *
 * OPTIMIZED: Uses getSectionsForActivity() FFI function with junction table
 * for O(1) lookup instead of loading all sections (~250-570ms → ~10-20ms).
 */

import { useMemo, useState, useEffect, useRef } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { generateSectionName } from '@/lib/utils/sectionNaming';
import { convertNativeSectionToApp } from '@/lib/utils/sectionConversions';
import type { FrequentSection } from '@/types';

/**
 * Runtime type guard for FrequentSection from engine.
 * Validates essential properties to prevent crashes from malformed engine data.
 */
function isValidSection(value: unknown): value is FrequentSection {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.visitCount === 'number' &&
    Array.isArray(obj.activityIds) &&
    typeof obj.distanceMeters === 'number'
  );
}

export interface SectionMatch {
  /** The section */
  section: FrequentSection;
  /** Direction: 'same' or 'reverse' */
  direction: 'same' | 'reverse';
  /** Section distance in meters */
  distance: number;
}

export interface UseSectionMatchesResult {
  /** Sections this activity belongs to */
  sections: SectionMatch[];
  /** Total number of sections */
  count: number;
  /** Whether data is ready */
  isReady: boolean;
  /** Whether engine data is still loading (engine not available or not yet subscribed) */
  isLoading: boolean;
  /** Whether the engine subscription timed out (engine never became available) */
  timedOut: boolean;
}

/**
 * Get all sections that contain a given activity.
 *
 * OPTIMIZED: Uses junction table lookup instead of loading all sections.
 * Previous: ~250-570ms (load ALL sections, filter in JS)
 * Now: ~10-20ms (query only sections for this activity)
 */
export function useSectionMatches(activityId: string | undefined): UseSectionMatchesResult {
  // Lightweight refresh trigger for section changes
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Use a ref for the refresh function to avoid stale closures in the subscription.
  // The subscription callback always calls the latest refresh via the ref.
  const refreshRef = useRef(() => setRefreshTrigger((r) => r + 1));
  refreshRef.current = () => setRefreshTrigger((r) => r + 1);

  // Track whether we've successfully subscribed to the engine
  const [subscribed, setSubscribed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  // Hold unsubscribe function so cleanup works across retries
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Subscribe to section changes.
  // If the engine isn't available on first mount, polls until it becomes available,
  // preventing a permanent miss when the engine initializes after the effect runs.
  // Safety timeout: after 10s, mark as subscribed to prevent infinite loading.
  useEffect(() => {
    let cancelled = false;

    function trySubscribe() {
      const engine = getRouteEngine();
      if (!engine) return false;

      unsubscribeRef.current = engine.subscribe('sections', () => refreshRef.current());
      if (!cancelled) {
        setSubscribed(true);
        // Trigger an initial refresh in case data was already available before subscription
        refreshRef.current();
      }
      return true;
    }

    // Safety timeout: if engine never becomes available, stop showing loading
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setSubscribed(true);
        setTimedOut(true);
      }
    }, 10000);

    if (!trySubscribe()) {
      // Engine not ready yet — poll until it becomes available
      const interval = setInterval(() => {
        if (trySubscribe()) {
          clearInterval(interval);
          clearTimeout(timeout);
        }
      }, 200);

      return () => {
        cancelled = true;
        clearInterval(interval);
        clearTimeout(timeout);
        unsubscribeRef.current?.();
      };
    }

    clearTimeout(timeout);
    return () => {
      cancelled = true;
      unsubscribeRef.current?.();
    };
  }, []); // Stable — refreshRef avoids stale closure

  // Check if engine has any sections
  const sectionCount = useMemo(() => {
    try {
      const engine = getRouteEngine();
      return engine?.getSectionSummaries()?.totalCount ?? 0;
    } catch {
      return 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  const isReady = sectionCount > 0;
  const isLoading = !subscribed;

  // Rust already filters out disabled/superseded sections in getSectionsForActivity
  const sections = useMemo(() => {
    if (!activityId) {
      return [];
    }

    const engine = getRouteEngine();
    if (!engine) {
      return [];
    }

    let nativeSections;
    try {
      nativeSections = engine.getSectionsForActivity(activityId);
    } catch {
      return [];
    }

    const matches: SectionMatch[] = [];

    for (const native of nativeSections) {
      try {
        // Convert to app format
        const converted = convertNativeSectionToApp(native);
        const section = {
          ...converted,
          name: generateSectionName(converted),
        };

        // Validate section structure to prevent crashes from malformed engine data
        if (!isValidSection(section)) {
          continue;
        }

        matches.push({
          section,
          direction: 'same',
          distance: section.distanceMeters,
        });
      } catch {
        continue;
      }
    }

    // Tier 3.4: Rust now returns sections deduped by section_id and
    // sorted by visit count desc, so the TS-side passes are gone.
    return matches;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId, refreshTrigger]);

  return {
    sections,
    count: sections.length,
    isReady,
    isLoading,
    timedOut,
  };
}
