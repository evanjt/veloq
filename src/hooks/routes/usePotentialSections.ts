/**
 * Hook for detecting and managing potential sections using multi-scale detection.
 *
 * Potential sections are suggestions from 1-2 activity overlaps that users
 * can promote to full sections.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { InteractionManager } from 'react-native';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { detectSectionsMultiscale, getDefaultScalePresets, type PotentialSection } from 'route-matcher-native';
import { usePotentialSections as usePotentialSectionsStore } from '@/providers/PotentialSectionsStore';
import type { Activity } from '@/types';

interface UsePotentialSectionsOptions {
  /** Filter by sport type (e.g., "Run", "Ride") */
  sportType?: string;
  /** Minimum number of activities before running detection (default: 10) */
  minActivities?: number;
  /** Whether to run detection automatically (default: true) */
  autoDetect?: boolean;
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
  const { sportType, minActivities = 10, autoDetect = true } = options;

  const { potentials: storedPotentials, isLoaded, setPotentials, clear } = usePotentialSectionsStore();
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
   * Run multi-scale section detection.
   */
  const detect = useCallback(async () => {
    const engine = getRouteEngine();
    if (!engine || !isMountedRef.current) return;

    const activityIds = engine.getActivityIds();
    if (activityIds.length < minActivities) {
      console.log(`[usePotentialSections] Not enough activities (${activityIds.length} < ${minActivities})`);
      return;
    }

    setIsDetecting(true);

    try {
      // Get activity data for detection
      const activities: Array<{ activityId: string; points: { latitude: number; longitude: number }[] }> = [];

      for (const id of activityIds) {
        const track = engine.getGpsTrack(id);
        if (track.length > 0) {
          const points: { latitude: number; longitude: number }[] = [];
          for (let i = 0; i < track.length; i += 2) {
            points.push({
              latitude: track[i],
              longitude: track[i + 1],
            });
          }
          if (points.length >= 4) {
            activities.push({ activityId: id, points });
          }
        }
      }

      if (activities.length === 0) {
        console.log('[usePotentialSections] No valid GPS tracks found');
        setIsDetecting(false);
        return;
      }

      // Get route groups for linking sections
      const groups = engine.getGroups();

      // Get sport types for each activity
      const sportTypes = activities.map((a) => ({
        activityId: a.activityId,
        sportType: 'Ride', // Default, could be improved by storing sport type in engine
      }));

      // Run multi-scale detection
      const result = detectSectionsMultiscale(activities, sportTypes, groups);

      // Store potentials
      if (isMountedRef.current) {
        await setPotentials(result.potentials);
        console.log(`[usePotentialSections] Detected ${result.potentials.length} potential sections`);
      }
    } catch (error) {
      console.error('[usePotentialSections] Detection failed:', error);
    } finally {
      if (isMountedRef.current) {
        setIsDetecting(false);
      }
    }
  }, [minActivities, setPotentials]);

  // Auto-detect on mount if conditions are met
  useEffect(() => {
    if (!isLoaded || !autoDetect || hasDetectedRef.current) return;

    const task = InteractionManager.runAfterInteractions(() => {
      // Check if we have enough activities
      const engine = getRouteEngine();
      if (!engine) return;

      const activityCount = engine.getActivityCount();
      if (activityCount >= minActivities && storedPotentials.length === 0) {
        hasDetectedRef.current = true;
        detect();
      }
    });

    return () => task.cancel();
  }, [isLoaded, autoDetect, minActivities, storedPotentials.length, detect]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return {
    potentials: storedPotentials.filter((p) => !sportType || p.sportType === sportType),
    isDetecting,
    isLoaded,
    detect,
    clear,
  };
}
