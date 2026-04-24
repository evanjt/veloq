/**
 * Tile math, geographic clustering, and bounds expansion utilities.
 *
 * Pure functions for converting GPS bounds to tile coordinates,
 * clustering activity regions, and estimating tile counts for
 * offline map caching.
 */
import { median } from '@/lib/utils/statistics';

/** Bounding box with min/max lat/lng */
export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** A geographic cluster of activities */
export interface TileCluster {
  bounds: Bounds;
  hash: string;
  activityCount: number;
}

/** Range of tile coordinates at a given zoom level */
interface TileRange {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zoom: number;
}

/** Convert longitude to tile X coordinate */
export function lng2tile(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * Math.pow(2, z));
}

/** Web Mercator safe latitude range — tan/cos overflow at ±90° */
const MAX_MERCATOR_LAT = 85.051129;
function clampLat(lat: number): number {
  return Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
}

/** Convert latitude to tile Y coordinate */
export function lat2tile(lat: number, z: number): number {
  const clampedLat = clampLat(lat);
  return Math.floor(
    ((1 -
      Math.log(
        Math.tan((clampedLat * Math.PI) / 180) + 1 / Math.cos((clampedLat * Math.PI) / 180)
      ) /
        Math.PI) /
      2) *
      Math.pow(2, z)
  );
}

/** Get tile range covering a bounding box at a given zoom level */
export function boundsToTileRange(bounds: Bounds, zoom: number): TileRange {
  return {
    xMin: lng2tile(bounds.minLng, zoom),
    xMax: lng2tile(bounds.maxLng, zoom),
    yMin: lat2tile(bounds.maxLat, zoom), // lat2tile is inverted (north = smaller y)
    yMax: lat2tile(bounds.minLat, zoom),
    zoom,
  };
}

/** Count total tiles for a bounds across a zoom range */
export function tileCountForBounds(bounds: Bounds, zoomRange: [number, number]): number {
  let count = 0;
  for (let z = zoomRange[0]; z <= zoomRange[1]; z++) {
    const range = boundsToTileRange(bounds, z);
    count += (range.xMax - range.xMin + 1) * (range.yMax - range.yMin + 1);
  }
  return count;
}

/**
 * Expand bounds by a radius in kilometers.
 * Uses approximate conversion: 1° lat ≈ 111km, 1° lng ≈ 111km * cos(lat).
 */
export function expandBounds(bounds: Bounds, radiusKm: number): Bounds {
  const latDelta = radiusKm / 111;
  const midLat = clampLat((bounds.minLat + bounds.maxLat) / 2);
  const lngDelta = radiusKm / (111 * Math.cos((midLat * Math.PI) / 180));

  return {
    minLat: bounds.minLat - latDelta,
    maxLat: bounds.maxLat + latDelta,
    minLng: bounds.minLng - lngDelta,
    maxLng: bounds.maxLng + lngDelta,
  };
}

/**
 * Simple hash for a bounds, used to identify clusters for cache pack naming.
 * Rounds to ~1km precision so minor GPS drift doesn't produce new hashes.
 */
function hashBounds(bounds: Bounds): string {
  const r = (n: number) => Math.round(n * 100).toString(36);
  return `${r(bounds.minLat)}_${r(bounds.maxLat)}_${r(bounds.minLng)}_${r(bounds.maxLng)}`;
}

/**
 * Cluster activity bounds using grid-based spatial grouping.
 *
 * Activities are assigned to grid cells of `gridSizeKm`. Adjacent cells
 * with activities are merged into clusters. Each cluster's bounds are
 * the union of all activity bounds in that cluster, expanded by `radiusKm`.
 */
export function clusterActivityBounds(
  activities: Array<{ bounds: Bounds }>,
  gridSizeKm: number,
  radiusKm: number
): TileCluster[] {
  if (activities.length === 0) return [];

  // Approximate grid cell size in degrees
  const latStep = gridSizeKm / 111;
  // Use median latitude for longitude step
  const allLats = activities.map((a) => (a.bounds.minLat + a.bounds.maxLat) / 2);
  const medianLat = clampLat(median(allLats));
  const lngStep = gridSizeKm / (111 * Math.cos((medianLat * Math.PI) / 180));

  // Assign activities to grid cells
  const cellMap = new Map<string, { bounds: Bounds; count: number; row: number; col: number }>();

  for (const activity of activities) {
    const centerLat = (activity.bounds.minLat + activity.bounds.maxLat) / 2;
    const centerLng = (activity.bounds.minLng + activity.bounds.maxLng) / 2;
    const row = Math.floor(centerLat / latStep);
    const col = Math.floor(centerLng / lngStep);
    const key = `${row},${col}`;

    const existing = cellMap.get(key);
    if (existing) {
      existing.bounds = unionBounds(existing.bounds, activity.bounds);
      existing.count++;
    } else {
      cellMap.set(key, {
        bounds: { ...activity.bounds },
        count: 1,
        row,
        col,
      });
    }
  }

  // Merge adjacent cells using flood fill
  const visited = new Set<string>();
  const clusters: TileCluster[] = [];

  for (const [key, cell] of cellMap) {
    if (visited.has(key)) continue;

    // Flood fill to find connected cells
    let clusterBounds = { ...cell.bounds };
    let clusterCount = 0;
    const queue = [key];
    visited.add(key);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentCell = cellMap.get(current)!;
      clusterBounds = unionBounds(clusterBounds, currentCell.bounds);
      clusterCount += currentCell.count;

      // Check all 8 neighbors
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const neighborKey = `${currentCell.row + dr},${currentCell.col + dc}`;
          if (cellMap.has(neighborKey) && !visited.has(neighborKey)) {
            visited.add(neighborKey);
            queue.push(neighborKey);
          }
        }
      }
    }

    const expanded = expandBounds(clusterBounds, radiusKm);
    clusters.push({
      bounds: expanded,
      hash: hashBounds(expanded),
      activityCount: clusterCount,
    });
  }

  return clusters;
}

/** Union of two bounding boxes */
function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minLat: Math.min(a.minLat, b.minLat),
    maxLat: Math.max(a.maxLat, b.maxLat),
    minLng: Math.min(a.minLng, b.minLng),
    maxLng: Math.max(a.maxLng, b.maxLng),
  };
}

/**
 * Enumerate tile URLs for a set of clusters at a zoom range.
 * Deduplicates tiles that appear in overlapping clusters.
 */
export function enumerateTileUrls(
  clusters: TileCluster[],
  tileTemplate: string,
  zoomRange: [number, number]
): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const cluster of clusters) {
    for (let z = zoomRange[0]; z <= zoomRange[1]; z++) {
      const range = boundsToTileRange(cluster.bounds, z);
      for (let x = range.xMin; x <= range.xMax; x++) {
        for (let y = range.yMin; y <= range.yMax; y++) {
          const key = `${z}/${x}/${y}`;
          if (seen.has(key)) continue;
          seen.add(key);
          urls.push(
            tileTemplate
              .replace('{z}', String(z))
              .replace('{x}', String(x))
              .replace('{y}', String(y))
          );
        }
      }
    }
  }

  return urls;
}

/**
 * Check whether two bounding boxes overlap.
 * `b` uses [west, south, east, north] format (same as SATELLITE_SOURCES bounds).
 */
export function boundsOverlap(a: Bounds, b: [number, number, number, number]): boolean {
  const [west, south, east, north] = b;
  return a.minLng <= east && a.maxLng >= west && a.minLat <= north && a.maxLat >= south;
}

/**
 * Estimate total tile count across clusters for multiple sources and zoom ranges.
 * Used for UI display of expected download size.
 */
export function estimateTotalTiles(
  clusters: TileCluster[],
  sources: Array<{ zoomRange: [number, number] }>
): number {
  let total = 0;
  for (const cluster of clusters) {
    for (const source of sources) {
      total += tileCountForBounds(cluster.bounds, source.zoomRange);
    }
  }
  return total;
}
