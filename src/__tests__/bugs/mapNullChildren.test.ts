/**
 * Regression test for iOS crash: -[__NSArrayM insertObject:atIndex:]: object cannot be nil
 *
 * This crash occurs when MapLibre's native iOS component receives null children
 * from React's conditional rendering. When React.Fragment contains only false/null
 * children (from `{condition && <Component>}`), the native component crashes trying
 * to insert nil into its subview array.
 *
 * Root cause: sectionOverlaysGeoJSON could contain entries where both sectionGeo
 * and portionGeo are null (when polylines have < 2 valid points).
 *
 * Fix: Use flatMap + filter(Boolean) instead of map with React.Fragment
 *
 * @see /crashreports/testflight_feedback/crashlog.crash
 */

import type { LatLng } from '@/lib/geo/polyline';
import * as fs from 'fs';
import * as path from 'path';

// Type matching the SectionOverlay structure used in ActivityMapView
interface SectionOverlay {
  id: string;
  sectionPolyline: LatLng[];
  activityPortion?: LatLng[];
}

// Type for the GeoJSON result
interface SectionOverlayGeoJSON {
  id: string;
  sectionGeo: GeoJSON.Feature<GeoJSON.LineString> | null;
  portionGeo: GeoJSON.Feature<GeoJSON.LineString> | null;
}

/**
 * Extracted logic from ActivityMapView.tsx sectionOverlaysGeoJSON useMemo
 * This is the BEFORE fix version that would allow null geos through
 */
function computeSectionOverlaysGeoJSON_BEFORE(
  sectionOverlays: SectionOverlay[] | null | undefined
): SectionOverlayGeoJSON[] | null {
  if (!sectionOverlays || sectionOverlays.length === 0) return null;

  return sectionOverlays
    .map((overlay) => {
      const validSectionPoints = overlay.sectionPolyline.filter(
        (c) => !isNaN(c.latitude) && !isNaN(c.longitude)
      );
      const sectionGeo =
        validSectionPoints.length >= 2
          ? {
              type: 'Feature' as const,
              properties: { id: overlay.id, type: 'section' },
              geometry: {
                type: 'LineString' as const,
                coordinates: validSectionPoints.map((c) => [c.longitude, c.latitude]),
              },
            }
          : null;

      const validPortionPoints = overlay.activityPortion?.filter(
        (c) => !isNaN(c.latitude) && !isNaN(c.longitude)
      );
      const portionGeo =
        validPortionPoints && validPortionPoints.length >= 2
          ? {
              type: 'Feature' as const,
              properties: { id: overlay.id, type: 'portion' },
              geometry: {
                type: 'LineString' as const,
                coordinates: validPortionPoints.map((c) => [c.longitude, c.latitude]),
              },
            }
          : null;

      return { id: overlay.id, sectionGeo, portionGeo };
    })
    .filter((o) => o.sectionGeo || o.portionGeo);
}

/**
 * Simulates the AFTER fix rendering behavior: flatMap + filter(Boolean)
 * Returns the number of non-null elements that would be rendered
 */
function countNonNullMapChildren(overlays: SectionOverlayGeoJSON[] | null): number {
  if (!overlays) return 0;

  // This is the FIXED pattern: flatMap + filter(Boolean)
  const children = overlays
    .flatMap((overlay) => [
      overlay.sectionGeo ? { type: 'section', id: overlay.id } : null,
      overlay.portionGeo ? { type: 'portion', id: overlay.id } : null,
    ])
    .filter(Boolean);

  return children.length;
}

/**
 * Simulates the BEFORE fix rendering behavior: map with React.Fragment
 * This would pass null/false children to MapView, causing iOS crash
 */
function countChildrenBeforeFix(overlays: SectionOverlayGeoJSON[] | null): {
  total: number;
  nullChildren: number;
} {
  if (!overlays) return { total: 0, nullChildren: 0 };

  let total = 0;
  let nullChildren = 0;

  for (const overlay of overlays) {
    // React.Fragment would contain these children:
    // {overlay.sectionGeo && <GeoJSONSource>} - could be false
    // {overlay.portionGeo && <GeoJSONSource>} - could be false
    total += 2; // Each fragment has 2 potential children

    if (!overlay.sectionGeo) nullChildren++;
    if (!overlay.portionGeo) nullChildren++;
  }

  return { total, nullChildren };
}

describe('MapView null children crash prevention', () => {
  describe('sectionOverlaysGeoJSON computation', () => {
    it('should filter out overlays where both geos are null', () => {
      const overlays: SectionOverlay[] = [
        // Valid overlay with >= 2 points
        {
          id: 'valid',
          sectionPolyline: [
            { latitude: 0, longitude: 0 },
            { latitude: 1, longitude: 1 },
          ],
          activityPortion: [
            { latitude: 0, longitude: 0 },
            { latitude: 1, longitude: 1 },
          ],
        },
        // Invalid overlay - only 1 point (would produce null sectionGeo)
        {
          id: 'sparse-section',
          sectionPolyline: [{ latitude: 0, longitude: 0 }],
          activityPortion: [
            { latitude: 0, longitude: 0 },
            { latitude: 1, longitude: 1 },
          ],
        },
        // Completely invalid - both will be null (CRASH TRIGGER)
        {
          id: 'both-null',
          sectionPolyline: [{ latitude: 0, longitude: 0 }], // < 2 points
          activityPortion: [], // empty
        },
      ];

      const result = computeSectionOverlaysGeoJSON_BEFORE(overlays);

      // The filter (o.sectionGeo || o.portionGeo) should remove 'both-null'
      expect(result).toHaveLength(2);
      expect(result?.map((o) => o.id)).toEqual(['valid', 'sparse-section']);
    });

    it('should produce null sectionGeo when polyline has < 2 valid points', () => {
      const overlays: SectionOverlay[] = [
        {
          id: 'single-point',
          sectionPolyline: [{ latitude: 45.0, longitude: 7.0 }],
          activityPortion: [
            { latitude: 45.0, longitude: 7.0 },
            { latitude: 45.1, longitude: 7.1 },
          ],
        },
      ];

      const result = computeSectionOverlaysGeoJSON_BEFORE(overlays);

      expect(result).toHaveLength(1);
      expect(result?.[0].sectionGeo).toBeNull(); // This is the problematic null
      expect(result?.[0].portionGeo).not.toBeNull();
    });

    it('should filter NaN coordinates before counting', () => {
      const overlays: SectionOverlay[] = [
        {
          id: 'has-nan',
          sectionPolyline: [
            { latitude: NaN, longitude: 0 },
            { latitude: 1, longitude: NaN },
            { latitude: 2, longitude: 2 },
            { latitude: 3, longitude: 3 },
          ],
        },
      ];

      const result = computeSectionOverlaysGeoJSON_BEFORE(overlays);

      // Only 2 valid points after filtering NaN
      expect(result).toHaveLength(1);
      expect(result?.[0].sectionGeo).not.toBeNull();
      expect(result?.[0].sectionGeo?.geometry.coordinates).toHaveLength(2);
    });

    it('should handle empty sectionOverlays', () => {
      expect(computeSectionOverlaysGeoJSON_BEFORE([])).toBeNull();
      expect(computeSectionOverlaysGeoJSON_BEFORE(null)).toBeNull();
      expect(computeSectionOverlaysGeoJSON_BEFORE(undefined)).toBeNull();
    });
  });

  describe('React rendering pattern - CRITICAL CRASH SCENARIO', () => {
    it('BEFORE FIX: React.Fragment pattern passes null children to MapView', () => {
      // This overlay has valid portionGeo but null sectionGeo
      // The React.Fragment would contain: [false, <GeoJSONSource>]
      // MapLibre iOS crashes when trying to insert false/null
      const overlaysWithPartialNulls: SectionOverlayGeoJSON[] = [
        {
          id: 'partial-null',
          sectionGeo: null, // Would cause {null && <Component>} = false
          portionGeo: {
            type: 'Feature',
            properties: { id: 'partial-null', type: 'portion' },
            geometry: {
              type: 'LineString',
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
          },
        },
      ];

      const beforeFix = countChildrenBeforeFix(overlaysWithPartialNulls);

      // BEFORE fix: Fragment has 2 children slots, 1 is null
      expect(beforeFix.total).toBe(2);
      expect(beforeFix.nullChildren).toBe(1); // THIS CAUSES THE CRASH
    });

    it('AFTER FIX: flatMap + filter(Boolean) removes null children', () => {
      const overlaysWithPartialNulls: SectionOverlayGeoJSON[] = [
        {
          id: 'partial-null',
          sectionGeo: null,
          portionGeo: {
            type: 'Feature',
            properties: { id: 'partial-null', type: 'portion' },
            geometry: {
              type: 'LineString',
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
          },
        },
      ];

      const afterFix = countNonNullMapChildren(overlaysWithPartialNulls);

      // AFTER fix: Only 1 non-null child is rendered
      expect(afterFix).toBe(1); // No null children = no crash
    });

    it('CRASH SCENARIO: overlay with both null geos would crash before fix', () => {
      // Even though our filter removes these, edge cases could slip through
      // during race conditions or async updates
      const crashTrigger: SectionOverlayGeoJSON[] = [
        {
          id: 'crash-trigger',
          sectionGeo: null,
          portionGeo: null,
        },
      ];

      const beforeFix = countChildrenBeforeFix(crashTrigger);
      const afterFix = countNonNullMapChildren(crashTrigger);

      // BEFORE: 2 null children would be passed to MapView -> CRASH
      expect(beforeFix.nullChildren).toBe(2);

      // AFTER: 0 children rendered, no crash
      expect(afterFix).toBe(0);
    });
  });

  describe('Edge cases that could cause sparse sections', () => {
    it('should handle section with all NaN coordinates', () => {
      const overlays: SectionOverlay[] = [
        {
          id: 'all-nan',
          sectionPolyline: [
            { latitude: NaN, longitude: NaN },
            { latitude: NaN, longitude: NaN },
          ],
        },
      ];

      const result = computeSectionOverlaysGeoJSON_BEFORE(overlays);

      // All NaN = 0 valid points = both null = filtered out by .filter()
      // Result is empty array (not null - null only returned for empty input)
      expect(result).toEqual([]);
    });

    it('should handle section with mixed valid/invalid coordinates', () => {
      const overlays: SectionOverlay[] = [
        {
          id: 'mixed',
          sectionPolyline: [
            { latitude: 45.0, longitude: 7.0 },
            { latitude: NaN, longitude: 7.1 }, // invalid
            { latitude: 45.2, longitude: NaN }, // invalid
            { latitude: 45.3, longitude: 7.3 },
          ],
        },
      ];

      const result = computeSectionOverlaysGeoJSON_BEFORE(overlays);

      expect(result).toHaveLength(1);
      expect(result?.[0].sectionGeo?.geometry.coordinates).toHaveLength(2);
    });

    it('should handle empty activityPortion gracefully', () => {
      const overlays: SectionOverlay[] = [
        {
          id: 'no-portion',
          sectionPolyline: [
            { latitude: 0, longitude: 0 },
            { latitude: 1, longitude: 1 },
          ],
          activityPortion: undefined,
        },
      ];

      const result = computeSectionOverlaysGeoJSON_BEFORE(overlays);

      expect(result).toHaveLength(1);
      expect(result?.[0].sectionGeo).not.toBeNull();
      expect(result?.[0].portionGeo).toBeNull();
    });
  });
});

/**
 * SOURCE CODE VERIFICATION TESTS
 *
 * These tests verify that the actual source files contain the necessary
 * fix patterns. They will FAIL if the fix is reverted.
 */
describe('Source code fix verification', () => {
  const componentsDir = path.resolve(__dirname, '../../components/maps');

  describe('ActivityMapView.tsx', () => {
    it('must use consolidated GeoJSONSources for section overlays (Fabric crash prevention)', () => {
      const filePath = path.join(componentsDir, 'ActivityMapView.tsx');
      const source = fs.readFileSync(filePath, 'utf-8');

      // Must use consolidated GeoJSONs to avoid Fabric add/remove cycles
      const hasConsolidatedSections = source.includes('consolidatedSectionsGeoJSON');
      const hasConsolidatedPortions = source.includes('consolidatedPortionsGeoJSON');

      // Must NOT have the old React.Fragment pattern for section overlays
      const hasOldFragmentPattern = source.includes('<React.Fragment key={`section-overlay-');

      expect(hasConsolidatedSections).toBe(true);
      expect(hasConsolidatedPortions).toBe(true);
      expect(hasOldFragmentPattern).toBe(false);
    });

    it('must use stable GeoJSONSource IDs for section overlays', () => {
      const filePath = path.join(componentsDir, 'ActivityMapView.tsx');
      const source = fs.readFileSync(filePath, 'utf-8');

      // Must have stable GeoJSONSource IDs (not dynamic ones based on overlay.id)
      const hasStableSectionSourceId = source.includes('id="section-overlays-consolidated"');
      const hasStablePortionSourceId = source.includes('id="portion-overlays-consolidated"');
      const hasFullscreenSectionSourceId = source.includes('id="fs-section-overlays-consolidated"');
      const hasFullscreenPortionSourceId = source.includes('id="fs-portion-overlays-consolidated"');

      expect(hasStableSectionSourceId).toBe(true);
      expect(hasStablePortionSourceId).toBe(true);
      expect(hasFullscreenSectionSourceId).toBe(true);
      expect(hasFullscreenPortionSourceId).toBe(true);
    });
  });

  describe('RegionalMapView.tsx', () => {
    it('must guard against undefined activity centers', () => {
      const filePath = path.join(componentsDir, 'RegionalMapView.tsx');
      const source = fs.readFileSync(filePath, 'utf-8');

      // Must have null check for center
      const hasNullGuard = source.includes('if (!center) return null');

      // Must filter the result
      const hasFilter = source.includes('.filter(Boolean)');

      expect(hasNullGuard).toBe(true);
      expect(hasFilter).toBe(true);
    });
  });

  describe('BaseMapView.tsx', () => {
    it('must filter null children before passing to MapView', () => {
      const filePath = path.join(componentsDir, 'BaseMapView.tsx');
      const source = fs.readFileSync(filePath, 'utf-8');

      // Must have children filtering using React.Children
      // Pattern: React.Children.toArray(children).filter(Boolean)
      const hasChildrenFilter =
        source.includes('React.Children.toArray') || source.includes('Children.toArray');

      // The filtered children should be used somewhere
      const hasFilteredChildren = source.includes('.filter(Boolean)');

      expect(hasChildrenFilter).toBe(true);
      expect(hasFilteredChildren).toBe(true);
    });
  });
});
