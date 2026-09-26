import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getEngine } from '@/shared/native/engine';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { decodeCoords } from 'veloqrs';
import type {
  ActivityHighlightsBundle,
  RouteGroup,
  Section as NativeSection,
  SectionEncounter,
  SectionWithPolyline,
} from 'veloqrs';
import type { LatLng } from '@/shared/geo/polyline';

/**
 * Everything the activity detail screen paints with, from one engine call.
 *
 * The screen used to make nine reads plus one trace extraction per matched
 * section. The individual hooks still exist for their other callers and take
 * these fields as pre-computed input instead of querying again.
 */
export interface ActivityDetailBundle {
  /** Activities held by the engine, for the cached-days calculation */
  activityCount: number;
  /** Sections held by the engine */
  sectionCount: number;
  /** Route groups above the requested minimum, most attempts first */
  routeGroups: RouteGroup[];
  /** Route group total before the minimum-activity filter */
  /** Visible sections this activity traverses, in the light record */
  matchedSections: SectionWithPolyline[];
  /** Every visible custom section, matched or not */
  customSections: NativeSection[];
  /** One entry per (section, direction) this activity encountered */
  encounters: SectionEncounter[];
  /** Section indicators and route highlights for this activity */
  highlights: ActivityHighlightsBundle;
  /** This activity's portion of each section, keyed by section ID */
  sectionTraces: Record<string, LatLng[]>;
  /** Sections where this activity holds the record */
  prSectionIds: Set<string>;
}

/** Route groups on the detail screen need at least this many attempts. */
export const MIN_ROUTE_ACTIVITIES = 1;

function buildTraces(
  traces: readonly { sectionId: string; encodedCoords: ArrayBuffer }[]
): Record<string, LatLng[]> {
  const byId: Record<string, LatLng[]> = {};
  for (const trace of traces) {
    const coords = decodeCoords(trace.encodedCoords).filter(
      (p) => !isNaN(p.latitude) && !isNaN(p.longitude)
    );
    if (coords.length > 0) {
      byId[trace.sectionId] = coords;
    }
  }
  return byId;
}

/**
 * Fetch the bundle for one activity. Shared by the synchronous first paint
 * and the manual refresh so both run the same pipeline.
 */
function fetchActivityDetailData(activityId: string): ActivityDetailBundle | null {
  const engine = getEngine();
  if (!engine || !activityId) return null;

  try {
    const result = engine.getActivityDetailData(activityId, MIN_ROUTE_ACTIVITIES);
    if (!result) return null;

    return {
      activityCount: result.activityCount,
      sectionCount: result.sectionCount,
      routeGroups: result.routeGroups,
      matchedSections: result.matchedSections,
      customSections: result.customSections,
      encounters: result.encounters,
      highlights: {
        indicators: result.highlights.indicators,
        routeHighlights: result.highlights.routeHighlights,
      },
      sectionTraces: buildTraces(result.sectionTraces),
      prSectionIds: new Set(result.prSectionIds),
    };
  } catch {
    return null;
  }
}

/** Channels that make a bundle read before navigation out of date. */
const PREFETCH_EVENTS = ['activities', 'groups', 'sections'] as const;

let prefetched: { activityId: string; bundle: ActivityDetailBundle } | null = null;
let releasePrefetch: (() => void) | null = null;

function dropPrefetch(): void {
  prefetched = null;
  releasePrefetch?.();
  releasePrefetch = null;
}

/**
 * Read the bundle when the athlete opens an activity, before the push
 * animation starts, so the detail screen has it on its first render. The
 * transition then covers the read instead of following it.
 *
 * The bundle is held until the screen takes it or the engine reports a change
 * on one of the channels it was built from, so a press that never lands
 * cannot paint a stale screen later.
 */
export function prefetchActivityDetailData(activityId: string): void {
  dropPrefetch();
  const bundle = fetchActivityDetailData(activityId);
  if (!bundle) return;

  prefetched = { activityId, bundle };
  const engine = getEngine();
  if (!engine) return;
  const unsubscribes = PREFETCH_EVENTS.map((event) => engine.subscribe(event, dropPrefetch));
  releasePrefetch = () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}

function takePrefetched(activityId: string): ActivityDetailBundle | null {
  if (prefetched?.activityId !== activityId) return null;
  const { bundle } = prefetched;
  dropPrefetch();
  return bundle;
}

/**
 * Single engine call covering the activity detail screen's route match,
 * section matches, encounters, highlights, overlays and engine counts.
 *
 * The first render takes what `prefetchActivityDetailData` left, and reads for
 * itself when there is none. Pass `enabled: false` to skip the call entirely.
 */
export function useActivityDetailData(
  activityId: string | undefined,
  enabled = true
): { data: ActivityDetailBundle | null; refresh: () => void } {
  // The reader is the re-read key: its identity moves when one of these
  // channels fires, and the memo below reads it rather than listing a counter
  // it never touches.
  const readEngine = useEngineRead(['activities', 'groups', 'sections']);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const initialData = useMemo(
    () =>
      enabled && activityId
        ? (takePrefetched(activityId) ??
          readEngine(() => fetchActivityDetailData(activityId)) ??
          null)
        : null,
    [activityId, enabled, readEngine]
  );

  // `refresh()` re-reads the bundle out of band, so the state holds its result
  // until the memo above reads a newer one. Retiring it while rendering rather
  // than in an effect drops a render pass and, with it, the frame that showed
  // the superseded bundle.
  const [data, setData] = useState<ActivityDetailBundle | null>(initialData);
  const [dataFor, setDataFor] = useState(initialData);
  if (initialData && initialData !== dataFor) {
    setDataFor(initialData);
    setData(initialData);
  }

  const refresh = useCallback(() => {
    if (!isMountedRef.current || !activityId) return;
    const result = fetchActivityDetailData(activityId);
    if (result && isMountedRef.current) {
      setData(result);
    }
  }, [activityId]);

  return { data: data ?? initialData, refresh };
}
