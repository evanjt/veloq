/**
 * Expected behaviour: map colours are keyed by the base map drawn, not by the
 * app theme, and every layer builder draws only the colours of the palette it
 * is handed, so a surface that passes the drawn base's palette gets that base's
 * colours on every layer.
 */

import { colourTokens, mapPalette, type MapPalette } from '@/theme';
import { offlineMapStyle } from '@/features/maps/lib/offlineStyleFallback';
import {
  buildActivityLayers,
  buildFullscreenMatchedRouteLayers,
  buildFullscreenSectionLayers,
} from '@/features/maps/components/activityMapLayerSpecs';
import { buildRegionalLayers } from '@/features/maps/components/regional/regionalMapLayerSpecs';
import { composeBaseMapLayers } from '@/features/maps/lib/baseMapLayers';
import { buildEndpointLayers } from '@/features/maps/lib/endpointLayers';
import { buildUserLocationLayers } from '@/features/maps/lib/userLocationLayer';
import { sectionCreation3DLayers } from '@/features/maps/lib/sectionCreationPaint';
import { buildDeltaLineStops } from '@/features/maps/lib/deltaLineColor';
import { homeRadiusLayers } from '@/features/maps/lib/homeRadiusLayers';
import { buildSectionLayers } from '@/features/routes/components/sectionMapLayerSpecs';
import { buildRouteLayers } from '@/features/routes/components/routeMapLayerSpecs';
import { buildPreviewLayers } from '@/features/routes/components/preview/previewMapLayerSpecs';
import {
  groupingLayerPaint,
  groupingLegendRows,
  groupingPreviewLayers,
} from '@/features/routes/lib/groupingLegend';
import { recordingMapLayers } from '@/features/recording/lib/recordingMapLayers';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

const BASES = ['light', 'dark', 'satellite'] as const;
const COLOUR = /^(#[0-9a-f]{3,8}|rgba?\(.*\))$/i;

/**
 * The palette with every colour in it replaced by a value no theme holds, so a
 * colour in a builder's output that is not one of these came from somewhere
 * other than the palette.
 */
function sentinelPalette(base: (typeof BASES)[number]): {
  palette: MapPalette;
  colours: Set<string>;
} {
  const colours = new Set<string>();
  let next = 1;
  const swap = (value: unknown): unknown => {
    if (typeof value === 'string' && COLOUR.test(value)) {
      const sentinel = `#${(next++).toString(16).padStart(6, '0')}`;
      colours.add(sentinel);
      return sentinel;
    }
    if (Array.isArray(value)) return value.map(swap);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, swap(v)]));
    }
    return value;
  };
  return { palette: swap(mapPalette(base)) as MapPalette, colours };
}

function coloursIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string' && COLOUR.test(value)) out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => coloursIn(v, out));
  else if (value && typeof value === 'object')
    Object.values(value).forEach((v) => coloursIn(v, out));
  return out;
}

const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const SPORT = '#abcdef';

describe('mapPalette', () => {
  it('reads the satellite roles and has no ground, label or relief colour', () => {
    const satellite = mapPalette('satellite');
    expect(satellite.base).toBe('satellite');
    expect(satellite.route).toBe(colourTokens.light['map-satellite-route']);
    expect(satellite.casing).toBe(colourTokens.light['map-satellite-casing']);
    expect(satellite.heat[4]).toBe(colourTokens.light['map-satellite-heat-5']);
    for (const ground of ['land', 'park', 'water', 'road', 'label', 'hillshade']) {
      expect(satellite).not.toHaveProperty(ground);
    }
  });

  it('gives the light base the same colours whichever theme the app is in', () => {
    const light = mapPalette('light');
    expect(light.casing).toBe(colourTokens.light['map-light-casing']);
    expect(light.casing).toBe(colourTokens.dark['map-light-casing']);
    expect(light.land).toBe(colourTokens.dark['map-light-land']);
    expect(light.div.mid).toBe(colourTokens.dark['map-light-div-mid']);
    expect(light.theme.textPrimary).toBe(mapPalette('light').theme.textPrimary);
    expect(mapPalette('light')).toBe(light);
  });

  it('reads the base theme for its own colours: dark on dark and satellite, light on light', () => {
    expect(mapPalette('light').isDark).toBe(false);
    expect(mapPalette('dark').isDark).toBe(true);
    expect(mapPalette('satellite').isDark).toBe(true);
    expect(mapPalette('satellite').theme).toBe(mapPalette('dark').theme);
    expect(mapPalette('light').theme).not.toBe(mapPalette('dark').theme);
  });

  it('follows the offline stand-in: satellite offline in a dark theme is the dark palette', () => {
    expect(mapPalette(offlineMapStyle('satellite', false, 'dark'))).toBe(mapPalette('dark'));
    expect(mapPalette(offlineMapStyle('satellite', false, 'light'))).toBe(mapPalette('light'));
    expect(mapPalette(offlineMapStyle('satellite', true, 'dark'))).toBe(mapPalette('satellite'));
  });
});

const builders: [string, (palette: MapPalette) => unknown][] = [
  [
    'the activity map',
    (palette) =>
      buildActivityLayers({
        palette,
        overlayHasData: true,
        gradientActive: false,
        gradientLineExpression: null,
        hasSectionOverlays: true,
        highlightedSectionId: 's1',
        hasHighlightPoint: true,
        creationMode: true,
        hasUserLocation: true,
      }),
  ],
  ['the fullscreen sections', (palette) => buildFullscreenSectionLayers(true, palette)],
  ['the fullscreen matched route', (palette) => buildFullscreenMatchedRouteLayers(true, palette)],
  [
    'the section map',
    (palette) =>
      buildSectionLayers({
        palette,
        shadowGeoJSON: empty,
        extensionGeoJSON: empty,
        sectionGeoJSON: empty,
        trimmedGeoJSON: empty,
        allTracesFeatureCollection: empty,
        highlightedLapGeoJSON: empty,
        highlightedTraceGeoJSON: empty,
        highlightedTraceFilter: ['==', 'id', 'a'],
        hasAllTraces: true,
        endpoints: empty,
        sectionContext: false,
        trimRange: { start: 0, end: 1 },
        hasExtension: true,
        showExtensionAndSection: true,
        trimCasingWidth: 5,
        trimLineWidth: 4,
        traceCasingWidth: 5,
        traceLineWidth: 4,
        deltaLineStops: null,
        userLocationGeoJSON: empty,
        hasUserLocation: true,
      } as unknown as Parameters<typeof buildSectionLayers>[0]),
  ],
  [
    'the regional map',
    (palette) =>
      buildRegionalLayers({
        palette,
        showActivities: true,
        showSections: true,
        showRoutes: true,
        showHeatmap: true,
        heatmapEnabled: true,
        hasSpider: true,
        hasUserLocation: true,
        hasRouteData: true,
        selectedActivityId: 'a',
        selectedSectionId: 's',
        selectedRouteId: 'r',
        routeColor: SPORT,
      }),
  ],
  [
    'the fullscreen map',
    (palette) =>
      composeBaseMapLayers({
        palette,
        underRouteLayers: [],
        overlayLayers: [],
        userLocationLayers: [],
      }),
  ],
  ['the track endpoints', (palette) => buildEndpointLayers(palette)],
  ['the location dot', (palette) => buildUserLocationLayers(true, palette)],
  ['the 3D section creation', (palette) => sectionCreation3DLayers(true, palette)],
  [
    'the delta line',
    (palette) => buildDeltaLineStops([-3, 0, 2, Number.NaN], 100, 400, 'forward', palette),
  ],
  [
    'the route map',
    (palette) =>
      buildRouteLayers({
        palette,
        routeContext: false,
        fadedFilter: undefined,
        includeRoute: true,
      }),
  ],
  ['the regroup preview', (palette) => buildPreviewLayers(palette)],
  ['the grouping paint', (palette) => groupingLayerPaint(palette)],
  ['the grouping preview', (palette) => groupingPreviewLayers(palette)],
  ['the grouping key', (palette) => groupingLegendRows(3, palette)],
  ['the recording map', (palette) => recordingMapLayers(palette, true)],
  ['the home radius', (palette) => homeRadiusLayers(palette)],
];

describe.each(BASES)('on the %s base', (base) => {
  it.each(builders)('%s draws only the palette it is handed', (_name, build) => {
    const { palette, colours } = sentinelPalette(base);
    const drawn = coloursIn(build(palette));
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.filter((c) => c !== SPORT && !colours.has(c))).toEqual([]);
  });

  it("draws the activity line in the palette's route colour on its casing", () => {
    const { palette } = sentinelPalette(base);
    const layers = buildActivityLayers({
      palette,
      overlayHasData: false,
      gradientActive: false,
      gradientLineExpression: null,
      hasSectionOverlays: false,
      highlightedSectionId: null,
      hasHighlightPoint: false,
      creationMode: false,
      hasUserLocation: false,
    });
    const casing = layers.find((l) => l.id === 'route-casing');
    const line = layers.find((l) => l.id === 'route-line');
    expect(casing?.paint?.['line-color']).toBe(palette.casing);
    expect(line?.paint?.['line-color']).toBe(palette.route);
  });
});
