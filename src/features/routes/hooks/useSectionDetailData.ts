import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getEngine } from '@/shared/native/engine';
import { useEngineSubscription } from '@/features/routes/hooks/useEngine';
import type {
  ActivityMetrics,
  MergeCandidate,
  NearbySectionSummary,
  Section as NativeSection,
  SectionDetailData,
  SectionPerformanceData,
  EfficiencyTrend,
} from 'veloqrs';

/** Map overlay radius the section detail screen has always used. */
export const NEARBY_RADIUS_METERS = 500;

/**
 * The section detail reads that do not depend on time streams.
 *
 * The screen used to make nine reads here. The individual hooks still exist
 * for their other callers and take these fields as pre-computed input. The
 * ledger, the excluded laps and the efficiency trend joined them once the
 * count crept back to seven: all three are keyed on the section id alone, so
 * there was never a reason for them to be their own lock acquisitions.
 */
export interface SectionDetailBundle {
  activityCount: number;
  section: NativeSection | undefined;
  nearby: NearbySectionSummary[];
  mergeCandidates: MergeCandidate[];
  excludedActivityIds: string[];
  hasOriginalBounds: boolean;
  activityMetrics: ActivityMetrics[];
  mapSignatures: SectionDetailData['mapSignatures'];
  missingTimeStreamIds: string[];
  history: SectionDetailData['history'];
  geometryVersions: SectionDetailData['geometryVersions'];
  pinnedVersion: SectionDetailData['pinnedVersion'];
  excludedLaps: SectionDetailData['excludedLaps'];
  efficiencyTrend: EfficiencyTrend | null;
}

function fetchSectionDetailData(sectionId: string): SectionDetailBundle | null {
  const engine = getEngine();
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
      history: result.history,
      geometryVersions: result.geometryVersions,
      pinnedVersion: result.pinnedVersion,
      excludedLaps: result.excludedLaps,
      efficiencyTrend: result.efficiencyTrend ?? null,
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

  // `refresh()` re-reads the bundle out of band, so the state holds its result
  // until the memo above reads a newer one. Retiring it while rendering rather
  // than in an effect drops a render pass and, with it, the frame that showed
  // the superseded bundle.
  const [data, setData] = useState<SectionDetailBundle | null>(initialData);
  const [dataFor, setDataFor] = useState(initialData);
  if (initialData && initialData !== dataFor) {
    setDataFor(initialData);
    setData(initialData);
  }

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
    const engine = getEngine();
    if (!engine) return null;
    try {
      return engine.getSectionDetailPerformance(sectionId, timeRangeDays, sportFilter) ?? null;
    } catch {
      return null;
    }
  }, [sectionId, timeRangeDays, sportFilter, enabled, trigger]);
}
