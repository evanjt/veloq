/**
 * Route delegates.
 *
 * Wraps route group CRUD, performance queries, representative polylines, exclusion
 * management, and the batched Routes screen payload. Mutations emit notifications
 * on the 'groups' channel so route lists re-fetch after rename/exclude.
 */

import type {
  FfiRouteGroup,
  FfiRouteDetailData,
  FfiRoutePerformanceResult,
  FfiRoutesScreenData,
  FfiRoutesScreenQuery,
  FfiSectionPerformanceData,
  GroupSummary,
  LiveRouteOverlap,
} from '../generated/veloqrs';
import { FfiPerformanceSubject } from '../generated/veloqrs';
import { validateId, validateName } from '../conversions';
import type { DelegateHost } from './host';

const EMPTY_ROUTE_PERFORMANCE_RESULT: FfiRoutePerformanceResult = {
  performances: [],
  activityMetrics: [],
  attemptCount: 0,
  trendCurves: {},
  histograms: {},
};

export function getGroups(host: DelegateHost): FfiRouteGroup[] {
  if (!host.ready) return [];
  return host.timed('getGroups', () => host.engine.routes().getAll());
}

export type GroupSortKey = 'count' | 'name';

/**
 * Filtered + sorted group summaries in a single FFI call. Activity-count
 * threshold and sort key are applied in Rust so `useGroupSummaries` /
 * `useRouteGroups` stop re-iterating in TS.
 */
export function getFilteredGroupSummaries(
  host: DelegateHost,
  minActivities: number,
  sortKey: GroupSortKey
): { totalCount: number; summaries: GroupSummary[] } {
  if (!host.ready) return { totalCount: 0, summaries: [] };
  return host.timed('getFilteredGroupSummaries', () =>
    host.engine.routes().getSummaries(minActivities, sortKey)
  );
}

/** The engine's refusal text for a name another route is already shown under. */
const ROUTE_NAME_TAKEN_MESSAGE = 'Another route is already named';

export function isRouteNameTakenError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes(ROUTE_NAME_TAKEN_MESSAGE);
}

/** Throws the engine's refusal when another route is already shown under `name`. */
export function setRouteName(host: DelegateHost, routeId: string, name: string): void {
  validateId(routeId, 'route ID');
  validateName(name, 'route name');
  host.write('setRouteName', () => {
    host.engine.routes().setName(routeId, name);
    host.notify('groups');
  });
}

/** No track at all, in the encoded form the engine returns. */
const EMPTY_TRACK = new Uint8Array([]).buffer;

export function getRepresentativeRoute(host: DelegateHost, groupId: string): ArrayBuffer {
  if (!host.ready) return EMPTY_TRACK;
  validateId(groupId, 'group ID');
  return host.timed('getRepresentativeRoute', () =>
    host.engine.routes().getRepresentativeRoute(groupId)
  );
}

export function liveRouteOverlaps(
  host: DelegateHost,
  groupIds: string[],
  coordinates: number[]
): Promise<LiveRouteOverlap[]> {
  if (!host.ready || groupIds.length === 0) return Promise.resolve([]);
  return host.engine.routes().liveOverlaps(groupIds, coordinates);
}

export function getRoutePerformances(
  host: DelegateHost,
  routeGroupId: string,
  currentActivityId: string,
  sportType?: string
): FfiRoutePerformanceResult {
  if (!host.ready) {
    return EMPTY_ROUTE_PERFORMANCE_RESULT;
  }
  validateId(routeGroupId, 'route group ID');
  if (currentActivityId !== '') {
    validateId(currentActivityId, 'activity ID');
  }
  return host.timed('getRoutePerformances', () =>
    host.engine.routes().getPerformances(routeGroupId, currentActivityId || undefined, sportType)
  );
}

export function excludeActivityFromRoute(
  host: DelegateHost,
  routeId: string,
  activityId: string
): void {
  host.write('excludeActivityFromRoute', () => {
    host.engine.routes().excludeActivity(routeId, activityId);
    host.notify('groups');
  });
}

export function includeActivityInRoute(
  host: DelegateHost,
  routeId: string,
  activityId: string
): void {
  host.write('includeActivityInRoute', () => {
    host.engine.routes().includeActivity(routeId, activityId);
    host.notify('groups');
  });
}

export function getRoutesScreenData(
  host: DelegateHost,
  query: FfiRoutesScreenQuery
): FfiRoutesScreenData | undefined {
  if (!host.ready) return undefined;
  // The first page is read while the screen mounts; every later page is read
  // from a scroll, so it is held to the frame budget.
  const place = query.groupOffset === 0 && query.sectionOffset === 0 ? 'mount' : 'gesture';
  return host.timed('getRoutesScreenData', () => host.engine.routes().getScreenData(query), place);
}

/**
 * Choose the route's representative on a Rust thread, since every member is
 * measured again against the new representative's track. Resolves false when
 * the engine refuses the choice, including while another is running.
 */
export async function setRouteRepresentative(
  host: DelegateHost,
  routeId: string,
  activityId: string
): Promise<boolean> {
  if (!host.ready) return false;
  validateId(routeId, 'route ID');
  validateId(activityId, 'activity ID');
  try {
    await host.timedAsync('setRouteRepresentative', () =>
      host.engine.routes().setRepresentative(routeId, activityId)
    );
    host.notify('groups');
    return true;
  } catch (e) {
    console.error('[Engine] setRouteRepresentative failed:', routeId, activityId, e);
    return false;
  }
}

/** Restore the representative grouping chose, on a Rust thread. */
export async function resetRouteRepresentative(
  host: DelegateHost,
  routeId: string
): Promise<boolean> {
  if (!host.ready) return false;
  validateId(routeId, 'route ID');
  try {
    await host.timedAsync('resetRouteRepresentative', () =>
      host.engine.routes().setRepresentative(routeId, undefined)
    );
    host.notify('groups');
    return true;
  } catch (e) {
    console.error('[Engine] resetRouteRepresentative failed:', routeId, e);
    return false;
  }
}

/**
 * Everything the route detail screen paints with that one sport and one range
 * do not change: engine counts, the route and its shown name, the
 * representative polyline and headline, exclusions and per-activity
 * signatures. It carries nothing of any other route.
 */
export type RouteDetailData = FfiRouteDetailData;

export function getRouteDetailData(
  host: DelegateHost,
  groupId: string
): RouteDetailData | undefined {
  if (!host.ready || !groupId) return undefined;
  return host.timed('getRouteDetailData', () => host.engine.routes().getDetailData(groupId));
}

/**
 * The route detail reads that answer one sport and one range, in the section
 * performance read's shape: chart, calendar, ranged bests, trend, histogram,
 * correlations, sport counts and excluded attempts. The delta curves come only
 * once held, and `curvesPending` says when they are owed.
 */
export function getRouteDetailPerformance(
  host: DelegateHost,
  groupId: string,
  timeRangeDays: number,
  sportFilter?: string,
  highlightActivityId?: string
): FfiSectionPerformanceData | undefined {
  if (!host.ready || !groupId) return undefined;
  return host.timed('getRouteDetailPerformance', () =>
    host.engine
      .routes()
      .getDetailPerformance(groupId, timeRangeDays, sportFilter, highlightActivityId)
  );
}

/**
 * The same read with the delta curves computed, on a Rust thread. Rejects with
 * the engine's message when the read fails.
 */
export async function loadRouteDetailPerformance(
  host: DelegateHost,
  groupId: string,
  timeRangeDays: number,
  sportFilter?: string,
  highlightActivityId?: string
): Promise<FfiSectionPerformanceData | undefined> {
  if (!host.ready || !groupId) return undefined;
  return host.timedAsync('loadRouteDetailPerformance', () =>
    host.engine
      .sections()
      .loadDetailPerformance(
        FfiPerformanceSubject.Route,
        groupId,
        timeRangeDays,
        sportFilter,
        highlightActivityId
      )
  );
}
