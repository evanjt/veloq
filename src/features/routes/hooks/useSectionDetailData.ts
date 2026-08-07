import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getRouteEngine } from '@/shared/native/routeEngine';
import { useEngineSubscription } from '@/features/routes/hooks/useRouteEngine';
import type {
  ActivityMetrics,
  FrequentSection as NativeFrequentSection,
  MergeCandidate,
  NearbySectionSummary,
  SectionDetailData,
  SectionPerformanceData,
} from 'veloqrs';

/** Map overlay radius the section detail screen has always used. */
export const NEARBY_RADIUS_METERS = 500;

/**
 * The section detail reads that do not depend on time streams.
 *
 * The screen used to make nine reads here. The individual hooks still exist
 * for their other callers and take these fields as pre-computed input.
 */
export interface SectionDetailBundle {
  activityCount: number;
  section: NativeFrequentSection | undefined;
  nearby: NearbySectionSummary[];
  mergeCandidates: MergeCandidate[];
  excludedActivityIds: string[];
  hasOriginalBounds: boolean;
  activityMetrics: ActivityMetrics[];
  mapSignatures: SectionDetailData['mapSignatures'];
  missingTimeStreamIds: string[];
}

function fetchSectionDetailData(sectionId: string): SectionDetailBundle | null {
  const engine = getRouteEngine();
  if (!engine || !sectionId) return null;

  try {
    const result = engine.getSectionDetailData(sectionId, NEARBY_RADIUS_METERS);
    if (!result) return null;

    return {
      activityCount: result.activityCount,
      section: result.section,
      nearby: result.nearby,
      mergeCandidates: result.mergeCandidates,
      excludedActivityIds: result.excludedActivityIds,
      hasOriginalBounds: result.hasOriginalBounds,
      activityMetrics: result.activityMetrics,
      mapSignatures: result.mapSignatures,
      missingTimeStreamIds: result.missingTimeStreamIds,
    };
  } catch {
    return null;
  }
}

/**
 * Single engine call for the stream-independent half of section detail.
 *
 * `refreshKey` re-runs the call after a trim, rename or exclusion change, the
 * way the individual hooks used to re-run on the same signal.
 */
export function useSectionDetailData(
  sectionId: string | undefined,
  refreshKey = 0
): { data: SectionDetailBundle | null; refresh: () => void } {
  const trigger = useEngineSubscription(['sections']);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const initialData = useMemo(
    () => (sectionId ? fetchSectionDetailData(sectionId) : null),
    [sectionId, refreshKey, trigger]
  );

  const [data, setData] = useState<SectionDetailBundle | null>(initialData);

  useEffect(() => {
    if (initialData) {
      setData(initialData);
    }
  }, [initialData]);

  const refresh = useCallback(() => {
    if (!isMountedRef.current || !sectionId) return;
    const result = fetchSectionDetailData(sectionId);
    if (result && isMountedRef.current) {
      setData(result);
    }
  }, [sectionId]);

  return { data: data ?? initialData, refresh };
}

/**
 * Single engine call for the lap-time half of section detail: performance
 * records, chart payload and calendar summary.
 *
 * `enabled` stays false until the missing time streams have been fetched, so
 * the records are not read against a half-populated cache.
 */
export function useSectionDetailPerformance(
  sectionId: string | undefined,
  timeRangeDays: number,
  sportFilter: string | undefined,
  enabled: boolean
): SectionPerformanceData | null {
  const trigger = useEngineSubscription(['sections']);

  return useMemo(() => {
    if (!enabled || !sectionId) return null;
    const engine = getRouteEngine();
    if (!engine) return null;
    try {
      return engine.getSectionDetailPerformance(sectionId, timeRangeDays, sportFilter) ?? null;
    } catch {
      return null;
    }
  }, [sectionId, timeRangeDays, sportFilter, enabled, trigger]);
}
