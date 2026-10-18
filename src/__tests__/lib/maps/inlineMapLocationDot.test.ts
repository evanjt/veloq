/**
 * Scenario: the locate button on the inline activity and section maps shows the
 * athlete's position, as the regional map does.
 *
 * Expected behaviour: each spec set always declares the dot source, empty with no
 * fix, and draws the dot above the map's own layers; fullscreen section specs
 * leave the dot to the fullscreen shell, which draws its own.
 */

import {
  buildActivityLayers,
  buildActivitySources,
} from '@/features/maps/components/activityMapLayerSpecs';
import {
  buildSectionLayers,
  buildSectionSources,
} from '@/features/routes/components/sectionMapLayerSpecs';
import {
  buildUserLocationCollection,
  USER_LOCATION_SOURCE_ID,
} from '@/features/maps/lib/userLocationLayer';
import { mapPalette } from '@/theme';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const FIX: [number, number] = [7.5, 46.5];

function activitySources(userLocation: [number, number] | null) {
  return buildActivitySources({
    routeGeoJSON: EMPTY,
    overlayGeoJSON: EMPTY,
    consolidatedPortionsGeoJSON: EMPTY,
    sectionBoundariesGeoJSON: EMPTY,
    sectionMarkersGeoJSON: EMPTY,
    highlightGeoJSON: {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [0, 0] },
    },
    endpointsGeoJSON: EMPTY,
    sectionCreationLine: EMPTY,
    sectionCreationMarkers: EMPTY,
    userLocationGeoJSON: buildUserLocationCollection(userLocation),
  });
}

function activityLayers(hasUserLocation: boolean) {
  return buildActivityLayers({
    palette: mapPalette('light'),
    overlayHasData: false,
    gradientActive: false,
    gradientLineExpression: null,
    hasSectionOverlays: false,
    hasHighlightPoint: false,
    creationMode: false,
    hasUserLocation,
  });
}

const sectionInput = {
  sectionGeoJSON: EMPTY,
  trimmedGeoJSON: EMPTY,
  shadowGeoJSON: EMPTY,
  extensionGeoJSON: EMPTY,
  allTracesFeatureCollection: EMPTY,
  hasAllTraces: false,
  highlightedTraceFilter: undefined,
  highlightedTraceGeoJSON: EMPTY,
  highlightedLapGeoJSON: EMPTY,
  endpoints: EMPTY,
  sectionContext: false,
  trimRange: null,
  hasExtension: false,
  showExtensionAndSection: true,
  trimCasingWidth: 5,
  trimLineWidth: 4,
  traceCasingWidth: 5,
  traceLineWidth: 4,
};

function dotOpacities(layers: { id: string; paint?: unknown }[]) {
  return layers
    .filter((l) => l.id.startsWith('user-location'))
    .map((l) => (l.paint as Record<string, unknown>)['circle-opacity']);
}

describe('activity map location dot', () => {
  it('declares the dot source with no fix, as the empty collection', () => {
    const source = activitySources(null)[USER_LOCATION_SOURCE_ID] as {
      data: GeoJSON.FeatureCollection;
    };
    expect(source.data.features).toHaveLength(0);
  });

  it('puts the fix in the dot source', () => {
    const source = activitySources(FIX)[USER_LOCATION_SOURCE_ID] as {
      data: GeoJSON.FeatureCollection;
    };
    expect(source.data.features[0]?.geometry).toEqual({ type: 'Point', coordinates: FIX });
  });

  it('draws the dot last, hidden with no fix and shown with one', () => {
    const hidden = activityLayers(false);
    expect(hidden.slice(-2).map((l) => l.id)).toEqual([
      'user-location-outer',
      'user-location-inner',
    ]);
    expect(dotOpacities(hidden)).toEqual([0, 0]);
    expect(dotOpacities(activityLayers(true))).toEqual([0.3, 1]);
  });
});

describe('section map location dot', () => {
  it('declares the dot source with no fix and draws the dot last', () => {
    const input = {
      ...sectionInput,
      userLocationGeoJSON: buildUserLocationCollection(null),
      hasUserLocation: false,
    };
    const source = buildSectionSources(input)[USER_LOCATION_SOURCE_ID] as {
      data: GeoJSON.FeatureCollection;
    };
    expect(source.data.features).toHaveLength(0);
    const layers = buildSectionLayers({ ...input, palette: mapPalette('light') });
    expect(layers.slice(-2).map((l) => l.id)).toEqual([
      'user-location-outer',
      'user-location-inner',
    ]);
    expect(dotOpacities(layers)).toEqual([0, 0]);
  });

  it('shows the dot once a fix is held', () => {
    const input = {
      ...sectionInput,
      userLocationGeoJSON: buildUserLocationCollection(FIX),
      hasUserLocation: true,
    };
    const source = buildSectionSources(input)[USER_LOCATION_SOURCE_ID] as {
      data: GeoJSON.FeatureCollection;
    };
    expect(source.data.features).toHaveLength(1);
    expect(dotOpacities(buildSectionLayers({ ...input, palette: mapPalette('light') }))).toEqual([
      0.3, 1,
    ]);
  });

  it('adds no dot when the caller passes none, so the fullscreen shell keeps its own', () => {
    expect(buildSectionSources(sectionInput)[USER_LOCATION_SOURCE_ID]).toBeUndefined();
    expect(
      dotOpacities(buildSectionLayers({ ...sectionInput, palette: mapPalette('light') }))
    ).toEqual([]);
  });
});
