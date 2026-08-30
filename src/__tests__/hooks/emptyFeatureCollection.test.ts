/**
 * Scenario: an idle map source has nothing to draw.
 * Expected behaviour: every surface hands Fabric the one shared empty
 * collection. A second referential identity re-mounts a ShapeSource for no
 * reason, and on iOS that is the fragile path.
 */

import { renderHook } from '@testing-library/react-native';
import { EMPTY_FEATURE_COLLECTION } from '@/features/maps/lib/coordinates';
import { useSectionMapLayers } from '@/features/routes/components/useSectionMapLayers';
import type { FrequentSection } from '@/types';

jest.mock('veloqrs', () => ({ decodeCoords: () => [] }));

const section = {
  id: 's1',
  name: 'Church Hill',
  sportType: 'Ride',
  polyline: [],
  distanceMeters: 1200,
  visitCount: 4,
} as unknown as FrequentSection;

it('hands the shared empty collection to every idle section source', () => {
  const { result } = renderHook(() =>
    useSectionMapLayers({ section, displayPoints: [], nearbyPolylines: [] })
  );

  expect(result.current.nearbyGeoJSON).toBe(EMPTY_FEATURE_COLLECTION);
  expect(result.current.allTracesFeatureCollection).toBe(EMPTY_FEATURE_COLLECTION);
  expect(result.current.hasAllTraces).toBe(false);
});
