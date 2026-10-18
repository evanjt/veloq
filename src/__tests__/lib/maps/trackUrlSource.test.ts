/**
 * Scenario: the activity map's line was decoded on the JS thread, rebuilt as
 * GeoJSON, stringified by the surface patcher and again by the injected
 * script, so a three-hour ride put about two million characters through
 * `JSON.stringify` on every mount. The engine answers the same line at a
 * `veloq-geo` URL on the page's own origin.
 *
 * Expected behaviour: a GeoJSON source can name that URL. The patcher compares
 * it by value, the page hands it to MapLibre as it is, and a mount whose line
 * is a URL stringifies a few kilobytes rather than the track.
 */
import vm from 'vm';

import {
  buildActivityLayers,
  buildActivitySources,
} from '@/features/maps/components/activityMapLayerSpecs';
import { buildApplyScript, type MapSourceSpec } from '@/features/maps/lib/htmlBuilders';
import { surfaceRuntimeScript } from '@/features/maps/lib/htmlBuilders/mapSurfaceScripts';
import type { MapSurfaceHtmlConfig } from '@/features/maps/lib/htmlBuilders/mapSurface';
import { createSurfacePatcher, growingLine } from '@/features/maps/lib/mapSurfacePatch';
import { nativeGeoUrl } from '@/features/maps/lib/tileTransport';
import { mapPalette } from '@/theme';

/** A three-hour ride at one point a second. */
const RIDE_POINTS = 21_600;

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function rideLine(): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: Array.from({ length: RIDE_POINTS }, (_, i) => [
        Number((6.6 + i * 0.000013).toFixed(6)),
        Number((46.5 + i * 0.000011).toFixed(6)),
      ]),
    },
  };
}

function activitySources(route: GeoJSON.Feature | GeoJSON.FeatureCollection | string) {
  return buildActivitySources({
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
}

const layers = buildActivityLayers({
  palette: mapPalette('light'),
  overlayHasData: false,
  activityColor: '#14B8A6',
  gradientActive: true,
  gradientLineExpression: [
    'interpolate',
    ['linear'],
    ['line-progress'],
    0,
    '#14B8A6',
    1,
    '#F59E0B',
  ],
  hasSectionOverlays: false,
  hasHighlightPoint: false,
  creationMode: false,
  hasUserLocation: false,
});

/** Every character `JSON.stringify` produced for a first render, and the script it sent. */
function mount(sources: Record<string, MapSourceSpec>) {
  const stringify = JSON.stringify;
  let stringified = 0;
  const spy = jest.spyOn(JSON, 'stringify').mockImplementation((...args) => {
    const out = stringify(...(args as Parameters<typeof stringify>));
    stringified += out?.length ?? 0;
    return out;
  });
  try {
    const { patch } = createSurfacePatcher().next({ sources, layers });
    return { patch, script: patch ? buildApplyScript(patch) : '', stringified };
  } finally {
    spy.mockRestore();
  }
}

describe('the activity map line as a URL', () => {
  const url = nativeGeoUrl('track', 'i9001', 0);

  it('names the engine URL as the route source, on a lineMetrics source', () => {
    const route = activitySources(url).route;

    expect(route).toEqual({ kind: 'geojson', data: url, lineMetrics: true });
    expect(route.kind === 'geojson' && route.data).toMatch(/veloq-geo\/track\/i9001\?v=0$/);
  });

  it('stringifies a few kilobytes on mount where the inline ride costs the track', () => {
    const inline = mount(activitySources(rideLine()));
    const byUrl = mount(activitySources(url));

    expect(inline.stringified).toBeGreaterThan(400_000);
    expect(byUrl.stringified).toBeLessThan(50_000);
    expect(byUrl.script).toContain(JSON.stringify(url));
  });

  it('keeps a stream-only line inline with every position', () => {
    const line = rideLine();
    const { patch, script } = mount(activitySources(line));
    const route = patch?.sources?.route;

    expect(route && route.kind === 'geojson' && route.data).toBe(line);
    expect(line.geometry.type === 'LineString' && line.geometry.coordinates.length).toBe(
      RIDE_POINTS
    );
    expect(script).toContain(JSON.stringify(line.geometry));
  });
});

describe('the patcher with a URL source', () => {
  it('leaves a fresh wrapper around the same URL unsent, and sends a moved one', () => {
    const patcher = createSurfacePatcher();
    const spec = (v: number): MapSourceSpec => ({
      kind: 'geojson',
      data: nativeGeoUrl('track', 'i9001', v),
      lineMetrics: true,
    });

    expect(patcher.next({ sources: { route: spec(0) }, layers: [] }).patch?.sources).toEqual({
      route: spec(0),
    });
    expect(patcher.next({ sources: { route: spec(0) }, layers: [] }).patch).toBeNull();
    expect(patcher.next({ sources: { route: spec(1) }, layers: [] }).patch?.sources).toEqual({
      route: spec(1),
    });
  });

  it('never treats a URL as a growing line', () => {
    expect(
      growingLine({ kind: 'geojson', data: 'https://veloq.fit/veloq-geo/track/a', growing: true })
    ).toBeNull();
  });
});

describe('the page with a URL source', () => {
  const config: MapSurfaceHtmlConfig = {
    style: 'light',
    camera: { center: [7.448, 46.949], zoom: 12 },
    interaction: { scroll: true, zoom: true, rotate: true, pitch: false },
    devicePixelRatio: 2,
    regionChangeThrottleMs: 100,
    reduceMotion: false,
  };

  function runPage() {
    const sources: Record<string, { setData: jest.Mock }> = {};
    const addSource = jest.fn((id: string) => {
      sources[id] = { setData: jest.fn() };
    });
    const map = {
      addSource,
      getSource: (id: string) => sources[id],
      getLayer: () => undefined,
      removeSource: jest.fn(),
      hasImage: () => true,
    };
    const window: Record<string, unknown> = { map, _rn_log: jest.fn() };
    const context = vm.createContext({ window, setTimeout, clearTimeout, console });
    vm.runInContext(surfaceRuntimeScript(config), context);
    const veloq = window._veloq as { ready: boolean; apply: (patch: unknown) => void };
    veloq.ready = true;
    return { veloq, addSource, sources };
  }

  it('adds the source with the URL, then sets a new URL as its data', () => {
    const { veloq, addSource, sources } = runPage();
    const first = nativeGeoUrl('track', 'i9001', 0);
    const second = nativeGeoUrl('track', 'i9001', 1);

    // A first patch carries the image list, as the patcher's always does.
    veloq.apply({
      images: [],
      sources: { route: { kind: 'geojson', data: first, lineMetrics: true } },
    });
    expect(addSource).toHaveBeenCalledWith('route', {
      type: 'geojson',
      data: first,
      lineMetrics: true,
    });

    veloq.apply({ sources: { route: { kind: 'geojson', data: second, lineMetrics: true } } });
    expect(addSource).toHaveBeenCalledTimes(1);
    expect(sources.route.setData).toHaveBeenCalledWith(second);
  });
});
