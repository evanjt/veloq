import { useState, useEffect, useMemo, useCallback } from 'react';
import { routeEngine } from 'veloqrs';
import { intervalsApi } from '@/api';
import type { SectionMatch } from '@/hooks/routes/useSectionMatches';
import type { Section } from '@/types';

/**
 * Fetches time streams for all activities in matched sections and syncs them
 * to the Rust engine for performance calculations (best times, pace deltas).
 *
 * Only activates when `activeTab === 'sections'`.
 */
export function useSectionTimeStreams(
  activeTab: string,
  engineSectionMatches: SectionMatch[],
  customMatchedSections: Section[]
) {
  // Collect all activity IDs from matched sections for performance data
  const sectionActivityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const match of engineSectionMatches) {
      for (const actId of match.section.activityIds) {
        ids.add(actId);
      }
    }
    for (const section of customMatchedSections) {
      if (section.sourceActivityId) {
        ids.add(section.sourceActivityId);
      }
      for (const activityId of section.activityIds ?? []) {
        ids.add(activityId);
      }
    }
    return Array.from(ids);
  }, [engineSectionMatches, customMatchedSections]);

  // Fetch and sync time streams to Rust engine for section performance calculations
  const [performanceDataReady, setPerformanceDataReady] = useState(false);
  useEffect(() => {
    if (activeTab !== 'sections' || sectionActivityIds.length === 0) {
      return;
    }

    let cancelled = false;
    const fetchTimeStreams = async () => {
      try {
        const streamsToSync: Array<{ activityId: string; times: number[] }> = [];

        // Fetch in batches of 5 to avoid overwhelming the API
        const batchSize = 5;
        for (let i = 0; i < sectionActivityIds.length && !cancelled; i += batchSize) {
          const batch = sectionActivityIds.slice(i, i + batchSize);
          const results = await Promise.all(
            batch.map(async (activityId) => {
              try {
                const apiStreams = await intervalsApi.getActivityStreams(activityId, ['time']);
                return { activityId, times: apiStreams.time || [] };
              } catch {
                return { activityId, times: [] as number[] };
              }
            })
          );

          for (const result of results) {
            if (result.times.length > 0) {
              streamsToSync.push(result);
            }
          }
        }

        if (!cancelled && streamsToSync.length > 0) {
          // Sync time streams to Rust engine
          routeEngine.setTimeStreams(streamsToSync);
          setPerformanceDataReady(true);
        }
      } catch {
        // Ignore errors
      }
    };

    fetchTimeStreams();
    return () => {
      cancelled = true;
    };
  }, [activeTab, sectionActivityIds]);

  // Get best time for a section from Rust engine (uses synced time streams)
  const getSectionBestTime = useCallback(
    (sectionId: string): number | undefined => {
      if (!performanceDataReady) return undefined;
      try {
        const result = routeEngine.getSectionPerformances(sectionId);
        return result?.bestRecord?.bestTime;
      } catch {
        return undefined;
      }
    },
    [performanceDataReady]
  );

  return { performanceDataReady, getSectionBestTime };
}
