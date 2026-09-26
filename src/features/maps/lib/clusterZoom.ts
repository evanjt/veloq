/**
 * clusterZoom - pure helpers for zooming into a MapLibre cluster.
 *
 * When the user taps a cluster on the regional map we prefer the most
 * predictable outcome: fit the camera to the bounds of the leaves that
 * make up the cluster. This produces a tight, intuitive zoom that always
 * shows the underlying activities, regardless of how supercluster would
 * choose to split the cluster at the next zoom step.
 *
 * `getClusterLeaves` from MapLibre returns the full set of points behind
 * a cluster id (up to `limit`), each as a GeoJSON `Point` feature. This
 * module extracts the bounds of those leaves and decides between a tight
 * fitBounds (the common case) and a looser zoomed-camera when the leaves
 * overlap so heavily that a bounds fit would be meaningless (e.g. 30 rides
 * that all start at the same garage door).
 */

/** Small epsilon - leaves within this span are considered "stacked". */
const STACKED_LEAF_SPAN_DEG = 0.0002; // ≈20m at most latitudes

/** Threshold below which we treat the cluster as "small" (task spec). */
const SMALL_CLUSTER_LEAF_COUNT = 20;

export interface LeafBounds {
  ne: [number, number]; // [maxLng, maxLat]
  sw: [number, number]; // [minLng, minLat]
  spanLng: number;
  spanLat: number;
}

/**
 * Compute the geographic bounds of a FeatureCollection of Point features.
 * Returns null if the collection has no valid point features.
 */
export function computeLeafBounds(features: readonly GeoJSON.Feature[]): LeafBounds | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let hasAny = false;

  for (const feature of features) {
    if (feature.geometry?.type !== 'Point') continue;
    const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    hasAny = true;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  if (!hasAny) return null;

  return {
    ne: [maxLng, maxLat],
    sw: [minLng, minLat],
    spanLng: maxLng - minLng,
    spanLat: maxLat - minLat,
  };
}

export interface ClusterZoomPlanSmall {
  kind: 'fitBounds';
  bounds: LeafBounds;
  leafCount: number;
  /** Animation duration in ms - shorter for small clusters, longer for large ones. */
  durationMs: number;
}

export interface ClusterZoomPlanStacked {
  kind: 'stacked';
  center: [number, number];
  leafCount: number;
}

/**
 * No leaves came back at all, so there is nothing to fit and nothing to fan
 * out. The page answers `[]` for a source it cannot find, a cluster id that no
 * longer resolves and any error inside the query, and it says which of those it
 * was in none of them. The caller falls back on supercluster's own split zoom,
 * so a tap moves the camera whichever it was.
 */
export interface ClusterZoomPlanExpand {
  kind: 'expand';
  center: [number, number];
}

export type ClusterZoomPlan = ClusterZoomPlanSmall | ClusterZoomPlanStacked | ClusterZoomPlanExpand;

/**
 * Decide how to zoom into a cluster given its leaves and tap coordinates.
 *
 * Rules:
 *   - No leaves at all → expand plan: the caller has nothing to fit and nothing
 *     to fan out, so it asks the map where the cluster splits.
 *   - If leaves collapse to a single point (span < epsilon) → stacked plan,
 *     caller can spider-expand.
 *   - Otherwise → fit to the leaves' bounds.
 *   - Animation is shorter (300ms) for small clusters, longer (600ms) for
 *     large ones so the camera transition stays readable.
 */
export function planClusterZoom(
  leaves: readonly GeoJSON.Feature[],
  fallbackCenter: [number, number]
): ClusterZoomPlan {
  if (leaves.length === 0) return { kind: 'expand', center: fallbackCenter };

  const bounds = computeLeafBounds(leaves);

  if (
    !bounds ||
    (bounds.spanLng < STACKED_LEAF_SPAN_DEG && bounds.spanLat < STACKED_LEAF_SPAN_DEG)
  ) {
    return {
      kind: 'stacked',
      center: fallbackCenter,
      leafCount: leaves.length,
    };
  }

  const leafCount = leaves.length;
  const durationMs = leafCount < SMALL_CLUSTER_LEAF_COUNT ? 300 : 600;

  return {
    kind: 'fitBounds',
    bounds,
    leafCount,
    durationMs,
  };
}

/** Re-export the constants so tests and call sites stay in sync with spec. */
export const CLUSTER_ZOOM_CONSTANTS = {
  STACKED_LEAF_SPAN_DEG,
  SMALL_CLUSTER_LEAF_COUNT,
} as const;
