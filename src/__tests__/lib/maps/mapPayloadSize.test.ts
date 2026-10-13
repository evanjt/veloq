/**
 * Scenario: every map is a WebView, so a page is one string handed across the
 * bridge and every later change is a script injected into it. Those strings
 * are held on the JS heap and parsed by the page, and nothing about their size
 * shows up in a test that only checks what they contain.
 *
 * Expected behaviour: each page and each injection stays within a ceiling set
 * at its measured length plus headroom, and a mount sends each piece of data
 * once. Fixtures are fixed, so every number is a length or a count and no
 * clock is read.
 */

import {
  buildActivityLayers,
  buildActivitySources,
} from '@/features/maps/components/activityMapLayerSpecs';
import {
  buildRegionalLayers,
  buildRegionalSources,
} from '@/features/maps/components/regional/regionalMapLayerSpecs';
import {
  buildApplyScript,
  buildMap3DHtml,
  buildMapSurfaceHtml,
  buildRenderSnapshotScript,
  buildSnapshotWorkerHtml,
  type MapLayerSpec,
  type MapSourceSpec,
} from '@/features/maps/lib/htmlBuilders';
import { createSurfacePatcher } from '@/features/maps/lib/mapSurfacePatch';

/** A three-hour ride at one point a second. */
const RIDE_POINTS = 21_600;
/** A feed card's preview track. */
const PREVIEW_POINTS = 100;
const MARKERS = 500;
const ROUTES = 62;
const ROUTE_LINE_POINTS = 58_660;

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function track(count: number, seed = 0): [number, number][] {
  return Array.from({ length: count }, (_, i) => [
    Number((6.6 + i * 0.000013 + seed * 0.0007).toFixed(6)),
    Number((46.5 + i * 0.000011 - seed * 0.0005).toFixed(6)),
  ]);
}

function lineCollection(coordinates: [number, number][]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }],
  };
}

function markers(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: track(MARKERS).map((coordinates, i) => ({
      type: 'Feature',
      properties: { id: `ride-${i}`, sportType: 'Ride' },
      geometry: { type: 'Point', coordinates },
    })),
  };
}

function routeLines(): GeoJSON.FeatureCollection {
  const perRoute = Math.floor(ROUTE_LINE_POINTS / ROUTES);
  return {
    type: 'FeatureCollection',
    features: Array.from({ length: ROUTES }, (_, i) => {
      const count = i === ROUTES - 1 ? ROUTE_LINE_POINTS - perRoute * (ROUTES - 1) : perRoute;
      return {
        type: 'Feature',
        properties: { id: `loop-${i}` },
        geometry: { type: 'LineString', coordinates: track(count, i) },
      };
    }),
  };
}

/** Characters of data a mount has to carry: each distinct data object once. */
function distinctDataLength(sources: Record<string, MapSourceSpec>): number {
  const seen = new Set<unknown>();
  let length = 0;
  for (const spec of Object.values(sources)) {
    if (spec.kind !== 'geojson' || seen.has(spec.data)) continue;
    seen.add(spec.data);
    length += JSON.stringify(spec.data).length;
  }
  return length;
}

/**
 * What a first render costs: the injected script, and every character
 * `JSON.stringify` produced on the way to it, the patcher's comparisons
 * included.
 */
function mount(sources: Record<string, MapSourceSpec>, layers: MapLayerSpec[]) {
  const stringify = JSON.stringify;
  let stringified = 0;
  const spy = jest.spyOn(JSON, 'stringify').mockImplementation((...args) => {
    const out = stringify(...(args as Parameters<typeof stringify>));
    stringified += out?.length ?? 0;
    return out;
  });
  try {
    const { patch } = createSurfacePatcher().next({ sources, layers });
    const script = patch ? buildApplyScript(patch) : '';
    return { script: script.length, stringified };
  } finally {
    spy.mockRestore();
  }
}

function activitySpecs(route: GeoJSON.FeatureCollection, gradientActive: boolean) {
  const sources = buildActivitySources({
    routeGeoJSON: route,
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
    userLocationGeoJSON: EMPTY,
  });
  const layers = buildActivityLayers({
    overlayHasData: false,
    activityColor: '#14B8A6',
    gradientActive,
    gradientLineExpression: gradientActive
      ? ['interpolate', ['linear'], ['line-progress'], 0, '#14B8A6', 1, '#F59E0B']
      : null,
    hasSectionOverlays: false,
    hasHighlightPoint: false,
    creationMode: false,
    hasUserLocation: false,
  });
  return { sources, layers };
}

function regionalSpecs() {
  const sources = buildRegionalSources({
    markersGeoJSON: markers(),
    sectionsGeoJSON: EMPTY,
    routesGeoJSON: routeLines(),
    userLocationGeoJSON: EMPTY,
    routeGeoJSON: EMPTY,
    spiderPointsGeoJSON: EMPTY,
    spiderLinesGeoJSON: EMPTY,
    heatmapEnabled: false,
  });
  const layers = buildRegionalLayers({
    isDark: false,
    mapStyle: 'light',
    showActivities: true,
    showSections: true,
    showRoutes: true,
    showHeatmap: false,
    heatmapEnabled: false,
    hasSpider: false,
    hasUserLocation: false,
    hasRouteData: true,
    selectedActivityId: null,
    selectedSectionId: null,
    routeColor: '#14B8A6',
  });
  return { sources, layers };
}

const layerLength = (layers: MapLayerSpec[]) => JSON.stringify(layers).length;

describe('map page size', () => {
  // Every page inlines the whole MapLibre GL bundle and stylesheet in its head,
  // which is most of each number. Measured: map surface 1,159,689, 3D map with
  // no route 1,163,444, snapshot worker 1,104,248.
  const PAGE_CEILING = 1_400_000;

  it('keeps the map surface page within its ceiling', () => {
    const html = buildMapSurfaceHtml({
      style: 'light',
      camera: { center: [6.6, 46.5], zoom: 12 },
      interaction: { scroll: true, zoom: true, rotate: true, pitch: true },
      devicePixelRatio: 2,
      reduceMotion: false,
      regionChangeThrottleMs: 100,
      longPressMs: 500,
    });
    expect(html.length).toBeLessThanOrEqual(PAGE_CEILING);
  });

  it('keeps the snapshot worker page within its ceiling', () => {
    expect(buildSnapshotWorkerHtml(0).length).toBeLessThanOrEqual(PAGE_CEILING);
  });

  it('carries a three-hour ride on the 3D page once', () => {
    const coordinates = track(RIDE_POINTS);
    const config = {
      coordinates,
      bounds: { sw: [6.6, 46.5] as [number, number], ne: [6.9, 46.8] as [number, number] },
      centerOverride: null,
      zoom: 12,
      bearing: 0,
      pitch: 60,
      hasSavedCamera: false,
      terrainExaggeration: 1.5,
      initStyle: 'light' as const,
      mapStyle: 'light' as const,
      routeColor: '#14B8A6',
      showHeatmap: false,
      devicePixelRatio: 2,
      reduceMotion: false,
    };
    const empty = buildMap3DHtml({ ...config, coordinates: [] }).length;
    const ride = buildMap3DHtml(config).length;

    expect(empty).toBeLessThanOrEqual(PAGE_CEILING);
    expect(ride - empty).toBeLessThanOrEqual(1.1 * JSON.stringify(coordinates).length);
  });
});

describe('map mount size', () => {
  it('sends a three-hour ride once on the activity map, with or without the gradient', () => {
    const route = lineCollection(track(RIDE_POINTS));
    const routeLength = JSON.stringify(route).length;

    for (const gradientActive of [false, true]) {
      const { sources, layers } = activitySpecs(route, gradientActive);
      const { script, stringified } = mount(sources, layers);

      expect(distinctDataLength(sources)).toBeLessThan(1.01 * routeLength);
      expect(script).toBeLessThanOrEqual(1.1 * routeLength + layerLength(layers));
      // The patcher keeps each source's serialisation to compare the next
      // render against, and the script serialises the patch again.
      expect(stringified).toBeLessThanOrEqual(2.2 * routeLength + 2 * layerLength(layers));
    }
  });

  it('sends the regional markers and route lines once', () => {
    const { sources, layers } = regionalSpecs();
    const data = distinctDataLength(sources);
    const { script, stringified } = mount(sources, layers);

    expect(script).toBeLessThanOrEqual(1.1 * data + layerLength(layers));
    expect(stringified).toBeLessThanOrEqual(2.2 * data + 2 * layerLength(layers));
  });
});

describe('snapshot request size', () => {
  it('keeps one preview render request within its ceiling', () => {
    const coordinates = track(PREVIEW_POINTS);
    const script = buildRenderSnapshotScript(
      {
        activityId: 'ride-1',
        coordinates,
        camera: { center: coordinates[50], zoom: 12, bearing: 30, pitch: 58 },
        mapStyle: 'light',
        routeColor: '#14B8A6',
      },
      0,
      1
    );
    // Measured 67,904: the request carries the whole inline basemap style
    // and the render code with it.
    expect(script.length).toBeLessThanOrEqual(81_000);
  });
});
