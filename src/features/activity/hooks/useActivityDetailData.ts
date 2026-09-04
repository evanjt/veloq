import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getEngine } from '@/shared/native/engine';
import { useEngineSubscription } from '@/features/routes/hooks/useEngine';
import { decodeCoords } from 'veloqrs';
import type {
  ActivityHighlightsBundle,
  RouteGroup,
  Section as NativeSection,
  SectionEncounter,
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
  totalRouteGroupCount: number;
  /** Visible sections this activity traverses */
  matchedSections: NativeSection[];
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
      totalRouteGroupCount: result.totalRouteGroupCount,
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

/**
 * Single engine call covering the activity detail screen's route match,
 * section matches, encounters, highlights, overlays and engine counts.
 *
 * Pass `enabled: false` to hold the call off the push-animation frame.
 */
export function useActivityDetailData(
  activityId: string | undefined,
  enabled: boolean
): { data: ActivityDetailBundle | null; refresh: () => void } {
  const trigger = useEngineSubscription(['activities', 'groups', 'sections']);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const initialData = useMemo(
    () => (enabled && activityId ? fetchActivityDetailData(activityId) : null),
    [activityId, enabled, trigger]
  );

  const [data, setData] = useState<ActivityDetailBundle | null>(initialData);

  useEffect(() => {
    if (initialData) {
      setData(initialData);
    }
  }, [initialData]);

  const refresh = useCallback(() => {
    if (!isMountedRef.current || !activityId) return;
    const result = fetchActivityDetailData(activityId);
    if (result && isMountedRef.current) {
      setData(result);
    }
  }, [activityId]);

  return { data: data ?? initialData, refresh };
}
