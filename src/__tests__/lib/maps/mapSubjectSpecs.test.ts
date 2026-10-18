/**
 * Each detail map kind builds what it draws with one function of its data, which the kind's view
 * and a host's shared surface both use. These pin that each returns its subject's line, the layers
 * over it, the icons those layers name and the extent the map fits.
 */
import { mapPalette } from '@/theme';
import { EMPTY_FEATURE_COLLECTION, lngLatFromShort } from '@/features/maps';
import {
  ACTIVITY_MAP_IMAGES,
  activityMapSpecs,
  SECTION_MARKER_LAYER_IDS,
  type ActivityLayerInput,
  type ActivitySourceInput,
} from '@/features/maps/components/activityMapLayerSpecs';
import { routeMapSpecs } from '@/features/routes/components/routeMapLayerSpecs';
import { sectionMapSpecs } from '@/features/routes/components/sectionMapLayerSpecs';

const palette = mapPalette('light');

const lineCollection = (coords: [number, number][]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
  ],
});

const meadow = lngLatFromShort([
  { lat: 45, lng: 6 },
  { lat: 45.01, lng: 6.02 },
  { lat: 45.02, lng: 6.04 },
]);

function layerIds(layers: { id: string }[]): string[] {
  return layers.map((layer) => layer.id);
}

describe('routeMapSpecs', () => {
  const input = {
    routeCoords: meadow,
    routeLine: lineCollection(meadow),
    fadedTraces: EMPTY_FEATURE_COLLECTION,
    highlightedTrace: EMPTY_FEATURE_COLLECTION,
    endpoints: EMPTY_FEATURE_COLLECTION,
    deltaGaps: EMPTY_FEATURE_COLLECTION,
    palette,
    fadedFilter: undefined,
    routeContext: false,
    deltaBands: null,
  };

  it('draws the route line over the other attempts and fits it with room for strays', () => {
    const specs = routeMapSpecs(input);

    expect(specs.sources.route).toEqual({
      kind: 'geojson',
      data: input.routeLine,
      lineMetrics: true,
    });
    expect(Object.keys(specs.sources)).toEqual(
      expect.arrayContaining(['faded-traces', 'highlighted-trace', 'endpoints', 'delta-gaps'])
    );
    const ids = layerIds(specs.layers);
    expect(ids.indexOf('faded-traces-line')).toBeLessThan(ids.indexOf('route-line'));
    expect(ids.indexOf('route-line')).toBeLessThan(ids.indexOf('highlighted-line'));
    expect(specs.images.map((image) => image.id)).toEqual(['section-start', 'section-end']);
    // 0.02 of longitude and 0.04 of latitude span, with a tenth of each either side.
    expect(specs.bounds?.sw[0]).toBeCloseTo(5.996, 6);
    expect(specs.bounds?.sw[1]).toBeCloseTo(44.998, 6);
    expect(specs.bounds?.ne[0]).toBeCloseTo(6.044, 6);
    expect(specs.bounds?.ne[1]).toBeCloseTo(45.022, 6);
  });

  it('has no extent for a route with no line', () => {
    expect(routeMapSpecs({ ...input, routeCoords: [] }).bounds).toBeNull();
  });
});

describe('sectionMapSpecs', () => {
  const sectionLine = lineCollection(meadow);
  const base = {
    sectionGeoJSON: sectionLine,
    trimmedGeoJSON: EMPTY_FEATURE_COLLECTION,
    shadowGeoJSON: EMPTY_FEATURE_COLLECTION,
    extensionGeoJSON: EMPTY_FEATURE_COLLECTION,
    allTracesFeatureCollection: EMPTY_FEATURE_COLLECTION,
    hasAllTraces: false,
    highlightedTraceFilter: undefined,
    highlightedTraceGeoJSON: EMPTY_FEATURE_COLLECTION,
    highlightedLapGeoJSON: EMPTY_FEATURE_COLLECTION,
    endpoints: EMPTY_FEATURE_COLLECTION,
    deltaGapsGeoJSON: EMPTY_FEATURE_COLLECTION,
    sectionContext: false,
    trimRange: null,
    hasExtension: false,
    showExtensionAndSection: true,
    trimCasingWidth: 5,
    trimLineWidth: 4,
    traceCasingWidth: 5,
    traceLineWidth: 4,
    palette,
    extentCoords: meadow,
  };

  it('draws the section line with its chevron icon and fits the section', () => {
    const specs = sectionMapSpecs(base);

    expect(specs.sources.section).toEqual({
      kind: 'geojson',
      data: sectionLine,
      lineMetrics: true,
    });
    expect(layerIds(specs.layers)).toEqual(
      expect.arrayContaining(['section-casing', 'section-line', 'section-direction'])
    );
    expect(specs.images.map((image) => image.id)).toEqual(
      expect.arrayContaining(['section-start', 'section-end'])
    );
    expect(specs.images.length).toBeGreaterThan(2);
    // A section is framed with 15 % room each side.
    expect(specs.bounds?.sw[0]).toBeCloseTo(5.994, 6);
    expect(specs.bounds?.sw[1]).toBeCloseTo(44.997, 6);
    expect(specs.bounds?.ne[0]).toBeCloseTo(6.046, 6);
    expect(specs.bounds?.ne[1]).toBeCloseTo(45.023, 6);
  });

  it('frames the whole window around the section while its bounds are being extended', () => {
    const wider = lngLatFromShort([
      { lat: 44.9, lng: 5.9 },
      { lat: 45.1, lng: 6.1 },
    ]);

    const specs = sectionMapSpecs({ ...base, extentCoords: wider });

    expect(specs.bounds?.sw[0]).toBeCloseTo(5.87, 6);
    expect(specs.bounds?.ne[1]).toBeCloseTo(45.13, 6);
  });
});

describe('activityMapSpecs', () => {
  const track = lineCollection(meadow);
  const coordinates = [
    { latitude: 45, longitude: 6 },
    { latitude: 45.02, longitude: 6.04 },
  ];
  const sources = (highlight: [number, number]): ActivitySourceInput => ({
    routeGeoJSON: track,
    overlayGeoJSON: EMPTY_FEATURE_COLLECTION,
    consolidatedPortionsGeoJSON: EMPTY_FEATURE_COLLECTION,
    sectionBoundariesGeoJSON: EMPTY_FEATURE_COLLECTION,
    sectionMarkersGeoJSON: EMPTY_FEATURE_COLLECTION,
    highlightGeoJSON: {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: highlight },
    },
    endpointsGeoJSON: EMPTY_FEATURE_COLLECTION,
    sectionCreationLine: EMPTY_FEATURE_COLLECTION,
    sectionCreationMarkers: EMPTY_FEATURE_COLLECTION,
    userLocationGeoJSON: EMPTY_FEATURE_COLLECTION,
  });
  const layers: ActivityLayerInput = {
    palette,
    overlayHasData: false,
    gradientActive: false,
    gradientLineExpression: null,
    hasSectionOverlays: false,
    highlightedSectionId: null,
    hasHighlightPoint: true,
    creationMode: false,
    hasUserLocation: false,
  };

  it('draws the track, takes taps on the section markers and fits the track', () => {
    const specs = activityMapSpecs({ sources: sources([6, 45]), layers, coordinates });

    expect(specs.sources.route).toEqual({ kind: 'geojson', data: track, lineMetrics: true });
    expect(specs.layers.some((layer) => layer.source === 'route')).toBe(true);
    expect(specs.images).toBe(ACTIVITY_MAP_IMAGES);
    expect(specs.interactiveLayers).toBe(SECTION_MARKER_LAYER_IDS);
    expect(specs.bounds).toEqual({ sw: [6, 45], ne: [6.04, 45.02] });
  });

  it('keeps the layer list when a scrub moves only the highlight', () => {
    const first = activityMapSpecs({ sources: sources([6, 45]), layers, coordinates });
    const next = activityMapSpecs({ sources: sources([6.02, 45.01]), layers, coordinates });

    expect(next.layers).toBe(first.layers);
    expect(next.sources.route).toBe(first.sources.route);
    expect(next.sources.highlight).not.toBe(first.sources.highlight);
  });

  it('has no extent for an activity with no track', () => {
    expect(
      activityMapSpecs({ sources: sources([6, 45]), layers, coordinates: [] }).bounds
    ).toBeNull();
  });
});
