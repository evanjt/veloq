/**
 * Scenario: a section portion on an activity map, inline and in the 3D page.
 *
 * Expected behaviour: no boundary tick is drawn at a portion's start or end.
 * The ticks were built in degree space, so away from the equator they leaned
 * off the road and changed length with heading; the map design drops them, so
 * neither the flat map nor the 3D page carries a layer or a source for them.
 */

import {
  buildActivityLayers,
  buildActivitySources,
  type ActivitySourceInput,
} from '@/features/maps/components/activityMapLayerSpecs';
import { buildUpdateLayersScript } from '@/features/maps/lib/htmlBuilders';
import { LAYER_KEYS } from '@/features/maps/lib/htmlBuilders/map3DScripts';
import { mapPalette } from '@/theme';

const palette = mapPalette('light');
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

describe('section boundary ticks', () => {
  it('adds no boundary layer to the flat map', () => {
    const ids = buildActivityLayers({
      palette,
      overlayHasData: true,
      gradientActive: false,
      gradientLineExpression: null,
      hasSectionOverlays: true,
      highlightedSectionId: null,
      hasHighlightPoint: false,
      creationMode: false,
      hasUserLocation: false,
    }).map((l) => l.id);

    expect(ids.filter((id) => id.includes('boundar'))).toEqual([]);
  });

  it('adds no boundary source to the flat map', () => {
    const input = {
      routeGeoJSON: EMPTY,
      overlayGeoJSON: EMPTY,
      consolidatedPortionsGeoJSON: EMPTY,
      sectionMarkersGeoJSON: EMPTY,
      highlightGeoJSON: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
      endpointsGeoJSON: EMPTY,
      sectionCreationLine: EMPTY,
      sectionCreationMarkers: EMPTY,
      userLocationGeoJSON: EMPTY,
    } as ActivitySourceInput;

    expect(Object.keys(buildActivitySources(input)).filter((k) => k.includes('boundar'))).toEqual(
      []
    );
  });

  it('draws and carries no boundary collection in the 3D page', () => {
    expect(LAYER_KEYS.filter((k) => /boundar/i.test(k))).toEqual([]);

    const populated = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [7.4, 46.9],
              [7.41, 46.91],
            ],
          },
        },
      ],
    } as GeoJSON.FeatureCollection;
    const everything = Object.fromEntries(
      LAYER_KEYS.map((k) => [k, k === 'highlightedSectionId' ? 's1' : populated])
    );
    const script = buildUpdateLayersScript(everything, palette);
    expect(script).not.toMatch(/boundar/i);
  });
});
