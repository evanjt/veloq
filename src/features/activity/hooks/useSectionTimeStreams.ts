import { useState, useEffect, useMemo, useCallback } from 'react';
import { routeEngine } from 'veloqrs';
import type { SectionMatch } from '@/features/routes/hooks/useSectionMatches';
import type { Section } from '@/types';

/** How long to wait for Rust to finish a time-stream batch before rendering
 *  whatever landed. Section times only sharpen as more streams arrive. */
const TIME_STREAM_TIMEOUT_MS = 30_000;
const TIME_STREAM_POLL_MS = 400;

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
    // Rust fetches only the activities that have no stored stream, through
    // the same governor as every other request, and persists them itself.
    const fetchTimeStreams = async () => {
      routeEngine.syncTimeStreams(sectionActivityIds);

      // Poll until nothing is missing. There is no push from Rust into the JS
      // listener map, so completion is observed rather than delivered.
      const deadline = Date.now() + TIME_STREAM_TIMEOUT_MS;
      while (!cancelled && Date.now() < deadline) {
        if (routeEngine.getMissingTimeStreams(sectionActivityIds).length === 0) {
          if (!cancelled) setPerformanceDataReady(true);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, TIME_STREAM_POLL_MS));
      }
      // A partial fetch still helps: the sections that did land can render.
      if (!cancelled) setPerformanceDataReady(true);
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
