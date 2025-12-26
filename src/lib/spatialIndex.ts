/**
 * Spatial index for activity bounds using R-tree (rbush).
 * Provides O(log n) spatial queries instead of O(n) scans.
 *
 * Use cases:
 * - Viewport culling: find activities visible in current map bounds
 * - Route matching: find activities with overlapping bounds
 * - Clustering: group nearby activities for zoom levels
 */

import RBush from 'rbush';
import type { ActivityBoundsItem } from '@/types';
import { debug } from './debug';

const log = debug.create('SpatialIndex');

/**
 * R-tree item with activity reference
 */
export interface SpatialIndexItem {
  minX: number; // minLng
  minY: number; // minLat
  maxX: number; // maxLng
  maxY: number; // maxLat
  activityId: string;
}

/**
 * Viewport bounds for spatial queries
 */
export interface ViewportBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * Spatial index singleton for activity bounds.
 * Maintains an R-tree that can be queried for activities in a viewport.
 */
class ActivitySpatialIndex {
  private tree: RBush<SpatialIndexItem>;
  private activityMap: Map<string, SpatialIndexItem>;
  private isBuilt = false;

  constructor() {
    this.tree = new RBush<SpatialIndexItem>();
    this.activityMap = new Map();
  }

  /**
   * Build index from activity bounds cache.
   * Call this when cache is loaded or significantly updated.
   */
  buildFromActivities(activities: ActivityBoundsItem[]): void {
    // Clear existing
    this.tree.clear();
    this.activityMap.clear();

    // Convert to R-tree items
    const items: SpatialIndexItem[] = [];
    for (const activity of activities) {
      const item = this.activityToItem(activity);
      if (item) {
        items.push(item);
        this.activityMap.set(activity.id, item);
      }
    }

    // Bulk load is much faster than individual inserts
    this.tree.load(items);
    this.isBuilt = true;

    log.log(`Built index with ${items.length} activities`);
  }

  /**
   * Add a single activity to the index (for incremental updates).
   */
  insert(activity: ActivityBoundsItem): void {
    // Remove existing if present
    this.remove(activity.id);

    const item = this.activityToItem(activity);
    if (item) {
      this.tree.insert(item);
      this.activityMap.set(activity.id, item);
    }
  }

  /**
   * Remove an activity from the index.
   */
  remove(activityId: string): void {
    const existing = this.activityMap.get(activityId);
    if (existing) {
      this.tree.remove(existing, (a, b) => a.activityId === b.activityId);
      this.activityMap.delete(activityId);
    }
  }

  /**
   * Bulk insert activities (more efficient than individual inserts).
   */
  bulkInsert(activities: ActivityBoundsItem[]): void {
    const items: SpatialIndexItem[] = [];
    for (const activity of activities) {
      // Remove existing first
      this.remove(activity.id);

      const item = this.activityToItem(activity);
      if (item) {
        items.push(item);
        this.activityMap.set(activity.id, item);
      }
    }

    if (items.length > 0) {
      // For small batches, individual insert is fine
      // For large batches, rebuild might be more efficient
      if (items.length > 100) {
        // Rebuild entire tree
        const allItems = Array.from(this.activityMap.values());
        this.tree.clear();
        this.tree.load(allItems);
      } else {
        for (const item of items) {
          this.tree.insert(item);
        }
      }
    }
  }

  /**
   * Query activities within a viewport (map visible bounds).
   * Returns activity IDs that intersect with the viewport.
   */
  queryViewport(bounds: ViewportBounds): string[] {
    if (!this.isBuilt) return [];

    const results = this.tree.search({
      minX: bounds.minLng,
      minY: bounds.minLat,
      maxX: bounds.maxLng,
      maxY: bounds.maxLat,
    });

    return results.map((item) => item.activityId);
  }

  /**
   * Find activities that could match a given activity (overlapping bounds).
   * Returns activity IDs with bounds that intersect.
   */
  findPotentialMatches(activity: ActivityBoundsItem): string[] {
    const item = this.activityToItem(activity);
    if (!item) return [];

    // Expand bounds slightly to catch edge cases
    const padding = 0.001; // ~100m at equator
    const results = this.tree.search({
      minX: item.minX - padding,
      minY: item.minY - padding,
      maxX: item.maxX + padding,
      maxY: item.maxY + padding,
    });

    // Exclude self
    return results
      .filter((r) => r.activityId !== activity.id)
      .map((r) => r.activityId);
  }

  /**
   * Find all activities within a radius of a point (for clustering).
   * Uses bounding box approximation.
   */
  queryRadius(centerLat: number, centerLng: number, radiusKm: number): string[] {
    if (!this.isBuilt) return [];

    // Convert km to approximate degrees
    const latDelta = radiusKm / 111; // ~111km per degree latitude
    const lngDelta = radiusKm / (111 * Math.cos(centerLat * Math.PI / 180));

    const results = this.tree.search({
      minX: centerLng - lngDelta,
      minY: centerLat - latDelta,
      maxX: centerLng + lngDelta,
      maxY: centerLat + latDelta,
    });

    return results.map((item) => item.activityId);
  }

  /**
   * Get all indexed activity IDs.
   */
  getAllActivityIds(): string[] {
    return Array.from(this.activityMap.keys());
  }

  /**
   * Get count of indexed activities.
   */
  get size(): number {
    return this.activityMap.size;
  }

  /**
   * Check if index is built.
   */
  get ready(): boolean {
    return this.isBuilt;
  }

  /**
   * Clear the index.
   */
  clear(): void {
    this.tree.clear();
    this.activityMap.clear();
    this.isBuilt = false;
  }

  /**
   * Convert ActivityBoundsItem to R-tree item.
   */
  private activityToItem(activity: ActivityBoundsItem): SpatialIndexItem | null {
    const bounds = activity.bounds;
    if (!bounds || bounds.length !== 2) return null;

    let [[minLat, minLng], [maxLat, maxLng]] = bounds;

    // Validate coordinates are finite
    if (
      !isFinite(minLat) || !isFinite(maxLat) ||
      !isFinite(minLng) || !isFinite(maxLng)
    ) {
      return null;
    }

    // Fix inverted bounds (ensure min < max)
    if (minLat > maxLat) {
      [minLat, maxLat] = [maxLat, minLat];
    }
    if (minLng > maxLng) {
      [minLng, maxLng] = [maxLng, minLng];
    }

    return {
      minX: minLng,
      minY: minLat,
      maxX: maxLng,
      maxY: maxLat,
      activityId: activity.id,
    };
  }
}

// Export singleton instance
export const activitySpatialIndex = new ActivitySpatialIndex();

/**
 * Helper to convert viewport bounds from map coordinates.
 * MapLibre uses [lng, lat] order.
 */
export function mapBoundsToViewport(
  sw: [number, number],
  ne: [number, number]
): ViewportBounds {
  return {
    minLng: sw[0],
    minLat: sw[1],
    maxLng: ne[0],
    maxLat: ne[1],
  };
}
