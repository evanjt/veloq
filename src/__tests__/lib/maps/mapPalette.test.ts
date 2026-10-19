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
import {
  buildDeltaGapLayer,
  deltaLineBands,
  lineBandExpression,
} from '@/features/maps/lib/deltaLineColor';
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

/** A fully clear colour draws nothing, so it cannot be another base's. */
const CLEAR = /^rgba\(.*,\s*0\)$/i;

function coloursIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string' && COLOUR.test(value) && !CLEAR.test(value)) out.push(value);
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

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex)
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** `line` drawn at `alpha` over `ground`, against the ground: what the eye reads at its edge. */
function contrastOver(line: string, alpha: number, ground: string): number {
  const [l, g] = [channels(line), channels(ground)];
  const mixed = `#${l
    .map((c, i) =>
      Math.round(c * alpha + g[i] * (1 - alpha))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
  const [hi, lo] = [luminance(mixed), luminance(ground)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the Map tab overlay colours on the base edge', () => {
  const lineOpacity = (palette: MapPalette, id: string): number => {
    const layers = buildRegionalLayers({
      palette,
      showActivities: true,
      showSections: true,
      showRoutes: true,
      showHeatmap: false,
      heatmapEnabled: false,
      hasSpider: false,
      hasUserLocation: false,
      hasRouteData: false,
      selectedActivityId: null,
      selectedSectionId: null,
      selectedRouteId: null,
      routeColor: SPORT,
    });
    return layers.find((l) => l.id === id)?.paint?.['line-opacity'] as number;
  };

  it.each(BASES)('clears 3:1 for every section and route colour on the %s edge', (base) => {
    const palette = mapPalette(base);
    const under: string[] = [];
    for (const [colours, id] of [
      [palette.layer.sections, 'sections-line'],
      [palette.layer.routes, 'routes-line'],
    ] as const) {
      const alpha = lineOpacity(palette, id);
      for (const colour of colours) {
        const ratio = contrastOver(colour, alpha, palette.edge);
        if (ratio < 3) under.push(`${id} ${colour} ${ratio.toFixed(2)}`);
      }
    }

    expect(under).toEqual([]);
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
        deltaBands: null,
        deltaGapsGeoJSON: empty,
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
    (palette) => [
      lineBandExpression(deltaLineBands([-3, 0, 2, Number.NaN], 100, 400, 'forward')!, palette),
      buildDeltaGapLayer(palette, 4),
    ],
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
