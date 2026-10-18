import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getEngine } from '@/shared/native/engine';
import {
  classifyDetailRead,
  type DetailRead,
  type DetailReadStatus,
} from '../lib/detailReadResult';
import { attemptEngineRead } from '@/shared/native/engineError';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { decodeCoords, routes } from 'veloqrs';
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
 * the records are not read against a half-populated cache. The delta curves
 * can take longer to compute than a tap may block, so the call serves them
 * only once the engine holds them: while it says they are owed, the same read
 * with the curves is loaded off the JS thread and stands in for this one.
 * `highlightActivityId` is the attempt the scatter's focus range always holds.
 */
export function useSectionDetailPerformance(
  sectionId: string | undefined,
  timeRangeDays: number,
  sportFilter: string | undefined,
  enabled: boolean,
  refreshKey = 0,
  highlightActivityId?: string
): { data: SectionPerformanceData | null; error: unknown } {
  const readPerformance = useEngineRead(['sections', 'detectionApplied'], [refreshKey]);

  const read = useMemo(() => {
    if (!enabled || !sectionId) return { data: null, error: undefined };
    const result = readPerformance((engine) =>
      attemptEngineRead(
        () =>
          engine.getSectionDetailPerformance(
            sectionId,
            timeRangeDays,
            sportFilter,
            highlightActivityId
          ) ?? null
      )
    );
    if (!result) return { data: null, error: undefined };
    return result.ok
      ? { data: result.value, error: undefined }
      : { data: null, error: result.error };
  }, [sectionId, timeRangeDays, sportFilter, highlightActivityId, enabled, readPerformance]);

  return useLoadedCurves(
    read,
    'section',
    sectionId,
    timeRangeDays,
    sportFilter,
    highlightActivityId,
    enabled
  );
}

/**
 * A detail screen's performance read, or the same read with the delta curves
 * loaded off the JS thread while the screen's own read says they are owed and
 * `ready` says the streams they are drawn from have landed. The loaded read is
 * kept beside the read it stands in for, so a newer read is never covered by
 * an older load.
 */
function useLoadedCurves(
  read: { data: SectionPerformanceData | null; error: unknown },
  subject: 'section' | 'route',
  id: string | undefined,
  timeRangeDays: number,
  sportFilter: string | undefined,
  highlightActivityId: string | undefined,
  ready: boolean
): { data: SectionPerformanceData | null; error: unknown } {
  const [loaded, setLoaded] = useState<{
    for: SectionPerformanceData;
    data: SectionPerformanceData;
  } | null>(null);
  const owed = read.data?.curvesPending ? read.data : null;
  useEffect(() => {
    const engine = getEngine();
    if (!owed || !ready || !id || !engine) return undefined;
    let live = true;
    const load =
      subject === 'section'
        ? engine.loadSectionDetailPerformance(id, timeRangeDays, sportFilter, highlightActivityId)
        : routes.loadRouteDetailPerformance(id, timeRangeDays, sportFilter, highlightActivityId);
    load
      .then((data) => {
        if (live && data) setLoaded({ for: owed, data });
      })
      .catch(() => {
        // empty-on-error: the curves stay owed and the plot is not offered; every
        // figure the read already drew stands.
      });
    return () => {
      live = false;
    };
  }, [owed, ready, subject, id, timeRangeDays, sportFilter, highlightActivityId]);

  if (loaded && read.data && loaded.for === read.data) {
    return { data: loaded.data, error: undefined };
  }
  return read;
}

/**
 * Single engine call for a route's attempt times in the section performance
 * read's shape: chart, calendar, ranged bests, trend, histogram, delta curves,
 * sport counts and excluded attempts, for one sport and one range.
 *
 * `refreshKey` re-runs the call after an exclusion or a reference change. The
 * attempt times are moving times and need no stream, so the call does not
 * wait for them. The delta curves can take longer to compute than a tap may
 * block, so the call serves them only once the engine holds them: while it
 * says they are owed and `streamsReady` says the streams they are drawn from
 * have landed, the same read with the curves is loaded off the JS thread and
 * stands in for this one. `highlightActivityId` is the attempt the scatter's
 * focus range always holds.
 */
export function useRouteDetailPerformance(
  groupId: string | undefined,
  timeRangeDays: number,
  sportFilter: string | undefined,
  refreshKey = 0,
  streamsReady = true,
  highlightActivityId?: string
): { data: SectionPerformanceData | null; error: unknown } {
  const readPerformance = useEngineRead(['groups', 'detectionApplied'], [refreshKey, streamsReady]);

  const read = useMemo(() => {
    if (!groupId) return { data: null, error: undefined };
    const result = readPerformance(() =>
      attemptEngineRead(
        () =>
          routes.getRouteDetailPerformance(
            groupId,
            timeRangeDays,
            sportFilter,
            highlightActivityId
          ) ?? null
      )
    );
    if (!result) return { data: null, error: undefined };
    return result.ok
      ? { data: result.value, error: undefined }
      : { data: null, error: result.error };
  }, [groupId, timeRangeDays, sportFilter, highlightActivityId, readPerformance]);

  return useLoadedCurves(
    read,
    'route',
    groupId,
    timeRangeDays,
    sportFilter,
    highlightActivityId,
    streamsReady
  );
}
