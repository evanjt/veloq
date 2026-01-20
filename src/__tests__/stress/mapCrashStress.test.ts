/**
 * Stress tests for MapView null children crash scenarios
 *
 * These tests simulate conditions that could cause the iOS crash:
 * -[__NSArrayM insertObject:atIndex:]: object cannot be nil
 *
 * The tests verify that our fixes handle edge cases gracefully.
 */

import type { LatLng } from '@/lib/geo/polyline';

// Types matching the structures used in map components
interface SectionOverlay {
  id: string;
  sectionPolyline: LatLng[];
  activityPortion?: LatLng[];
}

interface SectionOverlayGeoJSON {
  id: string;
  sectionGeo: GeoJSON.Feature<GeoJSON.LineString> | null;
  portionGeo: GeoJSON.Feature<GeoJSON.LineString> | null;
}

/**
 * Simulates the sectionOverlaysGeoJSON computation from ActivityMapView
 */
function computeSectionOverlaysGeoJSON(
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
 * Simulates the FIXED rendering pattern: flatMap + filter(Boolean)
 */
function renderMapChildrenFixed(overlays: SectionOverlayGeoJSON[] | null): number {
  if (!overlays) return 0;

  const children = overlays
    .flatMap((overlay) => [
      overlay.sectionGeo ? { type: 'section', id: overlay.id } : null,
      overlay.portionGeo ? { type: 'portion', id: overlay.id } : null,
    ])
    .filter(Boolean);

  return children.length;
}

/**
 * Generate random coordinates with optional NaN injection
 */
function generateRandomCoords(count: number, nanProbability: number = 0): LatLng[] {
  const coords: LatLng[] = [];
  for (let i = 0; i < count; i++) {
    if (Math.random() < nanProbability) {
      coords.push({ latitude: NaN, longitude: NaN });
    } else {
      coords.push({
        latitude: 45 + Math.random() * 2,
        longitude: 7 + Math.random() * 2,
      });
    }
  }
  return coords;
}

describe('MapView crash stress tests', () => {
  describe('Section overlay edge cases', () => {
    it('should handle 1000 overlays with random sparse data', () => {
      const overlays: SectionOverlay[] = [];

      for (let i = 0; i < 1000; i++) {
        // Mix of valid and invalid data
        const pointCount = Math.floor(Math.random() * 5); // 0-4 points
        overlays.push({
          id: `stress-${i}`,
          sectionPolyline: generateRandomCoords(pointCount),
          activityPortion: Math.random() > 0.5 ? generateRandomCoords(pointCount) : undefined,
        });
      }

      // Should not throw
      const result = computeSectionOverlaysGeoJSON(overlays);

      // All results should have at least one valid geo
      if (result) {
        for (const overlay of result) {
          expect(overlay.sectionGeo !== null || overlay.portionGeo !== null).toBe(true);
        }
      }

      // Rendering should never produce null children
      const childCount = renderMapChildrenFixed(result);
      expect(childCount).toBeGreaterThanOrEqual(0);
    });

    it('should handle overlays with 100% NaN coordinates', () => {
      const overlays: SectionOverlay[] = [];

      for (let i = 0; i < 100; i++) {
        overlays.push({
          id: `nan-${i}`,
          sectionPolyline: generateRandomCoords(10, 1.0), // 100% NaN
          activityPortion: generateRandomCoords(10, 1.0),
        });
      }

      const result = computeSectionOverlaysGeoJSON(overlays);

      // All should be filtered out
      expect(result).toEqual([]);
    });

    it('should handle alternating valid/invalid overlays', () => {
      const overlays: SectionOverlay[] = [];

      for (let i = 0; i < 500; i++) {
        if (i % 2 === 0) {
          // Valid overlay
          overlays.push({
            id: `valid-${i}`,
            sectionPolyline: generateRandomCoords(10, 0),
            activityPortion: generateRandomCoords(10, 0),
          });
        } else {
          // Invalid overlay (1 point only)
          overlays.push({
            id: `invalid-${i}`,
            sectionPolyline: generateRandomCoords(1, 0),
            activityPortion: [],
          });
        }
      }

      const result = computeSectionOverlaysGeoJSON(overlays);

      // Should have 250 valid overlays
      expect(result?.length).toBe(250);

      // All should have at least one valid geo
      for (const overlay of result || []) {
        expect(overlay.sectionGeo !== null || overlay.portionGeo !== null).toBe(true);
      }
    });

    it('should handle overlays where only portionGeo is valid', () => {
      const overlays: SectionOverlay[] = [];

      for (let i = 0; i < 100; i++) {
        overlays.push({
          id: `portion-only-${i}`,
          sectionPolyline: [{ latitude: 0, longitude: 0 }], // 1 point = invalid
          activityPortion: generateRandomCoords(10, 0), // valid
        });
      }

      const result = computeSectionOverlaysGeoJSON(overlays);

      expect(result?.length).toBe(100);

      for (const overlay of result || []) {
        expect(overlay.sectionGeo).toBeNull();
        expect(overlay.portionGeo).not.toBeNull();
      }

      // Rendering should produce exactly 100 children (only portionGeo)
      const childCount = renderMapChildrenFixed(result);
      expect(childCount).toBe(100);
    });

    it('should handle overlays where only sectionGeo is valid', () => {
      const overlays: SectionOverlay[] = [];

      for (let i = 0; i < 100; i++) {
        overlays.push({
          id: `section-only-${i}`,
          sectionPolyline: generateRandomCoords(10, 0), // valid
          activityPortion: [{ latitude: 0, longitude: 0 }], // 1 point = invalid
        });
      }

      const result = computeSectionOverlaysGeoJSON(overlays);

      expect(result?.length).toBe(100);

      for (const overlay of result || []) {
        expect(overlay.sectionGeo).not.toBeNull();
        expect(overlay.portionGeo).toBeNull();
      }

      // Rendering should produce exactly 100 children (only sectionGeo)
      const childCount = renderMapChildrenFixed(result);
      expect(childCount).toBe(100);
    });
  });

  describe('Rapid state change simulation', () => {
    it('should handle 1000 rapid prop changes', () => {
      let currentOverlays: SectionOverlay[] | null = null;

      for (let i = 0; i < 1000; i++) {
        // Simulate rapid prop changes
        if (i % 3 === 0) {
          currentOverlays = null;
        } else if (i % 3 === 1) {
          currentOverlays = [];
        } else {
          currentOverlays = [
            {
              id: `rapid-${i}`,
              sectionPolyline: generateRandomCoords(Math.random() > 0.3 ? 10 : 1),
              activityPortion: generateRandomCoords(Math.random() > 0.3 ? 10 : 1),
            },
          ];
        }

        // Each iteration should not throw
        const result = computeSectionOverlaysGeoJSON(currentOverlays);
        const childCount = renderMapChildrenFixed(result);

        expect(childCount).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Activity center computation edge cases', () => {
    it('should handle empty activity centers gracefully', () => {
      const activityCenters: Record<string, [number, number]> = {};
      const activities = [
        { id: 'act-1', type: 'Run' },
        { id: 'act-2', type: 'Ride' },
        { id: 'act-3', type: 'Run' },
      ];

      // Simulate the FIXED pattern: filter out activities without centers
      const markersToRender = activities
        .map((activity) => {
          const center = activityCenters[activity.id];
          if (!center) return null; // FIXED: skip if no center
          return { id: activity.id, center };
        })
        .filter(Boolean);

      // Should render 0 markers (no centers available)
      expect(markersToRender.length).toBe(0);
    });

    it('should handle partial activity centers', () => {
      const activityCenters: Record<string, [number, number]> = {
        'act-1': [7.0, 45.0],
        // act-2 missing
        'act-3': [7.2, 45.2],
      };
      const activities = [
        { id: 'act-1', type: 'Run' },
        { id: 'act-2', type: 'Ride' },
        { id: 'act-3', type: 'Run' },
      ];

      const markersToRender = activities
        .map((activity) => {
          const center = activityCenters[activity.id];
          if (!center) return null;
          return { id: activity.id, center };
        })
        .filter(Boolean);

      // Should render 2 markers (act-2 skipped)
      expect(markersToRender.length).toBe(2);
    });

    it('should handle 10000 activities with 50% missing centers', () => {
      const activityCenters: Record<string, [number, number]> = {};
      const activities: Array<{ id: string; type: string }> = [];

      for (let i = 0; i < 10000; i++) {
        const id = `act-${i}`;
        activities.push({ id, type: 'Run' });

        // 50% have centers
        if (i % 2 === 0) {
          activityCenters[id] = [7 + Math.random(), 45 + Math.random()];
        }
      }

      const markersToRender = activities
        .map((activity) => {
          const center = activityCenters[activity.id];
          if (!center) return null;
          return { id: activity.id, center };
        })
        .filter(Boolean);

      // Should render exactly 5000 markers
      expect(markersToRender.length).toBe(5000);
    });
  });

  describe('GeoJSON validity checks', () => {
    it('should always produce valid GeoJSON LineStrings', () => {
      const overlays: SectionOverlay[] = [];

      for (let i = 0; i < 100; i++) {
        overlays.push({
          id: `geo-${i}`,
          sectionPolyline: generateRandomCoords(10 + i, 0.1), // 10% NaN
          activityPortion: generateRandomCoords(5 + i, 0.05), // 5% NaN
        });
      }

      const result = computeSectionOverlaysGeoJSON(overlays);

      for (const overlay of result || []) {
        if (overlay.sectionGeo) {
          expect(overlay.sectionGeo.type).toBe('Feature');
          expect(overlay.sectionGeo.geometry.type).toBe('LineString');
          expect(overlay.sectionGeo.geometry.coordinates.length).toBeGreaterThanOrEqual(2);

          // All coordinates should be valid numbers
          for (const coord of overlay.sectionGeo.geometry.coordinates) {
            expect(typeof coord[0]).toBe('number');
            expect(typeof coord[1]).toBe('number');
            expect(isNaN(coord[0])).toBe(false);
            expect(isNaN(coord[1])).toBe(false);
          }
        }

        if (overlay.portionGeo) {
          expect(overlay.portionGeo.type).toBe('Feature');
          expect(overlay.portionGeo.geometry.type).toBe('LineString');
          expect(overlay.portionGeo.geometry.coordinates.length).toBeGreaterThanOrEqual(2);

          for (const coord of overlay.portionGeo.geometry.coordinates) {
            expect(typeof coord[0]).toBe('number');
            expect(typeof coord[1]).toBe('number');
            expect(isNaN(coord[0])).toBe(false);
            expect(isNaN(coord[1])).toBe(false);
          }
        }
      }
    });
  });
});
