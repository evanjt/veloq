/**
 * Bug 4 regression test - sections must render through useMapGeoJSON
 *
 * The user reports that sections do not appear on the global/regional map at
 * any zoom level. This test verifies the data-prep layer
 * (`useMapGeoJSON.sectionsGeoJSON`) correctly converts engine-returned
 * sections into a non-empty FeatureCollection that the map component
 * consumes. If this test passes but the map still doesn't show sections,
 * the bug is downstream (rendering / visibility / source binding). If this
 * test fails, the data-prep is dropping sections.
 */

import { renderHook } from '@testing-library/react-native';
import { useMapGeoJSON } from '@/features/maps/components/regional/useMapGeoJSON';
import type { MapSection } from '@/features/routes/hooks';

/**
 * The overlay's own record: six fields and a line. It used to be built from the
 * whole `FrequentSection`, which is what the map used to read.
 */
function makeSection(overrides: Partial<MapSection> = {}): MapSection {
  return {
    id: 'sec-1',
    name: 'Test Loop',
    polyline: [
      { lat: 46.5, lng: 6.6 },
      { lat: 46.51, lng: 6.61 },
      { lat: 46.52, lng: 6.62 },
    ],
    visitCount: 3,
    distanceMeters: 1500,
    ...overrides,
  };
}

function buildArgs(sections: MapSection[]): Parameters<typeof useMapGeoJSON>[0] {
  return {
    allActivities: [],
    activityCenters: {},
    sections,
    userLocation: null,
    selected: null,
  };
}

describe('useMapGeoJSON.sectionsGeoJSON (Bug 4)', () => {
  it('produces a feature for each engine-returned section with a valid polyline', () => {
    const sections = [
      makeSection({ id: 'sec-a', name: 'A' }),
      makeSection({
        id: 'sec-b',
        name: 'B',
        polyline: [
          { lat: 46.6, lng: 6.7 },
          { lat: 46.61, lng: 6.71 },
        ],
      }),
    ];

    const { result } = renderHook(() => useMapGeoJSON(buildArgs(sections)));

    expect(result.current.sectionsGeoJSON.features.length).toBe(2);
    const ids = result.current.sectionsGeoJSON.features.map((f) => f.properties?.id).sort();
    expect(ids).toEqual(['sec-a', 'sec-b']);
  });

  it('returns an empty FeatureCollection when no sections exist (not null)', () => {
    const { result } = renderHook(() => useMapGeoJSON(buildArgs([])));

    // CRITICAL INVARIANT: never null - keeps ShapeSource mounted to avoid iOS Fabric crash
    expect(result.current.sectionsGeoJSON).toBeDefined();
    expect(result.current.sectionsGeoJSON.type).toBe('FeatureCollection');
    expect(result.current.sectionsGeoJSON.features).toEqual([]);
  });

  it('skips sections whose polylines have fewer than 2 valid points', () => {
    const sections = [
      makeSection({
        id: 'good',
        polyline: [
          { lat: 46.5, lng: 6.6 },
          { lat: 46.51, lng: 6.61 },
        ],
      }),
      makeSection({
        id: 'bad-too-short',
        polyline: [{ lat: 46.5, lng: 6.6 }],
      }),
      makeSection({
        id: 'bad-nan',
        polyline: [
          { lat: NaN, lng: 6.6 },
          { lat: 46.51, lng: NaN },
        ],
      }),
    ];

    const { result } = renderHook(() => useMapGeoJSON(buildArgs(sections)));

    expect(result.current.sectionsGeoJSON.features.length).toBe(1);
    expect(result.current.sectionsGeoJSON.features[0].properties?.id).toBe('good');
  });
});

describe('useMapGeoJSON section colour', () => {
  it('colours a section by its id, so the list order and the activity map agree', () => {
    const { sectionPalette, sectionPaletteIndex } = require('@/theme/colors');
    const ids = ['sec-a', 'sec-b', 'sec-c', 'sec-d', 'sec-e', 'sec-f', 'sec-g'];
    const forward = renderHook(() => useMapGeoJSON(buildArgs(ids.map((id) => makeSection({ id })))))
      .result.current.sectionsGeoJSON.features;
    const reversed = renderHook(() =>
      useMapGeoJSON(buildArgs([...ids].reverse().map((id) => makeSection({ id }))))
    ).result.current.sectionsGeoJSON.features;

    const colourOf = (fs: typeof forward, id: string) =>
      fs.find((f) => f.properties?.id === id)?.properties?.color;
    for (const id of ids) {
      expect(colourOf(forward, id)).toBe(sectionPalette[sectionPaletteIndex(id)]);
      expect(colourOf(reversed, id)).toBe(colourOf(forward, id));
    }
  });

  it('carries no pattern index, since no layer reads one', () => {
    const { result } = renderHook(() => useMapGeoJSON(buildArgs([makeSection()])));
    expect(result.current.sectionsGeoJSON.features[0].properties).not.toHaveProperty(
      'patternIndex'
    );
  });
});
