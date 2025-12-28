/**
 * Compatibility wrapper around the Rust engine's spatial query.
 * Provides the same interface as the deleted JS spatial index.
 *
 * The Rust engine (route-matcher-native) now handles all spatial
 * indexing internally using an R-tree. This wrapper proxies calls
 * to the engine while maintaining the original API surface.
 */

// Lazy import to avoid loading native module during bundling
let _routeEngine: typeof import('route-matcher-native').routeEngine | null = null;

function getRouteEngine() {
  if (!_routeEngine) {
    try {
      _routeEngine = require('route-matcher-native').routeEngine;
    } catch {
      return null;
    }
  }
  return _routeEngine;
}

export interface Viewport {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * Activity spatial index wrapper.
 * Proxies to the Rust engine's R-tree spatial index.
 */
export const activitySpatialIndex = {
  /**
   * Returns true when the engine has activities loaded and ready for queries.
   */
  get ready(): boolean {
    try {
      const engine = getRouteEngine();
      return engine ? engine.getActivityCount() > 0 : false;
    } catch {
      return false;
    }
  },

  /**
   * Returns the number of indexed activities.
   */
  get size(): number {
    try {
      const engine = getRouteEngine();
      return engine ? engine.getActivityCount() : 0;
    } catch {
      return 0;
    }
  },

  /**
   * Query activities within a viewport.
   * @param viewport - Bounds to query (minLat, maxLat, minLng, maxLng)
   * @returns Array of activity IDs that intersect the viewport
   */
  queryViewport(viewport: Viewport): string[] {
    try {
      const engine = getRouteEngine();
      if (!engine) return [];
      return engine.queryViewport(
        viewport.minLat,
        viewport.maxLat,
        viewport.minLng,
        viewport.maxLng
      );
    } catch {
      return [];
    }
  },
};

/**
 * Convert map bounds to viewport format.
 * @param sw - Southwest corner [lng, lat]
 * @param ne - Northeast corner [lng, lat]
 * @returns Viewport object for spatial queries
 */
export function mapBoundsToViewport(
  sw: [number, number],
  ne: [number, number]
): Viewport {
  return {
    minLat: Math.min(sw[1], ne[1]),
    maxLat: Math.max(sw[1], ne[1]),
    minLng: Math.min(sw[0], ne[0]),
    maxLng: Math.max(sw[0], ne[0]),
  };
}
