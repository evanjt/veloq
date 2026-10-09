/**
 * Scenario: an activity with a PR section and a matched route is opened in
 * fullscreen and switched to 3D.
 *
 * Expected behaviour: the fullscreen terrain layer gets the same section
 * portions and matched route the inline one does, and the PR markers it gets
 * are ones the terrain page draws as trophies, the layer its tap reads.
 */

import { renderHook } from '@testing-library/react-native';
import { useMapLayers } from '@/features/maps/hooks/useMapLayers';
import { buildActivity3DCollections } from '@/features/maps/components/activityMapLayerSpecs';
import type { SectionOverlay } from '@/features/maps/components/ActivityMapView';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

const track = Array.from({ length: 12 }, (_, i) => ({
  latitude: 46.948 + i * 0.001,
  longitude: 7.447 + i * 0.001,
}));

const overlays: SectionOverlay[] = [
  {
    id: 'ridge-climb',
    sectionPolyline: track.slice(1, 5),
    activityPortion: track.slice(1, 5),
    isPR: true,
  },
  { id: 'lake-loop', sectionPolyline: track.slice(6, 10), activityPortion: track.slice(6, 10) },
];

const matchedRoute = track;

function renderLayers() {
  return renderHook(() =>
    useMapLayers({
      validCoordinates: track,
      coordinates: track,
      routeOverlay: matchedRoute,
      sectionOverlays: overlays,
      highlightIndex: null,
      activeTab: 'charts',
    })
  ).result.current;
}

it('gives the fullscreen terrain layer the portions and matched route the inline one draws', () => {
  const layers = renderLayers();

  const inline = buildActivity3DCollections({
    portions: layers.consolidatedPortionsGeoJSON,
    matchedRoute: layers.overlayGeoJSON,
    markers: layers.sectionMarkersGeoJSON,
    boundaries: layers.sectionBoundariesGeoJSON,
  });
  const fullscreen = buildActivity3DCollections({
    portions: layers.consolidatedPortionsGeoJSON,
    matchedRoute: layers.overlayGeoJSON,
    markers: layers.fullscreenPRMarkersGeoJSON,
  });

  expect(fullscreen.tracesGeoJSON).toEqual(inline.tracesGeoJSON);
  expect(fullscreen.routesGeoJSON).toEqual(inline.routesGeoJSON);
  expect(fullscreen.tracesGeoJSON?.features.length).toBeGreaterThan(0);
  expect(fullscreen.routesGeoJSON?.features.length).toBe(1);
  expect(fullscreen.sectionBoundariesGeoJSON).toBeUndefined();
});

it('marks the fullscreen PR markers as PR, so the terrain page draws and taps them as trophies', () => {
  const { fullscreenPRMarkersGeoJSON } = renderLayers();

  const markers = buildActivity3DCollections({
    portions: { type: 'FeatureCollection', features: [] },
    matchedRoute: { type: 'FeatureCollection', features: [] },
    markers: fullscreenPRMarkersGeoJSON,
  }).sectionMarkersGeoJSON;

  expect(markers?.features.map((f) => f.properties)).toEqual([
    expect.objectContaining({ sectionId: 'ridge-climb', isPR: true }),
  ]);
});

it('leaves out the collections that hold nothing', () => {
  const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

  const collections = buildActivity3DCollections({
    portions: empty,
    matchedRoute: empty,
    markers: empty,
    boundaries: empty,
  });

  expect(collections.tracesGeoJSON).toBeUndefined();
  expect(collections.sectionMarkersGeoJSON).toBeUndefined();
  expect(collections.sectionBoundariesGeoJSON).toBeUndefined();
  expect(collections.routesGeoJSON).toEqual(empty);
});
