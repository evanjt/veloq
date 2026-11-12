/**
 * Scenario: a section portion on an activity map, on the flat map.
 *
 * Expected behaviour: no boundary tick is drawn at a portion's start or end.
 * The ticks were built in degree space, so away from the equator they leaned
 * off the road and changed length with heading; the map design drops them, so
 * the flat map carries no layer or source for them.
 */

import {
  buildActivityLayers,
  buildActivitySources,
  type ActivitySourceInput,
} from '@/features/maps/components/activityMapLayerSpecs';
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
});
