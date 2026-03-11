/**
 * Tests for tile math, clustering, and bounds expansion utilities.
 */

import {
  lng2tile,
  lat2tile,
  boundsToTileRange,
  tileCountForBounds,
  expandBounds,
  clusterActivityBounds,
  enumerateTileUrls,
  estimateTotalTiles,
  type Bounds,
} from '@/lib/maps/tileGeometry';

describe('tileGeometry', () => {
  describe('lng2tile', () => {
    it('converts 0° longitude at z0 to tile 0', () => {
      expect(lng2tile(0, 0)).toBe(0);
    });

    it('converts -180° longitude at z1 to tile 0', () => {
      expect(lng2tile(-180, 1)).toBe(0);
    });

    it('converts 180° longitude at z1 to tile 2', () => {
      expect(lng2tile(180, 1)).toBe(2);
    });

    it('produces correct tile for Zurich (8.54°E) at z10', () => {
      const tile = lng2tile(8.54, 10);
      expect(tile).toBeGreaterThan(0);
      expect(tile).toBeLessThan(1024);
    });
  });

  describe('lat2tile', () => {
    it('converts equator at z0 to tile 0', () => {
      expect(lat2tile(0, 0)).toBe(0);
    });

    it('converts positive latitude to smaller tile number (north)', () => {
      const north = lat2tile(47.37, 10); // Zurich
      const south = lat2tile(46.0, 10); // Southern Switzerland
      expect(north).toBeLessThan(south);
    });
  });

  describe('boundsToTileRange', () => {
    const zurichBounds: Bounds = {
      minLat: 47.35,
      maxLat: 47.4,
      minLng: 8.5,
      maxLng: 8.6,
    };

    it('returns valid tile range', () => {
      const range = boundsToTileRange(zurichBounds, 10);
      expect(range.xMin).toBeLessThanOrEqual(range.xMax);
      expect(range.yMin).toBeLessThanOrEqual(range.yMax);
      expect(range.zoom).toBe(10);
    });

    it('produces more tiles at higher zoom', () => {
      const z10 = boundsToTileRange(zurichBounds, 10);
      const z14 = boundsToTileRange(zurichBounds, 14);
      const countZ10 = (z10.xMax - z10.xMin + 1) * (z10.yMax - z10.yMin + 1);
      const countZ14 = (z14.xMax - z14.xMin + 1) * (z14.yMax - z14.yMin + 1);
      expect(countZ14).toBeGreaterThan(countZ10);
    });
  });

  describe('tileCountForBounds', () => {
    const bounds: Bounds = {
      minLat: 47.35,
      maxLat: 47.4,
      minLng: 8.5,
      maxLng: 8.6,
    };

    it('returns a positive number', () => {
      expect(tileCountForBounds(bounds, [10, 14])).toBeGreaterThan(0);
    });

    it('returns more tiles for wider zoom range', () => {
      const narrow = tileCountForBounds(bounds, [12, 14]);
      const wide = tileCountForBounds(bounds, [10, 14]);
      expect(wide).toBeGreaterThan(narrow);
    });

    it('returns 1 tile for a point at z0', () => {
      expect(tileCountForBounds(bounds, [0, 0])).toBe(1);
    });
  });

  describe('expandBounds', () => {
    const bounds: Bounds = {
      minLat: 47.35,
      maxLat: 47.4,
      minLng: 8.5,
      maxLng: 8.6,
    };

    it('expands bounds by the given radius', () => {
      const expanded = expandBounds(bounds, 5);
      expect(expanded.minLat).toBeLessThan(bounds.minLat);
      expect(expanded.maxLat).toBeGreaterThan(bounds.maxLat);
      expect(expanded.minLng).toBeLessThan(bounds.minLng);
      expect(expanded.maxLng).toBeGreaterThan(bounds.maxLng);
    });

    it('expands roughly by 5km (~0.045° lat)', () => {
      const expanded = expandBounds(bounds, 5);
      const latDelta = bounds.minLat - expanded.minLat;
      // 5km / 111km per degree ≈ 0.045
      expect(latDelta).toBeCloseTo(0.045, 1);
    });

    it('expanding by 0 km returns same bounds', () => {
      const expanded = expandBounds(bounds, 0);
      expect(expanded.minLat).toBeCloseTo(bounds.minLat, 5);
      expect(expanded.maxLat).toBeCloseTo(bounds.maxLat, 5);
    });
  });

  describe('clusterActivityBounds', () => {
    it('returns empty array for empty input', () => {
      expect(clusterActivityBounds([], 20, 5)).toEqual([]);
    });

    it('clusters nearby activities into one cluster', () => {
      const activities = [
        { bounds: { minLat: 47.35, maxLat: 47.36, minLng: 8.5, maxLng: 8.51 } },
        { bounds: { minLat: 47.37, maxLat: 47.38, minLng: 8.52, maxLng: 8.53 } },
      ];
      const clusters = clusterActivityBounds(activities, 20, 5);
      expect(clusters.length).toBe(1);
      expect(clusters[0].activityCount).toBe(2);
    });

    it('separates distant activities into different clusters', () => {
      const activities = [
        { bounds: { minLat: 47.35, maxLat: 47.36, minLng: 8.5, maxLng: 8.51 } }, // Zurich
        { bounds: { minLat: 48.85, maxLat: 48.86, minLng: 2.3, maxLng: 2.31 } }, // Paris
      ];
      const clusters = clusterActivityBounds(activities, 20, 5);
      expect(clusters.length).toBe(2);
    });

    it('each cluster has a non-empty hash', () => {
      const activities = [{ bounds: { minLat: 47.35, maxLat: 47.36, minLng: 8.5, maxLng: 8.51 } }];
      const clusters = clusterActivityBounds(activities, 20, 5);
      expect(clusters[0].hash).toBeTruthy();
      expect(clusters[0].hash.length).toBeGreaterThan(0);
    });

    it('cluster bounds are expanded by radius', () => {
      const activities = [{ bounds: { minLat: 47.35, maxLat: 47.36, minLng: 8.5, maxLng: 8.51 } }];
      const clusters = clusterActivityBounds(activities, 20, 5);
      expect(clusters[0].bounds.minLat).toBeLessThan(47.35);
      expect(clusters[0].bounds.maxLat).toBeGreaterThan(47.36);
    });
  });

  describe('enumerateTileUrls', () => {
    it('returns empty array for empty clusters', () => {
      expect(enumerateTileUrls([], 'https://example.com/{z}/{x}/{y}.png', [10, 10])).toEqual([]);
    });

    it('generates URLs with correct substitution', () => {
      const clusters = [
        {
          bounds: { minLat: 47.37, maxLat: 47.38, minLng: 8.53, maxLng: 8.54 },
          hash: 'test',
          activityCount: 1,
        },
      ];
      const urls = enumerateTileUrls(
        clusters,
        'https://tiles.example.com/{z}/{x}/{y}.png',
        [10, 10]
      );
      expect(urls.length).toBeGreaterThan(0);
      expect(urls[0]).toMatch(/^https:\/\/tiles\.example\.com\/10\/\d+\/\d+\.png$/);
    });

    it('deduplicates tiles across overlapping clusters', () => {
      const sameBounds = { minLat: 47.37, maxLat: 47.38, minLng: 8.53, maxLng: 8.54 };
      const clusters = [
        { bounds: sameBounds, hash: 'a', activityCount: 1 },
        { bounds: sameBounds, hash: 'b', activityCount: 1 },
      ];
      const urlsSingle = enumerateTileUrls(
        [clusters[0]],
        'https://tiles.example.com/{z}/{x}/{y}.png',
        [10, 10]
      );
      const urlsBoth = enumerateTileUrls(
        clusters,
        'https://tiles.example.com/{z}/{x}/{y}.png',
        [10, 10]
      );
      expect(urlsBoth.length).toBe(urlsSingle.length);
    });
  });

  describe('estimateTotalTiles', () => {
    it('returns 0 for empty clusters', () => {
      expect(estimateTotalTiles([], [{ zoomRange: [10, 14] }])).toBe(0);
    });

    it('sums tiles across multiple sources', () => {
      const clusters = [
        {
          bounds: { minLat: 47.37, maxLat: 47.38, minLng: 8.53, maxLng: 8.54 },
          hash: 'test',
          activityCount: 1,
        },
      ];
      const oneSource = estimateTotalTiles(clusters, [{ zoomRange: [10, 12] }]);
      const twoSources = estimateTotalTiles(clusters, [
        { zoomRange: [10, 12] },
        { zoomRange: [10, 12] },
      ]);
      expect(twoSources).toBe(oneSource * 2);
    });
  });
});
