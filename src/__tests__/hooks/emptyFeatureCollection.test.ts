/**
 * Scenario: an idle map source has nothing to draw.
 * Expected behaviour: every surface hands Fabric the one shared empty
 * collection. A second referential identity re-mounts a ShapeSource for no
 * reason, and on iOS that is the fragile path.
 */

import { renderHook } from '@testing-library/react-native';
import { EMPTY_FEATURE_COLLECTION } from '@/features/maps/lib/coordinates';
import { useSectionMapLayers } from '@/features/routes/components/useSectionMapLayers';
import { useSectionCreation } from '@/features/maps/hooks/useSectionCreation';
import { useMapLayers } from '@/features/maps/hooks/useMapLayers';
import { buildFullscreenSectionSources } from '@/features/maps/components/activityMapLayerSpecs';
import type { FrequentSection } from '@/types';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: () => [],
  })
);

const section = {
  id: 's1',
  name: 'Church Hill',
  sportTypes: ['Ride'],
  polyline: [],
  distanceMeters: 1200,
  visitCount: 4,
} as unknown as FrequentSection;

it('hands the shared empty collection to every idle section source', () => {
  const { result } = renderHook(() => useSectionMapLayers({ section, displayPoints: [] }));

  expect(result.current.allTracesFeatureCollection).toBe(EMPTY_FEATURE_COLLECTION);
  expect(result.current.hasAllTraces).toBe(false);
});

const track = [
  { latitude: -33.87, longitude: 151.2 },
  { latitude: -33.871, longitude: 151.201 },
  { latitude: -33.872, longitude: 151.202 },
];

it('hands the shared empty collection to the section creation line while idle', () => {
  const { result, rerender } = renderHook(
    ({ creationMode }: { creationMode: boolean }) =>
      useSectionCreation({
        creationMode,
        externalCreationState: undefined,
        validCoordinates: track,
      }),
    { initialProps: { creationMode: false } }
  );
  expect(result.current.sectionGeoJSON).toBe(EMPTY_FEATURE_COLLECTION);

  rerender({ creationMode: true });
  expect(result.current.sectionGeoJSON).toBe(EMPTY_FEATURE_COLLECTION);
});

it('hands the shared empty collection to the fullscreen overlay when none is passed', () => {
  const sources = buildFullscreenSectionSources(EMPTY_FEATURE_COLLECTION, EMPTY_FEATURE_COLLECTION);
  expect(sources.overlay).toEqual({ kind: 'geojson', data: EMPTY_FEATURE_COLLECTION });
  expect((sources.overlay as { data: unknown }).data).toBe(EMPTY_FEATURE_COLLECTION);
});

it('draws no portions when the activity has no section overlays', () => {
  for (const sectionOverlays of [null, []]) {
    const { result } = renderHook(() =>
      useMapLayers({ validCoordinates: track, coordinates: track, sectionOverlays })
    );
    expect(result.current.consolidatedPortionsGeoJSON).toBe(EMPTY_FEATURE_COLLECTION);
  }
});
