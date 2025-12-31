import { useState, useEffect, useMemo, useCallback } from 'react';
import { intervalsApi } from '@/api';
import type { FrequentSection, SectionPortion, ActivityStreams } from '@/types';

/**
 * Individual lap/traversal of a section
 */
export interface SectionLap {
  id: string;
  activityId: string;
  /** Actual time to traverse section (seconds) */
  time: number;
  /** Actual pace (m/s) = distance / time */
  pace: number;
  /** Section distance for this lap */
  distance: number;
  /** Direction relative to representative polyline */
  direction: 'same' | 'reverse';
  /** Start index into activity GPS track */
  startIndex: number;
  /** End index into activity GPS track */
  endIndex: number;
}

/**
 * Performance record for an activity on a section.
 * Groups multiple laps together with best/average stats.
 */
export interface ActivitySectionRecord {
  activityId: string;
  activityName: string;
  activityDate: Date;
  /** All laps/traversals of this section */
  laps: SectionLap[];
  /** Number of times this activity crossed the section */
  lapCount: number;
  /** Best (fastest) time across all laps */
  bestTime: number;
  /** Best (highest) pace across all laps (m/s) */
  bestPace: number;
  /** Average time across all laps */
  avgTime: number;
  /** Average pace across all laps (m/s) */
  avgPace: number;
  /** Direction of the first/primary lap */
  direction: 'same' | 'reverse';
  /** Section distance */
  sectionDistance: number;
}

interface UseSectionPerformancesResult {
  /** Performance records grouped by activity */
  records: ActivitySectionRecord[];
  /** Whether streams are being loaded */
  isLoading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Best overall record (fastest time) */
  bestRecord: ActivitySectionRecord | null;
  /** Refetch all streams */
  refetch: () => void;
}

/**
 * Calculate lap performance from activity portion and stream data
 */
function calculateLap(
  portion: SectionPortion,
  streams: ActivityStreams,
  lapIndex: number
): SectionLap | null {
  if (!streams.time || streams.time.length === 0) return null;

  const { startIndex, endIndex, activityId, distanceMeters, direction } = portion;

  // Validate indices are within stream bounds
  if (startIndex >= streams.time.length || endIndex >= streams.time.length) {
    return null;
  }

  // Calculate actual section time from stream
  const startTime = streams.time[startIndex];
  const endTime = streams.time[endIndex];
  const lapTime = Math.abs(endTime - startTime);

  // Skip invalid times (0 or negative)
  if (lapTime <= 0) return null;

  // Calculate actual pace (m/s)
  const pace = distanceMeters / lapTime;

  return {
    id: `${activityId}_lap${lapIndex}`,
    activityId,
    time: lapTime,
    pace,
    distance: distanceMeters,
    direction: direction as 'same' | 'reverse',
    startIndex,
    endIndex,
  };
}

interface Activity {
  id: string;
  name: string;
  start_date_local: string;
}

/**
 * Hook for calculating accurate section performance times.
 * Fetches activity streams on-demand and calculates actual section times
 * using the start/end indices from SectionPortion.
 *
 * @param section - The section to calculate performances for
 * @param activities - Activities that have traversed this section
 */
export function useSectionPerformances(
  section: FrequentSection | null,
  activities: Activity[] | undefined
): UseSectionPerformancesResult {
  const [streamCache, setStreamCache] = useState<Map<string, ActivityStreams>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get activity IDs that need streams
  const activityIdsToFetch = useMemo(() => {
    if (!section?.activityPortions || !activities) return [];
    return section.activityPortions
      .map(p => p.activityId)
      .filter(id => activities.some(a => a.id === id));
  }, [section?.activityPortions, activities]);

  // Fetch streams for all activities in the section
  const fetchStreams = useCallback(async () => {
    if (activityIdsToFetch.length === 0) return;

    setIsLoading(true);
    setError(null);

    const newCache = new Map<string, ActivityStreams>();

    try {
      // Fetch streams in parallel with concurrency limit
      const batchSize = 5;
      for (let i = 0; i < activityIdsToFetch.length; i += batchSize) {
        const batch = activityIdsToFetch.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (activityId) => {
            // Check existing cache first
            const cached = streamCache.get(activityId);
            if (cached) {
              return { activityId, streams: cached };
            }

            try {
              const streams = await intervalsApi.getActivityStreams(activityId, ['time']);
              return { activityId, streams };
            } catch {
              // Skip failed fetches
              return { activityId, streams: null };
            }
          })
        );

        for (const result of results) {
          if (result.streams) {
            newCache.set(result.activityId, result.streams);
          }
        }
      }

      setStreamCache(newCache);
    } catch (e) {
      setError('Failed to load activity streams');
    } finally {
      setIsLoading(false);
    }
  }, [activityIdsToFetch, streamCache]);

  // Fetch streams when section changes
  useEffect(() => {
    if (section && activities && activityIdsToFetch.length > 0) {
      // Only fetch if we don't have all streams cached
      const missingIds = activityIdsToFetch.filter(id => !streamCache.has(id));
      if (missingIds.length > 0) {
        fetchStreams();
      }
    }
  }, [section?.id, activities?.length]);

  // Calculate performance records from cached streams
  const { records, bestRecord } = useMemo(() => {
    if (!section?.activityPortions || !activities) {
      return { records: [], bestRecord: null };
    }

    // Create lookup maps
    const activityMap = new Map(activities.map(a => [a.id, a]));
    const portionsByActivity = new Map<string, SectionPortion[]>();

    // Group portions by activity (for multi-lap detection)
    for (const portion of section.activityPortions) {
      const existing = portionsByActivity.get(portion.activityId) || [];
      existing.push(portion);
      portionsByActivity.set(portion.activityId, existing);
    }

    const recordList: ActivitySectionRecord[] = [];

    for (const [activityId, portions] of portionsByActivity) {
      const activity = activityMap.get(activityId);
      const streams = streamCache.get(activityId);

      if (!activity) continue;

      // Calculate laps for this activity
      const laps: SectionLap[] = [];
      for (let i = 0; i < portions.length; i++) {
        const lap = calculateLap(portions[i], streams || { time: [] }, i);
        if (lap) {
          laps.push(lap);
        }
      }

      // If we have streams but no valid laps, use proportional estimate as fallback
      if (laps.length === 0 && portions.length > 0) {
        // Skip if no stream data - we'll show loading state
        if (!streams) continue;
      }

      if (laps.length === 0) continue;

      // Calculate aggregate stats
      const times = laps.map(l => l.time);
      const paces = laps.map(l => l.pace);

      recordList.push({
        activityId,
        activityName: activity.name,
        activityDate: new Date(activity.start_date_local),
        laps,
        lapCount: laps.length,
        bestTime: Math.min(...times),
        bestPace: Math.max(...paces),
        avgTime: times.reduce((a, b) => a + b, 0) / times.length,
        avgPace: paces.reduce((a, b) => a + b, 0) / paces.length,
        direction: laps[0].direction,
        sectionDistance: laps[0].distance,
      });
    }

    // Sort by date (chronological for chart)
    recordList.sort((a, b) => a.activityDate.getTime() - b.activityDate.getTime());

    // Find best record (fastest time)
    let best: ActivitySectionRecord | null = null;
    for (const record of recordList) {
      if (!best || record.bestTime < best.bestTime) {
        best = record;
      }
    }

    return { records: recordList, bestRecord: best };
  }, [section, activities, streamCache]);

  return {
    records,
    isLoading,
    error,
    bestRecord,
    refetch: fetchStreams,
  };
}
