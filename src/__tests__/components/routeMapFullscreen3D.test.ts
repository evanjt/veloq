/**
 * Scenario: a route's fullscreen map is switched to 3D with one attempt
 * highlighted.
 *
 * Expected behaviour: the terrain layer draws the other attempts in the
 * context colour, leaves the highlighted one out of them as the flat map's
 * filter does, and draws the highlighted one in its own collection.
 */

import { buildRoute3DLayer } from '@/features/routes/components/RouteMapView';

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

it('draws every other attempt in the context colour and draws the highlighted one apart', () => {
  const layer = buildRoute3DLayer({
    fadedTraces: attempts,
    highlightedTrace: highlighted,
    highlightedActivityId: 'dusk-ride',
    contextColor: '#123456',
  });

  expect(layer.sectionsGeoJSON?.features.map((f) => f.properties)).toEqual([
    { id: 'dawn-ride', color: '#123456' },
    { id: 'noon-ride', color: '#123456' },
  ]);
  expect(layer.highlightedTraceGeoJSON).toBe(highlighted);
});

it('draws every attempt as context when none is highlighted', () => {
  const none: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

  const layer = buildRoute3DLayer({
    fadedTraces: attempts,
    highlightedTrace: none,
    highlightedActivityId: null,
    contextColor: '#123456',
  });

  expect(layer.sectionsGeoJSON?.features).toHaveLength(3);
  expect(layer.highlightedTraceGeoJSON).toBe(none);
});
