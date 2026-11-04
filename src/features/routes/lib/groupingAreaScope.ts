/**
 * The route grouping preview regroups the whole library, but the map shows one
 * riding area. This scopes the preview's verdicts to that area, and names the
 * other areas where the setting also changes routes, so a change is never
 * visible only in a library total.
 *
 * A route belongs to the riding area whose centre is nearest the centre of the
 * route's own box. A route with no box belongs to none: it counts in the
 * library and in no area.
 */

import type { GroupingPreviewDiff } from './groupingParams';

export interface ScopeArea {
  binKey: string;
  lat: number;
  lng: number;
}

interface ScopeRoute {
  groupId: string;
  bounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number } | undefined;
}

export interface AreaTally {
  routeCount: number;
  /** Routes the setting would merge with another route. */
  mergedCount: number;
  /** Routes the setting leaves in no group. */
  droppedCount: number;
  /** Routes whose rides the setting divides between groups. */
  splitCount: number;
}

export interface AreaChange {
  binKey: string;
  mergedCount: number;
  droppedCount: number;
  splitCount: number;
}

export interface ScopedGroupingDiff {
  inArea: AreaTally;
  /** Other areas the setting changes, in the order the areas were given. */
  elsewhere: AreaChange[];
  /** Every route in the selected area, which the map draws. */
  inAreaRouteIds: Set<string>;
  /** The selected area's routes that merge, drop or split. */
  changedRouteIds: Set<string>;
}

/** The area nearest the route's box centre, or null without a box or an area. */
function areaOf(route: ScopeRoute, areas: readonly ScopeArea[]): string | null {
  if (!route.bounds || areas.length === 0) return null;
  const lat = (route.bounds.minLat + route.bounds.maxLat) / 2;
  const lng = (route.bounds.minLng + route.bounds.maxLng) / 2;
  const lngScale = Math.cos((lat * Math.PI) / 180);
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const area of areas) {
    const dLat = area.lat - lat;
    const dLng = (area.lng - lng) * lngScale;
    const distance = dLat * dLat + dLng * dLng;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = area.binKey;
    }
  }
  return best;
}

export function scopeGroupingDiff(
  routes: readonly ScopeRoute[],
  diff: GroupingPreviewDiff,
  areas: readonly ScopeArea[],
  selectedBinKey: string | null
): ScopedGroupingDiff {
  const paintOf = new Map(diff.routes.map((p) => [p.groupId, p]));
  const inArea: AreaTally = { routeCount: 0, mergedCount: 0, droppedCount: 0, splitCount: 0 };
  const inAreaRouteIds = new Set<string>();
  const changedRouteIds = new Set<string>();
  const others = new Map<string, AreaChange>();

  for (const route of routes) {
    const paint = paintOf.get(route.groupId);
    const key = areaOf(route, areas);
    // Without areas there is nothing to scope to, so the library is the scope.
    const inScope = areas.length === 0 || (key !== null && key === selectedBinKey);
    const merged = paint?.mergesWithAnother === true;
    const dropped = paint !== undefined && paint.previewKey === null;
    const split = paint?.splits === true;

    if (inScope) {
      inArea.routeCount += 1;
      inAreaRouteIds.add(route.groupId);
      if (merged) inArea.mergedCount += 1;
      if (dropped) inArea.droppedCount += 1;
      if (split) inArea.splitCount += 1;
      if (merged || dropped || split) changedRouteIds.add(route.groupId);
    } else if (key !== null && (merged || dropped || split)) {
      const change = others.get(key) ?? {
        binKey: key,
        mergedCount: 0,
        droppedCount: 0,
        splitCount: 0,
      };
      if (merged) change.mergedCount += 1;
      if (dropped) change.droppedCount += 1;
      if (split) change.splitCount += 1;
      others.set(key, change);
    }
  }

  const elsewhere = areas.flatMap((area) => {
    const change = others.get(area.binKey);
    return change ? [change] : [];
  });
  return { inArea, elsewhere, inAreaRouteIds, changedRouteIds };
}
