import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getEngine } from '@/shared/native/engine';
import { attemptEngineRead } from '@/shared/native/engineError';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { decodeCoords } from 'veloqrs';
import type {
  ActivityHighlightsBundle,
  ActivityLedgerChange,
  ActivityFitnessImpact,
  ExerciseGroup,
  RouteGroup,
  HrZoneBand,
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
  exerciseGroups: ExerciseGroup[];
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
  /** The max HR the stat card and the zones chart divide by, resolved by the engine */
  maxHR: number;
  /** The zone bands and the time in each, from the engine; empty with no heart rate time */
  hrZones: HrZoneBand[];
  /** This activity's contribution against a rest day, when it has training load. */
  fitnessImpact?: ActivityFitnessImpact | undefined;
  /** Section changes whose ledger rows name this activity, newest first */
  ledgerChanges: ActivityLedgerChange[];
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

/** A bundle read: the bundle, or the error the engine threw instead of one. */
interface DetailRead {
  data: ActivityDetailBundle | null;
  error: unknown;
}

const NOTHING_READ: DetailRead = { data: null, error: undefined };

/**
 * Fetch the bundle for one activity. Shared by the synchronous first paint
 * and the manual refresh so both run the same pipeline.
 */
function fetchActivityDetailData(activityId: string): DetailRead {
  const engine = getEngine();
  if (!engine || !activityId) return NOTHING_READ;

  const attempt = attemptEngineRead(() =>
    engine.getActivityDetailData(activityId, MIN_ROUTE_ACTIVITIES)
  );
  if (!attempt.ok) return { data: null, error: attempt.error };
  const result = attempt.value;
  if (!result) return NOTHING_READ;

  return {
    data: {
      exerciseGroups: result.exerciseGroups,
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
      maxHR: result.maxHr,
      hrZones: result.hrZones,
      fitnessImpact: result.fitnessImpact,
      ledgerChanges: result.ledgerChanges,
    },
    error: undefined,
  };
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
  const { data: bundle } = fetchActivityDetailData(activityId);
  if (!bundle) return;

  prefetched = { activityId, bundle };
  const engine = getEngine();
  if (!engine) return;
  const unsubscribes = PREFETCH_EVENTS.map((event) => engine.subscribe(event, dropPrefetch));
  unsubscribes.push(
    engine.subscribe('bodyStored', (payload) => {
      if (isDetailBodyFor(payload, activityId)) dropPrefetch();
    }),
    engine.subscribe('timeStreamsStored', (payload) => {
      if (isTimeStreamFor(payload, activityId)) dropPrefetch();
    })
  );
  releasePrefetch = () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}

/**
 * Whether an announcement is a body landing that the bundle is built from for
 * this activity. The detail body carries fields the lighter list body lacks,
 * the activity's own heart rate zones among them, and the stream body carries
 * the heart rate and time series the saved zone times are computed from. Both
 * announce on `bodyStored` rather than `activities`.
 */
function isDetailBodyFor(payload: unknown, activityId: string): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const body = payload as { kind?: unknown; activityId?: unknown };
  return (
    (body.kind === 'activity_detail' || body.kind === 'streams') && body.activityId === activityId
  );
}

/** Whether a `timeStreamsStored` announcement names this activity. */
function isTimeStreamFor(payload: unknown, activityId: string): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const { activityIds } = payload as { activityIds?: unknown };
  return Array.isArray(activityIds) && activityIds.includes(activityId);
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
): { data: ActivityDetailBundle | null; error: unknown; refresh: () => void } {
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

  const initial = useMemo((): DetailRead => {
    if (!enabled || !activityId) return NOTHING_READ;
    const prefetchedBundle = takePrefetched(activityId);
    if (prefetchedBundle) return { data: prefetchedBundle, error: undefined };
    return readEngine(() => fetchActivityDetailData(activityId)) ?? NOTHING_READ;
  }, [activityId, enabled, readEngine]);

  // `refresh()` re-reads the bundle out of band, so the state holds its result
  // until the memo above reads a newer one. Retiring it while rendering rather
  // than in an effect drops a render pass and, with it, the frame that showed
  // the superseded bundle. A failed read keeps the bundle already held and
  // carries the error beside it.
  const [read, setRead] = useState<DetailRead>(initial);
  const [readFor, setReadFor] = useState(initial);
  if (initial !== readFor) {
    setReadFor(initial);
    if (initial.data || initial.error !== undefined) {
      setRead((held) => ({ data: initial.data ?? held.data, error: initial.error }));
    }
  }

  const refresh = useCallback(() => {
    if (!isMountedRef.current || !activityId) return;
    const result = fetchActivityDetailData(activityId);
    if (!isMountedRef.current) return;
    if (result.data) {
      setRead(result);
    } else if (result.error !== undefined) {
      setRead((held) => ({ data: held.data, error: result.error }));
    }
  }, [activityId]);

  // The detail body and the streams can land after the screen opens.
  useEffect(() => {
    const engine = enabled && activityId ? getEngine() : null;
    if (!engine || !activityId) return undefined;
    const offBody = engine.subscribe('bodyStored', (payload) => {
      if (isDetailBodyFor(payload, activityId)) refresh();
    });
    const offTime = engine.subscribe('timeStreamsStored', (payload) => {
      if (isTimeStreamFor(payload, activityId)) refresh();
    });
    return () => {
      offBody();
      offTime();
    };
  }, [activityId, enabled, refresh]);

  return { data: read.data ?? initial.data, error: read.error, refresh };
}
