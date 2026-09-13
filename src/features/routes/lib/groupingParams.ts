/**
 * The two route-grouping knobs, and what a preview payload says about the
 * routes the athlete already has.
 *
 * The engine takes the two numbers independently: how much of the route has to
 * match, and how close the two ends have to be. They are two different
 * questions and one axis cannot express "same roads, different start", so the
 * panel exposes both rather than interpolating a single strictness.
 *
 * The sliders cover the range the grouper has been run over, which is the
 * three settings the deleted preset ladder shipped, 50/300, 55/250 and 65/180.
 * A value outside it is typed rather than dragged, the same rule the section
 * panel follows: a slider that reaches a value nothing was ever run at is a
 * control that moves and does nothing.
 */

import type { RouteGroupPreview } from '../../../../modules/veloqrs/src/delegates/routeGroupingPreview';

export interface GroupingParams {
  /** Percentage of the route that has to match, 0 to 100. */
  minMatchPercentage: number;
  /** Metres the two starts, and the two finishes, may be apart. */
  endpointThreshold: number;
}

export type GroupingParamKey = keyof GroupingParams;

interface GroupingRange {
  /** The slider's own bounds: what the grouper has been run over. */
  min: number;
  max: number;
  step: number;
}

export const GROUPING_PARAM_RANGES: Record<GroupingParamKey, GroupingRange> = {
  minMatchPercentage: { min: 50, max: 65, step: 1 },
  endpointThreshold: { min: 180, max: 300, step: 10 },
};

/**
 * Where the sliders open. These mirror the grouper's own defaults, which is
 * the middle rung of the ladder the presets used to offer. The screen cannot
 * read the strictness in force yet: nothing binds the engine's getter, so
 * opening on the default is the honest starting point rather than a claim
 * about what is applied.
 */
export const GROUPING_DEFAULTS: GroupingParams = {
  minMatchPercentage: 55,
  endpointThreshold: 250,
};

/**
 * Read a typed value, or null when it is not one the grouper can be given. A
 * match percentage past 100 is refused because it can never be met; a metre
 * count is positive or it is nothing.
 */
export function parseGroupingInput(key: GroupingParamKey, text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  if (key === 'minMatchPercentage' && value > 100) return null;
  return Math.round(value);
}

/** One of today's routes, as the preview repaints it. */
export interface PaintedRoute {
  groupId: string;
  /**
   * The previewed group this route's representative ride lands in, or null
   * when the setting leaves that ride in no group at all.
   */
  previewKey: string | null;
  /** Rides in that previewed group, 0 when there is none. */
  previewSize: number;
  /** Whether this is the largest previewed group, which draws opaque. */
  isLargest: boolean;
  /**
   * True when another of today's routes lands in the same previewed group, so
   * this setting would merge them.
   */
  mergesWithAnother: boolean;
}

export interface GroupingPreviewDiff {
  routes: PaintedRoute[];
  /** Groups the preview produced over the whole library. */
  previewGroupCount: number;
  /** Today's routes whose representative ride falls out of every group. */
  droppedCount: number;
  /** Today's routes that share a previewed group with another. */
  mergedCount: number;
}

/**
 * Join a preview payload against the routes the map already holds.
 *
 * The join key is the representative ride, because that is the only activity
 * id a route summary carries; the payload's own `key` is the grouping's
 * Union-Find root and joins rows within one payload only, so it is read here
 * and never held.
 */
export function paintPreview(
  routes: { groupId: string; representativeId: string }[],
  preview: RouteGroupPreview[]
): GroupingPreviewDiff {
  const groupOfActivity = new Map<string, RouteGroupPreview>();
  for (const group of preview) {
    for (const id of group.activityIds) groupOfActivity.set(id, group);
  }

  let largestKey: string | null = null;
  let largestSize = 0;
  for (const group of preview) {
    if (group.activityIds.length > largestSize) {
      largestSize = group.activityIds.length;
      largestKey = group.key;
    }
  }

  const routesPerKey = new Map<string, number>();
  for (const route of routes) {
    const key = groupOfActivity.get(route.representativeId)?.key;
    if (key === undefined) continue;
    routesPerKey.set(key, (routesPerKey.get(key) ?? 0) + 1);
  }

  const painted = routes.map((route) => {
    const group = groupOfActivity.get(route.representativeId);
    return {
      groupId: route.groupId,
      previewKey: group?.key ?? null,
      previewSize: group?.activityIds.length ?? 0,
      isLargest: group !== undefined && group.key === largestKey,
      mergesWithAnother: group !== undefined && (routesPerKey.get(group.key) ?? 0) > 1,
    };
  });

  return {
    routes: painted,
    previewGroupCount: preview.length,
    droppedCount: painted.filter((r) => r.previewKey === null).length,
    mergedCount: painted.filter((r) => r.mergesWithAnother).length,
  };
}
