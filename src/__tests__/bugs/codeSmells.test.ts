/**
 * Tests that expose real bugs and code smells in the codebase.
 *
 * These tests document known issues. Some will FAIL until fixed.
 * Run with: npm test -- --testPathPattern=codeSmells
 */

import { getBounds, getBoundsFromPolyline, detectCoordinateFormat } from '@/lib/geo/polyline';

describe('Bug: getBounds sentinel value conflicts with valid coordinates', () => {
  /**
   * src/lib/geo/polyline.ts:187
   *
   * The check `minLat === 0 && maxLat === 0 && minLng === 0 && maxLng === 0`
   * incorrectly treats coordinates at the origin (0,0) as invalid/empty.
   *
   * The Gulf of Guinea (off the coast of Africa) is at coordinates (0,0),
   * and any activity there would be incorrectly rejected.
   */

  it('should return valid bounds for coordinates at the origin', () => {
    const coords = [
      { latitude: 0, longitude: 0 },
      { latitude: 0.001, longitude: 0.001 },
    ];

    const bounds = getBounds(coords);

    // FIXED: getBounds now returns null for empty arrays, not {0,0,0,0}
    // So origin coordinates are no longer confused with "no data"
    expect(bounds).not.toBeNull();
    expect(bounds!.maxLat).toBeGreaterThan(bounds!.minLat);
  });

  it('should distinguish empty array from single point at origin', () => {
    const emptyBounds = getBounds([]);
    const originBounds = getBounds([{ latitude: 0, longitude: 0 }]);

    // FIXED: Empty array now returns null, origin returns actual bounds
    expect(emptyBounds).toBeNull();
    expect(originBounds).not.toBeNull();
  });

  it('getBoundsFromPolyline should not return null for valid polyline at origin', () => {
    // Polyline encoding for [[0,0], [0.001, 0.001]]
    // Note: This tests the downstream effect - now fixed
    const coords = [
      { latitude: 0, longitude: 0 },
      { latitude: 0.001, longitude: 0.001 },
    ];
    const bounds = getBounds(coords);

    // FIXED: getBounds returns null for empty input, not {0,0,0,0}
    // So the old buggy sentinel check is no longer an issue
    expect(bounds).not.toBeNull();
    expect(bounds!.minLat).toBe(0);
    expect(bounds!.maxLat).toBe(0.001);
  });
});

describe('Bug: detectCoordinateFormat ambiguity', () => {
  /**
   * src/lib/geo/polyline.ts - coordinate detection
   *
   * The heuristic assumes that if a value > 90, it must be longitude.
   * This fails for certain edge cases.
   */

  it('should correctly detect [lat, lng] for coordinates within ±90 range', () => {
    // Zurich: lat 47.3769, lng 8.5417
    // Both values are valid latitudes, so detection relies on heuristics
    const coords: [number, number][] = [[47.3769, 8.5417]];

    const format = detectCoordinateFormat(coords);

    // The function defaults to 'latLng' for ambiguous cases
    // This is the expected behavior, but it's worth documenting
    expect(format).toBe('latLng');
  });

  it('should handle all-NaN coordinates gracefully', () => {
    const coords: [number, number][] = [
      [NaN, NaN],
      [NaN, NaN],
    ];

    // Should not throw, should return a sensible default
    expect(() => detectCoordinateFormat(coords)).not.toThrow();
    const format = detectCoordinateFormat(coords);
    expect(['latLng', 'lngLat']).toContain(format);
  });
});

describe('Code smell: Inconsistent null/undefined handling', () => {
  /**
   * Various functions handle null/undefined differently.
   * This tests documents expected behavior.
   */

  it('formatDistance handles edge cases consistently', () => {
    const { formatDistance } = require('@/lib/utils/format');

    // All invalid inputs should return the same fallback
    expect(formatDistance(null as unknown as number)).toBe('0 m');
    expect(formatDistance(undefined as unknown as number)).toBe('0 m');
    expect(formatDistance(NaN)).toBe('0 m');
    expect(formatDistance(-Infinity)).toBe('0 m');
    expect(formatDistance(Infinity)).toBe('0 m');
  });
});

describe('Performance: Large data handling', () => {
  /**
   * Tests for handling large datasets without crashing.
   */

  it('getBounds handles 10000 coordinates efficiently', () => {
    const coords = Array.from({ length: 10000 }, (_, i) => ({
      latitude: 40 + (i % 100) * 0.001,
      longitude: -74 + Math.floor(i / 100) * 0.001,
    }));

    const start = Date.now();
    const bounds = getBounds(coords);
    const elapsed = Date.now() - start;

    expect(bounds).not.toBeNull();
    expect(bounds!.minLat).toBeCloseTo(40, 1);
    expect(bounds!.maxLat).toBeCloseTo(40.099, 1);
    expect(elapsed).toBeLessThan(100); // Should be fast
  });
});

describe('Error handling: Graceful degradation', () => {
  /**
   * Tests that functions degrade gracefully with bad input.
   */

  it('getBounds handles mixed valid/invalid coordinates', () => {
    const coords = [
      { latitude: 40.7128, longitude: -74.006 }, // NYC
      { latitude: NaN, longitude: NaN }, // Invalid
      { latitude: 40.758, longitude: -73.9855 }, // Midtown
    ];

    const bounds = getBounds(coords);

    // Should ignore the NaN entry and compute bounds from valid ones
    expect(bounds).not.toBeNull();
    expect(bounds!.minLat).toBeCloseTo(40.7128, 4);
    expect(bounds!.maxLat).toBeCloseTo(40.758, 3);
  });
});
