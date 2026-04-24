/**
 * Route delegates.
 *
 * Wraps route group CRUD, performance queries, consensus polylines, exclusion
 * management, and the batched Routes screen payload. Mutations emit notifications
 * on the 'groups' channel so route lists re-fetch after rename/exclude.
 */

import type {
  FfiGpsPoint,
  FfiRouteGroup,
  FfiRoutePerformanceResult,
  FfiRoutesScreenData,
  GroupSummary,
} from '../generated/veloqrs';
import type { FfiActivityRouteHighlight } from './shared-types';
import { validateId, validateName } from '../conversions';
import type { DelegateHost } from './host';

const EMPTY_ROUTE_PERFORMANCE_RESULT: FfiRoutePerformanceResult = {
  performances: [],
  activityMetrics: [],
  best: undefined,
  bestForward: undefined,
  bestReverse: undefined,
  forwardStats: undefined,
  reverseStats: undefined,
  currentRank: undefined,
};

export function getGroups(host: DelegateHost): FfiRouteGroup[] {
  if (!host.ready) return [];
  return host.timed('getGroups', () => host.engine.routes().getAll());
}

export function getGroupSummaries(host: DelegateHost): {
  totalCount: number;
  summaries: GroupSummary[];
} {
  if (!host.ready) return { totalCount: 0, summaries: [] };
  return host.timed('getGroupSummaries', () => host.engine.routes().getSummariesWithCount());
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
    host.engine.routes().getFilteredSummaries(minActivities, sortKey)
  );
}

export function getGroupById(host: DelegateHost, groupId: string): FfiRouteGroup | null {
  if (!host.ready) return null;
  validateId(groupId, 'group ID');
  return host.timed('getGroupById', () => host.engine.routes().getById(groupId)) ?? null;
}

export function setRouteName(host: DelegateHost, routeId: string, name: string): void {
  if (!host.ready) return;
  validateId(routeId, 'route ID');
  validateName(name, 'route name');
  host.timed('setRouteName', () => host.engine.routes().setName(routeId, name));
  host.notify('groups');
}

export function getAllRouteNames(host: DelegateHost): Record<string, string> {
  if (!host.ready) return {};
  const map = host.timed('getAllRouteNames', () => host.engine.routes().getAllNames());
  return Object.fromEntries(map);
}

export function getConsensusRoute(host: DelegateHost, groupId: string): FfiGpsPoint[] {
  if (!host.ready) return [];
  validateId(groupId, 'group ID');
  return host.timed('getConsensusRoute', () => host.engine.routes().getConsensusRoute(groupId));
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
  if (!host.ready) return;
  host.timed('excludeActivityFromRoute', () =>
    host.engine.routes().excludeActivity(routeId, activityId)
  );
  host.notify('groups');
}

export function includeActivityInRoute(
  host: DelegateHost,
  routeId: string,
  activityId: string
): void {
  if (!host.ready) return;
  host.timed('includeActivityInRoute', () =>
    host.engine.routes().includeActivity(routeId, activityId)
  );
  host.notify('groups');
}

export function getExcludedRouteActivityIds(host: DelegateHost, routeId: string): string[] {
  if (!host.ready) return [];
  return host.timed('getExcludedRouteActivityIds', () =>
    host.engine.routes().getExcludedActivities(routeId)
  );
}

export function getExcludedRoutePerformances(
  host: DelegateHost,
  routeId: string,
  sportType?: string
): FfiRoutePerformanceResult {
  if (!host.ready) {
    return EMPTY_ROUTE_PERFORMANCE_RESULT;
  }
  return host.timed('getExcludedRoutePerformances', () =>
    host.engine.routes().getExcludedPerformances(routeId, sportType)
  );
}

export function getRoutesScreenData(
  host: DelegateHost,
  groupLimit: number,
  groupOffset: number,
  sectionLimit: number,
  sectionOffset: number,
  minGroupActivityCount: number,
  prioritizeNearestGroups: boolean,
  prioritizeNearestSections: boolean,
  userLat: number,
  userLng: number
): FfiRoutesScreenData | undefined {
  if (!host.ready) return undefined;
  try {
    return host.timed('getRoutesScreenData', () =>
      host.engine
        .routes()
        .getScreenData(
          groupLimit,
          groupOffset,
          sectionLimit,
          sectionOffset,
          minGroupActivityCount,
          prioritizeNearestGroups,
          prioritizeNearestSections,
          userLat,
          userLng
        )
    );
  } catch {
    return undefined;
  }
}

export function setRouteRepresentative(
  host: DelegateHost,
  routeId: string,
  activityId: string
): void {
  if (!host.ready) return;
  validateId(routeId, 'route ID');
  validateId(activityId, 'activity ID');
  host.timed('setRouteRepresentative', () =>
    host.engine.routes().setRepresentative(routeId, activityId)
  );
  host.notify('groups');
}

export function getActivityRouteHighlights(
  host: DelegateHost,
  activityIds: string[]
): FfiActivityRouteHighlight[] {
  if (!host.ready || activityIds.length === 0) return [];
  return host.timed('getActivityRouteHighlights', () =>
    host.engine.routes().getActivityRouteHighlights(activityIds)
  );
}
