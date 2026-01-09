import { useState, useEffect, useMemo, useCallback } from 'react';
import { intervalsApi } from '@/api';
import { routeEngine } from 'route-matcher-native';
import type { FrequentSection, ActivityStreams } from '@/types';

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

interface Activity {
  id: string;
  name: string;
  start_date_local: string;
}

/**
 * Hook for calculating accurate section performance times.
 * Fetches activity streams, syncs to Rust engine, and uses Rust for calculations.
 *
 * @param section - The section to calculate performances for
 * @param activities - Activities that have traversed this section
 */
export function useSectionPerformances(
  section: FrequentSection | null,
  activities: Activity[] | undefined
): UseSectionPerformancesResult {
  const [streamsSynced, setStreamsSynced] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0); // For refetch

  // Get unique activity IDs that need streams
  const activityIdsToFetch = useMemo(() => {
    if (!section?.activityPortions || !activities) return [];
    const activityIdSet = new Set(activities.map((a) => a.id));
    const ids = new Set<string>();
    for (const p of section.activityPortions) {
      if (activityIdSet.has(p.activityId)) {
        ids.add(p.activityId);
      }
    }
    return Array.from(ids);
  }, [section?.activityPortions, activities]);

  // Fetch streams and sync to Rust engine
  const fetchAndSyncStreams = useCallback(async () => {
    if (activityIdsToFetch.length === 0) {
      setStreamsSynced(true);
      return;
    }

    setIsLoading(true);
    setError(null);
    setStreamsSynced(false);

    try {
      const streams: Array<{ activityId: string; times: number[] }> = [];

      // Fetch streams in parallel with concurrency limit
      const batchSize = 5;
      for (let i = 0; i < activityIdsToFetch.length; i += batchSize) {
        const batch = activityIdsToFetch.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (activityId) => {
            try {
              const apiStreams: ActivityStreams = await intervalsApi.getActivityStreams(
                activityId,
                ['time']
              );
              return { activityId, times: apiStreams.time || [] };
            } catch {
              // Skip failed fetches
              return { activityId, times: [] as number[] };
            }
          })
        );

        // Collect valid streams
        for (const result of results) {
          if (result.times.length > 0) {
            streams.push(result);
          }
        }
      }

      // Sync to Rust engine
      if (streams.length > 0) {
        routeEngine.setTimeStreams(streams);
      }

      setStreamsSynced(true);
    } catch {
      setError('Failed to load activity streams');
    } finally {
      setIsLoading(false);
    }
  }, [activityIdsToFetch]);

  // Fetch streams when section/activities change
  useEffect(() => {
    if (activityIdsToFetch.length > 0) {
      fetchAndSyncStreams();
    } else {
      setStreamsSynced(true);
    }
  }, [section?.id, activityIdsToFetch]);

  // Get performance records from Rust engine
  const { records, bestRecord } = useMemo(() => {
    if (!section || !streamsSynced) {
      return { records: [], bestRecord: null };
    }

    try {
      // Get calculated performances from Rust engine
      const result = routeEngine.getSectionPerformances(section.id);

      // Convert to ActivitySectionRecord format (add Date objects)
      const recordList: ActivitySectionRecord[] = result.records.map((r) => ({
        activityId: r.activityId,
        activityName: r.activityName,
        activityDate: new Date(r.activityDate * 1000), // Convert Unix timestamp
        laps: r.laps.map((l) => ({
          id: l.id,
          activityId: l.activityId,
          time: l.time,
          pace: l.pace,
          distance: l.distance,
          direction: l.direction as 'same' | 'reverse',
          startIndex: l.startIndex,
          endIndex: l.endIndex,
        })),
        lapCount: r.lapCount,
        bestTime: r.bestTime,
        bestPace: r.bestPace,
        avgTime: r.avgTime,
        avgPace: r.avgPace,
        direction: r.direction as 'same' | 'reverse',
        sectionDistance: r.sectionDistance,
      }));

      const best: ActivitySectionRecord | null = result.bestRecord
        ? {
            activityId: result.bestRecord.activityId,
            activityName: result.bestRecord.activityName,
            activityDate: new Date(result.bestRecord.activityDate * 1000),
            laps: result.bestRecord.laps.map((l) => ({
              id: l.id,
              activityId: l.activityId,
              time: l.time,
              pace: l.pace,
              distance: l.distance,
              direction: l.direction as 'same' | 'reverse',
              startIndex: l.startIndex,
              endIndex: l.endIndex,
            })),
            lapCount: result.bestRecord.lapCount,
            bestTime: result.bestRecord.bestTime,
            bestPace: result.bestRecord.bestPace,
            avgTime: result.bestRecord.avgTime,
            avgPace: result.bestRecord.avgPace,
            direction: result.bestRecord.direction as 'same' | 'reverse',
            sectionDistance: result.bestRecord.sectionDistance,
          }
        : null;

      return { records: recordList, bestRecord: best };
    } catch {
      // Engine may not have data yet - return empty
      return { records: [], bestRecord: null };
    }
  }, [section, streamsSynced]);

  const refetch = useCallback(() => {
    setFetchKey((k) => k + 1);
  }, []);

  return {
    records,
    isLoading,
    error,
    bestRecord,
    refetch,
  };
}
