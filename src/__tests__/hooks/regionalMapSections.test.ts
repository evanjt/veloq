/**
 * Bug 4 regression test — sections must render through useMapGeoJSON
 *
 * The user reports that sections do not appear on the global/regional map at
 * any zoom level. This test verifies the data-prep layer
 * (`useMapGeoJSON.sectionsGeoJSON`) correctly converts engine-returned
 * sections into a non-empty FeatureCollection that the map component
 * consumes. If this test passes but the map still doesn't show sections,
 * the bug is downstream (rendering / visibility / source binding). If this
 * test fails, the data-prep is dropping sections.
 */

// useMapGeoJSON transitively imports ActivityTypeFilter which pulls in
// react-native + @expo/vector-icons. Mock the small piece of that module
// we actually use so the test doesn't have to bring in the whole RN stack.
jest.mock('@/components/maps/ActivityTypeFilter', () => ({
  getActivityTypeConfig: () => ({ color: '#FC4C02', icon: 'bike', label: 'Ride' }),
}));

import { renderHook } from '@testing-library/react-native';
import { useMapGeoJSON } from '@/components/maps/regional/useMapGeoJSON';
import type { FrequentSection } from '@/types';

// Minimal stub TFunction — useMapGeoJSON only calls it for fallback names.
const t = ((key: string, opts?: { number?: string }) =>
  opts?.number ? `${key}-${opts.number}` : key) as unknown as Parameters<
  typeof useMapGeoJSON
>[0]['t'];

function makeSection(overrides: Partial<FrequentSection> = {}): FrequentSection {
  return {
    id: 'sec-1',
    name: 'Test Loop',
    sportType: 'Ride',
    polyline: [
      { lat: 46.5, lng: 6.6 },
      { lat: 46.51, lng: 6.61 },
      { lat: 46.52, lng: 6.62 },
    ],
    visitCount: 3,
    distanceMeters: 1500,
    representativeActivityId: 'act-1',
    activityIds: ['act-1', 'act-2', 'act-3'],
    activityPortions: [],
    routeIds: [],
    confidence: 0.9,
    observationCount: 3,
    averageSpread: 5,
    pointDensity: [],
    stability: 0.9,
    version: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    isUserDefined: false,
    sectionType: 'auto',
    ...overrides,
  } as unknown as FrequentSection;
}

function buildArgs(sections: FrequentSection[]): Parameters<typeof useMapGeoJSON>[0] {
  return {
    allActivities: [],
    visibleActivities: [],
    activityCenters: {},
    routeSignatures: {},
    sections,
    routeGroups: [],
    showRoutes: false,
    userLocation: null,
    selected: null,
    t,
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

    // CRITICAL INVARIANT: never null — keeps ShapeSource mounted to avoid iOS Fabric crash
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
