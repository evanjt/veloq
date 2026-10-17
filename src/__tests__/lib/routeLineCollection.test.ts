/**
 * Scenario: the map read hands the route-line layer over stamped with its route group
 * generation, and the engine answers the same layer as GeoJSON at a URL on the map
 * page's origin.
 *
 * Expected behaviour: the `routes` source names that URL, revised by the generation, and
 * nothing on the JS thread decodes a polyline or stringifies the lines, so turning the
 * layer on sends the page a few hundred characters however many points it holds. The
 * line colour reduces the engine's `palette` key into the theme's route palette.
 */
import * as coords from 'veloqrs/src/coords';

import { routePalette, routePaletteExpression } from '@/theme/colors';
import {
  routeLinesSourceData,
  type RouteLineLayerInput,
} from '@/features/maps/lib/routeLineCollection';
import {
  ROUTES_LINE_LAYER_ID,
  buildRegionalLayers,
  buildRegionalSources,
} from '@/features/maps/components/regional/regionalMapLayerSpecs';
import { buildApplyScript } from '@/features/maps/lib/htmlBuilders';
import { createSurfacePatcher } from '@/features/maps/lib/mapSurfacePatch';

import { encodeTrack } from '../__shared__/trackBytes';

jest.mock('veloqrs/src/coords', () => {
  const actual = jest.requireActual('veloqrs/src/coords');
  return { ...actual, decodeCoordsFlat: jest.fn(actual.decodeCoordsFlat) };
});

const decodeCoordsFlat = coords.decodeCoordsFlat as jest.MockedFunction<
  typeof coords.decodeCoordsFlat
>;

const ROUTES = 62;
const ROUTE_LINE_POINTS = 58_600;

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function layer(generation: number): RouteLineLayerInput {
  const perRoute = Math.floor(ROUTE_LINE_POINTS / ROUTES);
  return {
    generation,
    routes: Array.from({ length: ROUTES }, (_, i) => ({
      routeId: `loop-${i}`,
      routeNumber: i + 1,
      name: `Loop ${i}`,
      activityCount: 2,
      distanceMeters: 5000,
      polyline: encodeTrack(
        Array.from({ length: perRoute }, (__, at) => ({
          latitude: 46.5 + at * 0.000011 - i * 0.0005,
          longitude: 6.6 + at * 0.000013 + i * 0.0007,
        }))
      ),
    })),
  };
}

function sources(routesGeoJSON: GeoJSON.FeatureCollection | string) {
  return buildRegionalSources({
    markersGeoJSON: EMPTY,
    sectionsGeoJSON: EMPTY,
    routesGeoJSON,
    userLocationGeoJSON: EMPTY,
    routeGeoJSON: EMPTY,
    spiderPointsGeoJSON: EMPTY,
    spiderLinesGeoJSON: EMPTY,
    heatmapEnabled: false,
  });
}

function layers() {
  return buildRegionalLayers({
    mapStyle: 'light',
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
    routeColor: routePalette[0],
  });
}

/** What a `match` expression over a computed input answers for one input value. */
function matched(expression: unknown, input: number): unknown {
  const [op, , ...rest] = expression as unknown[];
  expect(op).toBe('match');
  const fallback = rest[rest.length - 1];
  for (let at = 0; at + 1 < rest.length; at += 2) {
    if (rest[at] === input) return rest[at + 1];
  }
  return fallback;
}

/** The input a `['%', ['get', 'palette'], n]` expression computes for a key. */
function reduced(expression: unknown, key: number): number {
  const [, input] = expression as [string, unknown[]];
  expect(input).toEqual(['%', ['get', 'palette'], routePalette.length]);
  return key % routePalette.length;
}

beforeEach(() => decodeCoordsFlat.mockClear());
afterEach(() => jest.restoreAllMocks());

describe('the routes source', () => {
  it('names the engine URL for a current layer, revised by its generation', () => {
    const spec = sources(routeLinesSourceData(layer(7))).routes;

    expect(spec?.kind).toBe('geojson');
    const data = spec?.kind === 'geojson' ? spec.data : undefined;
    expect(typeof data).toBe('string');
    expect((data as string).endsWith('veloq-geo/route-lines/all?v=7')).toBe(true);
  });

  it('moves the URL when a regroup moves the generation, and keeps it otherwise', () => {
    expect(routeLinesSourceData(layer(7))).toBe(routeLinesSourceData(layer(7)));
    expect(routeLinesSourceData(layer(8))).not.toBe(routeLinesSourceData(layer(7)));
  });

  it('is the empty collection with no current layer', () => {
    expect(routeLinesSourceData(undefined)).toEqual(EMPTY);
  });

  it('turns the layer on without decoding a polyline and with a small patch', () => {
    const stringify = jest.spyOn(JSON, 'stringify');
    const patcher = createSurfacePatcher();
    patcher.next({ sources: sources(routeLinesSourceData(undefined)), layers: layers() });
    stringify.mockClear();

    const { patch, sourceJson } = patcher.next({
      sources: sources(routeLinesSourceData(layer(7))),
      layers: layers(),
    });
    const script = buildApplyScript(patch ?? {}, sourceJson);

    expect(decodeCoordsFlat).not.toHaveBeenCalled();
    const stringified = stringify.mock.results.reduce(
      (sum, result) => sum + (typeof result.value === 'string' ? result.value.length : 0),
      0
    );
    expect(stringified).toBeLessThan(5_000);
    expect(script).toContain('veloq-geo/route-lines/all?v=7');
  });
});

describe('the route line colour', () => {
  it('reduces the engine palette key into the theme route palette', () => {
    const line = layers().find((l) => l.id === ROUTES_LINE_LAYER_ID);
    const expression = line?.paint?.['line-color'];

    expect(expression).toEqual(routePaletteExpression());
    routePalette.forEach((colour, index) => {
      expect(matched(expression, reduced(expression, index))).toBe(colour);
    });
  });

  it('draws a route in the colour its id has always given it', () => {
    // The engine writes these keys for these ids; the colours are the ones the route
    // lines were drawn in when the page hashed the id itself.
    const expression = routePaletteExpression();
    for (const [key, colour] of [
      [112_548, routePalette[4]],
      [2_047_232_155, routePalette[3]],
      [1_745_137_650, routePalette[2]],
    ] as const) {
      expect(matched(expression, reduced(expression, key))).toBe(colour);
    }
  });
});
