import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getEngine } from '@/shared/native/engine';
import {
  classifyDetailRead,
  type DetailRead,
  type DetailReadStatus,
} from '../lib/detailReadResult';
import { attemptEngineRead } from '@/shared/native/engineError';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { decodeCoords } from 'veloqrs';
import type {
  MergeCandidate,
  Section as NativeSection,
  SectionDetailData,
  SectionPerformanceData,
} from 'veloqrs';
import type { RoutePoint } from '@/types';

/**
 * The section detail reads that do not depend on time streams.
 *
 * The screen used to make nine reads here. The individual hooks still exist
 * for their other callers and take these fields as pre-computed input. The
 * ledger and the excluded laps joined them once the count crept back to
 * seven: both are keyed on the section id alone, so there was never a reason
 * for them to be their own lock acquisitions.
 */
export interface SectionDetailBundle {
  activityCount: number;
  section: NativeSection | undefined;
  mergeCandidates: MergeCandidate[];
  excludedActivityIds: string[];
  hasOriginalBounds: boolean;
  activityRows: SectionDetailData['activityRows'];
  mapSignatures: SectionDetailData['mapSignatures'];
  missingTimeStreamIds: string[];
  history: SectionDetailData['history'];
  geometryVersions: SectionDetailData['geometryVersions'];
  pinnedVersion: SectionDetailData['pinnedVersion'];
  /** Whether the athlete may ask for a name from the section's places. */
  canNameFromPlaces: boolean;
}

/** How a section that no longer has a row left the catalogue. */
export type SectionDeparture = NonNullable<SectionDetailData['retirement']>;

type SectionDetailRead = DetailRead<SectionDetailBundle> & { retirement: SectionDeparture | null };

type Engine = NonNullable<ReturnType<typeof getEngine>>;

function fetchSectionDetailData(engine: Engine, sectionId: string): SectionDetailRead {
  if (!sectionId) return { status: { kind: 'missing' }, data: null, retirement: null };

  let retirement: SectionDeparture | null = null;
  const read = classifyDetailRead(
    () => {
      const result = engine.getSectionDetailData(sectionId);
      retirement = result?.section ? null : (result?.retirement ?? null);
      return result;
    },
    (result): SectionDetailBundle => ({
      activityCount: result.activityCount,
      section: result.section,
      mergeCandidates: result.mergeCandidates,
      excludedActivityIds: result.excludedActivityIds,
      hasOriginalBounds: result.hasOriginalBounds,
      activityRows: result.activityRows,
      mapSignatures: result.mapSignatures,
      missingTimeStreamIds: result.missingTimeStreamIds,
      history: result.history,
      geometryVersions: result.geometryVersions,
      pinnedVersion: result.pinnedVersion,
      canNameFromPlaces: result.canNameFromPlaces,
    }),
    (result) => !result.section
  );
  return { ...read, retirement };
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
): {
  data: SectionDetailBundle | null;
  status: DetailReadStatus;
  /** Set only while the status is missing and the ledger knows how the section left. */
  retirement: SectionDeparture | null;
  refresh: () => void;
  allActivityTraces: Record<string, RoutePoint[]> | undefined;
} {
  const readSection = useEngineRead(['sections', 'detectionApplied'], [refreshKey]);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const initial = useMemo<SectionDetailRead>(
    () =>
      (sectionId
        ? readSection((engine) => fetchSectionDetailData(engine, sectionId))
        : undefined) ?? { status: { kind: 'closed' }, data: null, retirement: null },
    [sectionId, readSection]
  );
  const initialData = initial.data;

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
    const engine = getEngine();
    if (!isMountedRef.current || !sectionId || !engine) return;
    const result = fetchSectionDetailData(engine, sectionId);
    if (result.data && isMountedRef.current) {
      setData(result.data);
    }
  }, [sectionId]);

  const bundledSignatures = (data ?? initialData)?.mapSignatures;
  const allActivityTraces = useMemo(() => {
    if (!bundledSignatures?.length) return undefined;
    try {
      const traces: Record<string, RoutePoint[]> = {};
      for (const signature of bundledSignatures) {
        const points = decodeCoords(signature.encodedCoords).map((point) => ({
          lat: point.latitude,
          lng: point.longitude,
        }));
        if (points.length >= 2) traces[signature.activityId] = points;
      }
      return Object.keys(traces).length ? traces : undefined;
    } catch {
      // empty-on-error: malformed display traces do not affect the section's figures.
      return undefined;
    }
  }, [bundledSignatures]);

  return {
    data: data ?? initialData,
    status: initial.status,
    retirement: initial.retirement,
    refresh,
    allActivityTraces,
  };
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
  enabled: boolean,
  refreshKey = 0
): { data: SectionPerformanceData | null; error: unknown } {
  const readPerformance = useEngineRead(['sections', 'detectionApplied'], [refreshKey]);

  return useMemo(() => {
    if (!enabled || !sectionId) return { data: null, error: undefined };
    const read = readPerformance((engine) =>
      attemptEngineRead(
        () => engine.getSectionDetailPerformance(sectionId, timeRangeDays, sportFilter) ?? null
      )
    );
    if (!read) return { data: null, error: undefined };
    return read.ok ? { data: read.value, error: undefined } : { data: null, error: read.error };
  }, [sectionId, timeRangeDays, sportFilter, enabled, readPerformance]);
}

/**
 * Single engine call for a route's attempt times in the section performance
 * read's shape: chart, calendar, ranged bests, trend, histogram, sport counts
 * and excluded attempts, for one sport and one range.
 *
 * `refreshKey` re-runs the call after an exclusion or a reference change.
 */
export function useRouteDetailPerformance(
  groupId: string | undefined,
  timeRangeDays: number,
  sportFilter: string | undefined,
  refreshKey = 0
): { data: SectionPerformanceData | null; error: unknown } {
  const readPerformance = useEngineRead(['groups', 'detectionApplied'], [refreshKey]);

  return useMemo(() => {
    if (!groupId) return { data: null, error: undefined };
    const read = readPerformance((engine) =>
      attemptEngineRead(
        () => engine.getRouteDetailPerformance(groupId, timeRangeDays, sportFilter) ?? null
      )
    );
    if (!read) return { data: null, error: undefined };
    return read.ok ? { data: read.value, error: undefined } : { data: null, error: read.error };
  }, [groupId, timeRangeDays, sportFilter, readPerformance]);
}
