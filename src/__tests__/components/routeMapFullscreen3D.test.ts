/**
 * Scenario: a route's fullscreen map is switched to 3D with one attempt
 * highlighted.
 *
 * Expected behaviour: the terrain layer draws the other attempts faded in the
 * activity colour, leaves the highlighted one out of them as the flat map's
 * filter does, and draws the highlighted one in its own collection.
 */

import { buildRoute3DLayer } from '@/features/routes/components/RouteMapView';
import { colorWithOpacity } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

const line = (id: string, offset: number): GeoJSON.Feature => ({
  type: 'Feature',
  properties: { id },
  geometry: {
    type: 'LineString',
    coordinates: [
      [7.447 + offset, 46.948],
      [7.449 + offset, 46.95],
    ],
  },
});

const attempts: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [line('dawn-ride', 0), line('dusk-ride', 0.001), line('noon-ride', 0.002)],
};

const highlighted: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [attempts.features[1]],
};

it('fades every other attempt in the activity colour and draws the highlighted one apart', () => {
  const layer = buildRoute3DLayer({
    fadedTraces: attempts,
    highlightedTrace: highlighted,
    highlightedActivityId: 'dusk-ride',
    activityColor: '#123456',
  });

  expect(layer.sectionsGeoJSON?.features.map((f) => f.properties)).toEqual([
    { id: 'dawn-ride', color: colorWithOpacity('#123456', 0.2) },
    { id: 'noon-ride', color: colorWithOpacity('#123456', 0.2) },
  ]);
  expect(layer.highlightedTraceGeoJSON).toBe(highlighted);
});

it('draws every attempt faded when none is highlighted', () => {
  const none: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

  const layer = buildRoute3DLayer({
    fadedTraces: attempts,
    highlightedTrace: none,
    highlightedActivityId: null,
    activityColor: '#123456',
  });

  expect(layer.sectionsGeoJSON?.features).toHaveLength(3);
  expect(layer.highlightedTraceGeoJSON).toBe(none);
});
