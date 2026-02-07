/**
 * Hook for detecting and managing potential sections using multi-scale detection.
 *
 * Potential sections are suggestions from 1-2 activity overlaps that users
 * can promote to full sections.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { gpsPointsToRoutePoints } from 'veloqrs';
import { usePotentialSections as usePotentialSectionsStore } from '@/providers/PotentialSectionsStore';
import type { PotentialSection } from '@/types';

interface UsePotentialSectionsOptions {
  /** Filter by sport type (e.g., "Run", "Ride") */
  sportType?: string;
  /** Minimum number of activities before running detection (default: 10) */
  minActivities?: number;
  /** Whether to run detection automatically (default: true) */
  autoDetect?: boolean;
  /** Whether to run the hook (default: true). When false, returns empty defaults. */
  enabled?: boolean;
}

interface UsePotentialSectionsResult {
  /** Detected potential sections */
  potentials: PotentialSection[];
  /** Whether detection is in progress */
  isDetecting: boolean;
  /** Whether store is loaded */
  isLoaded: boolean;
  /** Manually trigger detection */
  detect: () => Promise<void>;
  /** Clear stored potentials */
  clear: () => Promise<void>;
}

/**
 * Hook for potential section detection and management.
 *
 * Automatically runs multi-scale detection when:
 * - Store is loaded
 * - Engine has enough activities
 * - Detection hasn't run recently
 *
 * @example
 * ```tsx
 * function SectionsScreen() {
 *   const { potentials, isDetecting, detect } = usePotentialSections({
 *     sportType: 'Ride',
 *     minActivities: 10,
 *   });
 *
 *   return (
 *     <>
 *       {potentials.map(p => <PotentialSectionCard key={p.id} section={p} />)}
 *       {isDetecting && <LoadingSpinner />}
 *     </>
 *   );
 * }
 * ```
 */
export function usePotentialSections(
  options: UsePotentialSectionsOptions = {}
): UsePotentialSectionsResult {
  const { sportType, minActivities = 10, autoDetect = true, enabled = true } = options;

  const {
    potentials: storedPotentials,
    isLoaded,
    setPotentials,
    clear,
  } = usePotentialSectionsStore();
  const [isDetecting, setIsDetecting] = useState(false);
  const isMountedRef = useRef(true);
  const hasDetectedRef = useRef(false);

  // Filter by sport type
  const potentials = useState(() => {
    let filtered = storedPotentials;
    if (sportType) {
      filtered = filtered.filter((p) => p.sportType === sportType);
    }
    return filtered;
  })[0];

  // Update filtered potentials when stored potentials or sport type changes
  useEffect(() => {
    let filtered = storedPotentials;
    if (sportType) {
      filtered = filtered.filter((p) => p.sportType === sportType);
    }
    // Note: In a real app you'd use useState for filtered potentials
    // For simplicity, we're using the store directly
  }, [storedPotentials, sportType]);

  /**
   * Run potential section detection.
   * Single FFI call - Rust loads all GPS tracks from SQLite internally.
   * This replaces the old N+1 pattern that transferred ~100KB+ per activity.
   */
  const detect = useCallback(async () => {
    const engine = getRouteEngine();
    if (!engine || !isMountedRef.current) return;

    const activityCount = engine.getActivityIds().length;
    if (activityCount < minActivities) {
      if (__DEV__) {
        console.log(
          `[usePotentialSections] Not enough activities (${activityCount} < ${minActivities})`
        );
      }
      return;
    }

    setIsDetecting(true);

    try {
      // Single FFI call - Rust loads all tracks from SQLite internally
      const rawPotentials = engine.detectPotentials(sportType);

      // Convert to app format (snake_case to camelCase, GpsPoint to RoutePoint)
      const potentials: PotentialSection[] = rawPotentials.map((p) => ({
        id: p.id,
        sportType: p.sport_type,
        polyline: gpsPointsToRoutePoints(p.polyline),
        activityIds: p.activity_ids,
        visitCount: p.activity_ids.length,
        distanceMeters: p.distance_meters,
        confidence: p.confidence,
        scale: p.scale,
      }));

      if (isMountedRef.current) {
        await setPotentials(potentials);
        if (__DEV__) {
          console.log(`[usePotentialSections] Detected ${potentials.length} potential sections`);
        }
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[usePotentialSections] Detection failed:', error);
      }
    } finally {
      if (isMountedRef.current) {
        setIsDetecting(false);
      }
    }
  }, [minActivities, sportType, setPotentials]);

  // Auto-detect is now DISABLED on page load.
  // Potential section detection runs during GPS sync in useGpsDataFetcher.ts
  // This prevents expensive computation during UI navigation.
  // Manual detection can still be triggered via the detect() function.
  //
  // NOTE: The autoDetect option is kept for backward compatibility but is ignored.
  // Detection happens in the background during GPS sync, not on component mount.

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return {
    potentials: enabled
      ? storedPotentials.filter((p) => !sportType || p.sportType === sportType)
      : [],
    isDetecting,
    isLoaded,
    detect,
    clear,
  };
}
