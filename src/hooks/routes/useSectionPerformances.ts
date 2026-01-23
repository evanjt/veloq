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
  /** Whether data is still loading (not yet ready to display) */
  isLoading: boolean;
  /** Whether streams are being fetched from API */
  isFetchingFromApi: boolean;
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
 * Uses cached time streams from Rust engine (SQLite) when available.
 * Only fetches from API for activities missing from cache.
 *
 * @param section - The section to calculate performances for
 * @param activities - Activities that have traversed this section
 */
export function useSectionPerformances(
  section: FrequentSection | null,
  activities: Activity[] | undefined
): UseSectionPerformancesResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0); // For refetch
  const [fetchComplete, setFetchComplete] = useState(false);

  // Get unique activity IDs that need streams
  const allActivityIds = useMemo(() => {
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

  // Fetch ONLY missing streams from API (ones not in Rust cache/SQLite)
  const fetchMissingStreams = useCallback(async () => {
    if (allActivityIds.length === 0) {
      setFetchComplete(true);
      return;
    }

    // Check which activities are missing from cache (memory + SQLite)
    const missingIds = routeEngine.getActivitiesMissingTimeStreams(allActivityIds);

    // If all time streams are cached, we're done immediately
    if (missingIds.length === 0) {
      setFetchComplete(true);
      return;
    }

    // Only show loading for API fetches
    setIsLoading(true);
    setError(null);

    try {
      const streams: Array<{ activityId: string; times: number[] }> = [];

      // Fetch ONLY missing streams in parallel with concurrency limit
      const batchSize = 5;
      for (let i = 0; i < missingIds.length; i += batchSize) {
        const batch = missingIds.slice(i, i + batchSize);
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

      // Sync newly fetched time streams to Rust engine (will persist to SQLite)
      if (streams.length > 0) {
        routeEngine.setTimeStreams(streams);
      }

      setFetchComplete(true);
    } catch {
      setError('Failed to load activity streams');
    } finally {
      setIsLoading(false);
    }
  }, [allActivityIds]);

  // Fetch missing streams when section/activities change or refetch is triggered
  useEffect(() => {
    setFetchComplete(false);
    if (allActivityIds.length > 0) {
      fetchMissingStreams();
    } else {
      setFetchComplete(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section?.id, allActivityIds, fetchKey]);

  // Get performance records from Rust engine
  // Rust auto-loads time streams from SQLite if not in memory
  const { records, bestRecord } = useMemo(() => {
    if (!section || !activities || !fetchComplete) {
      return { records: [], bestRecord: null };
    }

    try {
      // Get calculated performances from Rust engine
      // Rust auto-loads time streams from SQLite for any missing from memory
      const resultJson = routeEngine.getSectionPerformances(section.id);
      if (!resultJson) {
        return { records: [], bestRecord: null };
      }

      // Parse the JSON response
      const result = JSON.parse(resultJson);
      if (!result || !result.records) {
        // Fall back to generating basic records from section data
        const recordList: ActivitySectionRecord[] = activities.map((a) => {
          const portion = section.activityPortions?.find((p) => p.activityId === a.id);
          const direction = (portion?.direction || 'same') as 'same' | 'reverse';
          const sectionDistance = portion?.distanceMeters || section.distanceMeters;

          return {
            activityId: a.id,
            activityName: a.name,
            activityDate: new Date(a.start_date_local),
            laps: [],
            lapCount: 1,
            bestTime: 0,
            bestPace: 0,
            avgTime: 0,
            avgPace: 0,
            direction,
            sectionDistance,
          };
        });

        return { records: recordList, bestRecord: recordList[0] || null };
      }

      // Convert to ActivitySectionRecord format (add Date objects)
      const recordList: ActivitySectionRecord[] = (result.records || []).map(
        (r: {
          activityId: string;
          activityName: string;
          activityDate: number;
          laps: Array<{
            id: string;
            activityId: string;
            time: number;
            pace: number;
            distance: number;
            direction: string;
            startIndex: number;
            endIndex: number;
          }>;
          lapCount: number;
          bestTime: number;
          bestPace: number;
          avgTime: number;
          avgPace: number;
          direction: string;
          sectionDistance: number;
        }) => ({
          activityId: r.activityId,
          activityName: r.activityName,
          activityDate: new Date(r.activityDate * 1000), // Convert Unix timestamp
          laps: (r.laps || []).map((l) => ({
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
        })
      );

      const best: ActivitySectionRecord | null = result.bestRecord
        ? {
            activityId: result.bestRecord.activityId,
            activityName: result.bestRecord.activityName,
            activityDate: new Date(result.bestRecord.activityDate * 1000),
            laps: (result.bestRecord.laps || []).map(
              (l: {
                id: string;
                activityId: string;
                time: number;
                pace: number;
                distance: number;
                direction: string;
                startIndex: number;
                endIndex: number;
              }) => ({
                id: l.id,
                activityId: l.activityId,
                time: l.time,
                pace: l.pace,
                distance: l.distance,
                direction: l.direction as 'same' | 'reverse',
                startIndex: l.startIndex,
                endIndex: l.endIndex,
              })
            ),
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
  }, [section, fetchComplete, activities]);

  const refetch = useCallback(() => {
    setFetchKey((k) => k + 1);
  }, []);

  return {
    records,
    isLoading: !fetchComplete,
    isFetchingFromApi: isLoading,
    error,
    bestRecord,
    refetch,
  };
}
