/**
 * Regression test for iOS crash when sections have invalid polylines.
 *
 * Crash: -[__NSArrayM insertObject:atIndex:]: object cannot be nil
 * Location: MLRNMapView.m:207 (insertReactSubview:atIndex:)
 *
 * Root cause: RegionalMapView was using useFrequentSections which returns
 * sections with empty polylines (polyline: []) for lazy loading. When these
 * were passed to sectionsGeoJSON, it created invalid GeoJSON LineStrings
 * with 0 coordinates, crashing MapLibre on iOS.
 *
 * Fix:
 * 1. Changed to useEngineSections which loads full section data with polylines
 * 2. Added defensive validation to filter sections with < 2 valid coordinates
 *
 * User feedback from crash reports:
 * - "Still crashing on sections"
 * - "Crashed when pressing sections button"
 *
 * @see /crashreports/testflight_feedback/feedback.json
 * @see /crashreports/testflight_feedback(1)/feedback.json
 */

import type { RoutePoint } from '@/types';

// Minimal section type matching FrequentSection
interface TestSection {
  id: string;
  sportType: string;
  polyline: RoutePoint[];
  name?: string;
  visitCount: number;
  distanceMeters: number;
}

/**
 * OLD BUGGY IMPLEMENTATION - for documentation purposes only.
 * This is what RegionalMapView.tsx used to do BEFORE the fix.
 * It does NOT validate polyline length or filter NaN coordinates.
 */
function sectionsGeoJSON_BUGGY(sections: TestSection[]) {
  if (sections.length === 0) return null;

  const features = sections.map((section) => {
    const coordinates = section.polyline.map((pt) => [pt.lng, pt.lat]);

    return {
      type: 'Feature' as const,
      id: section.id,
      properties: {
        id: section.id,
        name: section.name || `Section ${section.id}`,
        sportType: section.sportType,
        visitCount: section.visitCount,
        distanceMeters: section.distanceMeters,
        color: '#FF0000',
      },
      geometry: {
        type: 'LineString' as const,
        coordinates,
      },
    };
  });

  return {
    type: 'FeatureCollection' as const,
    features,
  };
}

/**
 * FIXED IMPLEMENTATION - mirrors what RegionalMapView.tsx now does.
 * Filters out sections with invalid polylines and NaN coordinates.
 */
function sectionsGeoJSON_FIXED(sections: TestSection[]) {
  if (sections.length === 0) return null;

  const features = sections
    .map((section) => {
      // Filter out NaN coordinates
      const validPoints = section.polyline.filter((pt) => !isNaN(pt.lat) && !isNaN(pt.lng));

      // GeoJSON LineString requires at least 2 coordinates
      if (validPoints.length < 2) return null;

      const coordinates = validPoints.map((pt) => [pt.lng, pt.lat]);

      return {
        type: 'Feature' as const,
        id: section.id,
        properties: {
          id: section.id,
          name: section.name || `Section ${section.id}`,
          sportType: section.sportType,
          visitCount: section.visitCount,
          distanceMeters: section.distanceMeters,
          color: '#FF0000',
        },
        geometry: {
          type: 'LineString' as const,
          coordinates,
        },
      };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);

  // Return null if no valid features
  if (features.length === 0) return null;

  return {
    type: 'FeatureCollection' as const,
    features,
  };
}

/**
 * Helper to validate GeoJSON LineString features.
 * Returns array of validation errors.
 */
function validateGeoJSON(geojson: ReturnType<typeof sectionsGeoJSON_FIXED>): string[] {
  const errors: string[] = [];
  if (!geojson) return errors;

  for (const feature of geojson.features) {
    if (feature.geometry.type === 'LineString') {
      const coords = feature.geometry.coordinates;
      if (coords.length < 2) {
        errors.push(
          `Feature ${feature.id}: LineString has ${coords.length} coordinates (minimum 2 required)`
        );
      }
      // Check for NaN
      for (let i = 0; i < coords.length; i++) {
        if (Number.isNaN(coords[i][0]) || Number.isNaN(coords[i][1])) {
          errors.push(`Feature ${feature.id}: coordinate[${i}] contains NaN`);
        }
      }
    }
  }
  return errors;
}

// =============================================================================
// BUG DOCUMENTATION - Shows what the old buggy code did wrong
// =============================================================================

describe('Bug documentation: Old buggy implementation', () => {
  it('OLD CODE: Creates invalid GeoJSON with empty coordinates (CAUSED CRASH)', () => {
    const sectionsWithEmptyPolyline: TestSection[] = [
      {
        id: 'empty-section',
        sportType: 'Run',
        polyline: [], // Empty polyline - CRASH TRIGGER
        visitCount: 5,
        distanceMeters: 0,
      },
    ];

    const result = sectionsGeoJSON_BUGGY(sectionsWithEmptyPolyline);

    // OLD BUGGY CODE: Created invalid feature with empty coordinates
    expect(result).not.toBeNull();
    expect(result?.features).toHaveLength(1);
    expect(result?.features[0].geometry.coordinates).toHaveLength(0); // Invalid!
  });

  it('OLD CODE: Creates invalid GeoJSON with single coordinate (CAUSED CRASH)', () => {
    const sectionsWithSinglePoint: TestSection[] = [
      {
        id: 'single-point-section',
        sportType: 'Ride',
        polyline: [{ lat: 45.0, lng: 7.0 }], // Only 1 point - CRASH TRIGGER
        visitCount: 3,
        distanceMeters: 0,
      },
    ];

    const result = sectionsGeoJSON_BUGGY(sectionsWithSinglePoint);

    // OLD BUGGY CODE: Created invalid feature with only 1 coordinate
    expect(result).not.toBeNull();
    expect(result?.features).toHaveLength(1);
    expect(result?.features[0].geometry.coordinates).toHaveLength(1); // Invalid!
  });

  it('OLD CODE: Passed NaN coordinates through (CAUSED CRASH)', () => {
    const sectionsWithNaN: TestSection[] = [
      {
        id: 'nan-section',
        sportType: 'Run',
        polyline: [
          { lat: NaN, lng: 7.0 },
          { lat: 45.1, lng: NaN },
          { lat: 45.2, lng: 7.2 },
        ],
        visitCount: 5,
        distanceMeters: 500,
      },
    ];

    const result = sectionsGeoJSON_BUGGY(sectionsWithNaN);

    // OLD BUGGY CODE: NaN coordinates were passed through
    const coords = result?.features[0].geometry.coordinates;
    const hasNaN = coords?.some((coord: number[]) => coord.some((v) => Number.isNaN(v)));
    expect(hasNaN).toBe(true); // Bad!
  });
});

// =============================================================================
// FIX VERIFICATION - Verifies the fixed implementation works correctly
// =============================================================================

describe('Fix verification: Fixed implementation produces valid GeoJSON', () => {
  it('FIXED: Filters out sections with empty polylines', () => {
    const sectionsWithEmptyPolyline: TestSection[] = [
      {
        id: 'empty-section',
        sportType: 'Run',
        polyline: [],
        visitCount: 5,
        distanceMeters: 0,
      },
      {
        id: 'valid-section',
        sportType: 'Run',
        polyline: [
          { lat: 45.0, lng: 7.0 },
          { lat: 45.1, lng: 7.1 },
        ],
        visitCount: 10,
        distanceMeters: 1000,
      },
    ];

    const result = sectionsGeoJSON_FIXED(sectionsWithEmptyPolyline);

    // FIXED: Only valid section is included
    expect(result).not.toBeNull();
    expect(result?.features).toHaveLength(1);
    expect(result?.features[0].id).toBe('valid-section');
    expect(result?.features[0].geometry.coordinates.length).toBeGreaterThanOrEqual(2);

    // Validate no errors
    const errors = validateGeoJSON(result);
    expect(errors).toHaveLength(0);
  });

  it('FIXED: Filters out sections with single-point polylines', () => {
    const sectionsWithSinglePoint: TestSection[] = [
      {
        id: 'single-point-section',
        sportType: 'Ride',
        polyline: [{ lat: 45.0, lng: 7.0 }],
        visitCount: 3,
        distanceMeters: 0,
      },
    ];

    const result = sectionsGeoJSON_FIXED(sectionsWithSinglePoint);

    // FIXED: No valid features, returns null
    expect(result).toBeNull();
  });

  it('FIXED: Filters NaN coordinates but keeps valid section', () => {
    const sectionsWithNaN: TestSection[] = [
      {
        id: 'nan-section',
        sportType: 'Run',
        polyline: [
          { lat: NaN, lng: 7.0 }, // Invalid - will be filtered
          { lat: 45.1, lng: NaN }, // Invalid - will be filtered
          { lat: 45.2, lng: 7.2 },
          { lat: 45.3, lng: 7.3 },
        ],
        visitCount: 5,
        distanceMeters: 500,
      },
    ];

    const result = sectionsGeoJSON_FIXED(sectionsWithNaN);

    // FIXED: Only valid coordinates remain
    expect(result).not.toBeNull();
    expect(result?.features).toHaveLength(1);
    expect(result?.features[0].geometry.coordinates).toHaveLength(2);

    // No NaN values in result
    const errors = validateGeoJSON(result);
    expect(errors).toHaveLength(0);
  });

  it('FIXED: Returns null when all coordinates are NaN', () => {
    const allNaNSection: TestSection[] = [
      {
        id: 'all-nan',
        sportType: 'Run',
        polyline: [
          { lat: NaN, lng: NaN },
          { lat: NaN, lng: NaN },
        ],
        visitCount: 1,
        distanceMeters: 0,
      },
    ];

    const result = sectionsGeoJSON_FIXED(allNaNSection);

    // After filtering NaN, 0 valid points = section removed
    expect(result).toBeNull();
  });

  it('FIXED: Keeps only valid sections from mixed input', () => {
    const mixedSections: TestSection[] = [
      // Invalid: empty polyline
      {
        id: 'empty',
        sportType: 'Run',
        polyline: [],
        visitCount: 1,
        distanceMeters: 0,
      },
      // Invalid: single point
      {
        id: 'single',
        sportType: 'Run',
        polyline: [{ lat: 45.0, lng: 7.0 }],
        visitCount: 2,
        distanceMeters: 0,
      },
      // Invalid: all NaN
      {
        id: 'all-nan',
        sportType: 'Run',
        polyline: [
          { lat: NaN, lng: NaN },
          { lat: NaN, lng: NaN },
        ],
        visitCount: 3,
        distanceMeters: 0,
      },
      // Valid
      {
        id: 'valid-1',
        sportType: 'Ride',
        polyline: [
          { lat: 45.0, lng: 7.0 },
          { lat: 45.1, lng: 7.1 },
          { lat: 45.2, lng: 7.2 },
        ],
        visitCount: 10,
        distanceMeters: 2000,
      },
      // Valid (with some NaN filtered out, but 2+ remain)
      {
        id: 'valid-2',
        sportType: 'Run',
        polyline: [
          { lat: NaN, lng: 7.0 }, // Filtered
          { lat: 45.1, lng: 7.1 },
          { lat: 45.2, lng: 7.2 },
        ],
        visitCount: 5,
        distanceMeters: 1000,
      },
    ];

    const result = sectionsGeoJSON_FIXED(mixedSections);

    expect(result).not.toBeNull();
    expect(result?.features).toHaveLength(2);

    const ids = result?.features.map((f) => f.id);
    expect(ids).toContain('valid-1');
    expect(ids).toContain('valid-2');
    expect(ids).not.toContain('empty');
    expect(ids).not.toContain('single');
    expect(ids).not.toContain('all-nan');

    // Validate no errors
    const errors = validateGeoJSON(result);
    expect(errors).toHaveLength(0);
  });

  it('FIXED: Handles what useFrequentSections returned (empty polylines) gracefully', () => {
    // This is EXACTLY what useFrequentSections used to return - sections with empty polylines
    // See useFrequentSections.ts line 45: "polyline: [], // Lazy-loaded via useSectionPolyline"
    const sectionsFromOldHook: TestSection[] = [
      {
        id: 'sec_run_1',
        sportType: 'Run',
        polyline: [], // Empty - this is what useFrequentSections returns!
        visitCount: 5,
        distanceMeters: 1500,
      },
      {
        id: 'sec_ride_1',
        sportType: 'Ride',
        polyline: [], // Empty - this is what useFrequentSections returns!
        visitCount: 10,
        distanceMeters: 5000,
      },
    ];

    const result = sectionsGeoJSON_FIXED(sectionsFromOldHook);

    // FIXED: All invalid sections filtered out, returns null
    expect(result).toBeNull();

    // If we had mixed valid and invalid:
    const mixedSections = [
      ...sectionsFromOldHook,
      {
        id: 'valid',
        sportType: 'Run',
        polyline: [
          { lat: 45.0, lng: 7.0 },
          { lat: 45.1, lng: 7.1 },
        ],
        visitCount: 3,
        distanceMeters: 500,
      },
    ];

    const mixedResult = sectionsGeoJSON_FIXED(mixedSections);
    expect(mixedResult).not.toBeNull();
    expect(mixedResult?.features).toHaveLength(1);
    expect(mixedResult?.features[0].id).toBe('valid');

    // No validation errors
    const errors = validateGeoJSON(mixedResult);
    expect(errors).toHaveLength(0);
  });
});

// =============================================================================
// SOURCE CODE VERIFICATION - Verifies the actual source file has the fix
// =============================================================================

describe('Source code verification', () => {
  it('RegionalMapView uses useEngineSections (loads polylines) instead of useFrequentSections', () => {
    const fs = require('fs');
    const path = require('path');

    const filePath = path.resolve(__dirname, '../../components/maps/RegionalMapView.tsx');
    const source = fs.readFileSync(filePath, 'utf-8');

    // Should use useEngineSections (which loads polylines from Rust)
    expect(source).toContain('useEngineSections');

    // Should NOT use useFrequentSections (which returns empty polylines)
    // Check that it's not used for the sections variable
    const usesFrequentSectionsForSections =
      /const\s*\{\s*sections\s*\}\s*=\s*useFrequentSections/.test(source);
    expect(usesFrequentSectionsForSections).toBe(false);
  });

  it('RegionalMapView sectionsGeoJSON validates polyline length', () => {
    const fs = require('fs');
    const path = require('path');

    const filePath = path.resolve(__dirname, '../../components/maps/RegionalMapView.tsx');
    const source = fs.readFileSync(filePath, 'utf-8');

    // Should check for minimum 2 valid points (after filtering NaN and Infinity)
    // The code uses finitePoints.length < 2 (which is validPoints filtered for Infinity)
    expect(source).toMatch(/finitePoints\.length\s*<\s*2/);
  });

  it('RegionalMapView sectionsGeoJSON filters NaN coordinates', () => {
    const fs = require('fs');
    const path = require('path');

    const filePath = path.resolve(__dirname, '../../components/maps/RegionalMapView.tsx');
    const source = fs.readFileSync(filePath, 'utf-8');

    // Should filter NaN coordinates
    expect(source).toMatch(/isNaN\(pt\.lat\)/);
    expect(source).toMatch(/isNaN\(pt\.lng\)/);
  });

  it('RegionalMapView sectionsGeoJSON filters null features', () => {
    const fs = require('fs');
    const path = require('path');

    const filePath = path.resolve(__dirname, '../../components/maps/RegionalMapView.tsx');
    const source = fs.readFileSync(filePath, 'utf-8');

    // Should filter out null features
    expect(source).toMatch(/\.filter\(\(f\).*f\s*!==\s*null/);
  });
});
