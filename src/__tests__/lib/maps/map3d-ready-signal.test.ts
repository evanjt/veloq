/**
 * Scenario: the 3D terrain hero shows a spinner until the WebView page posts
 * `mapReady`. Every way the page can fail to reach that point has to end in a
 * message, otherwise the spinner is permanent.
 *
 * Expected behaviour: the page posts `mapReady` on a healthy load, and a
 * terminal `mapFailed` when maplibregl is missing, the map constructor throws,
 * or the style never fires `load`.
 */

import vm from 'vm';

import { buildMap3DHtml, type Map3DHtmlConfig } from '@/features/maps/lib/htmlBuilders';
import { buildMap3DBuildScript, map3DPageRevision } from '@/features/maps/lib/htmlBuilders/map3D';
import { buildReleaseMapScript } from '@/features/maps/lib/htmlBuilders/shared';
import { MAP_3D_READY_TIMEOUT_MS } from '@/features/maps/lib/mapBudgets';

const COORDINATES: [number, number][] = [
  [7.447, 46.948],
  [7.448, 46.949],
  [7.449, 46.95],
];

function buildConfig(overrides: Partial<Map3DHtmlConfig> = {}): Map3DHtmlConfig {
  return {
    coordinates: COORDINATES,
    bounds: { sw: [7.447, 46.948], ne: [7.449, 46.95] },
    centerOverride: null,
    zoom: 12,
    bearing: 0,
    pitch: 60,
    hasSavedCamera: false,
    terrainExaggeration: 1.5,
    initStyle: 'light',
    mapStyle: 'light',
    routeColor: '#FF6B35',
    showHeatmap: false,
    devicePixelRatio: 2,
    reduceMotion: false,
    ...overrides,
  };
}

/** The page carries one inline script after the bundled renderer in the head. */
function extractPageScript(html: string): string {
  const blocks = [
    ...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*maplibre-gl)[^>]*>([\s\S]*?)<\/script>/g),
  ];
  expect(blocks.length).toBe(1);
  return blocks[0][1];
}

type Posted = { type: string; [key: string]: unknown };

interface FakeMap {
  options: Record<string, unknown>;
  addSource: jest.Mock;
  remove: jest.Mock;
  jumpTo: jest.Mock;
  queryTerrainElevation: jest.Mock;
  fire: (event: string, payload?: unknown) => void;
  handlers: Record<string, ((payload?: unknown) => void)[]>;
}

interface RunResult {
  posted: Posted[];
  map: FakeMap | null;
  /** Every map the page made, oldest first. */
  maps: FakeMap[];
  prewarms: number;
  threw: Error | null;
  /** Runs a script the host injects into the same page. */
  run: (script: string) => void;
  window: Record<string, unknown>;
}

/**
 * Runs the page script in a sandbox. `mapFactory` decides what
 * `new maplibregl.Map()` does, so a run can simulate a throwing constructor,
 * a map that never loads, or a healthy one.
 */
function runPage(
  html: string,
  options: {
    withMapLibre?: boolean;
    mapFactory?: () => FakeMap;
    queryTerrainElevation?: (lngLat: [number, number]) => number;
  } = {}
): RunResult {
  const { withMapLibre = true, mapFactory, queryTerrainElevation } = options;
  const posted: Posted[] = [];
  let map: FakeMap | null = null;
  const maps: FakeMap[] = [];
  let prewarms = 0;

  const makeMap = (): FakeMap => {
    if (mapFactory) return mapFactory();
    const handlers: Record<string, ((payload?: unknown) => void)[]> = {};
    const register = (event: string, fn: (payload?: unknown) => void) => {
      (handlers[event] ??= []).push(fn);
    };
    return {
      handlers,
      fire: (event: string, payload?: unknown) =>
        (handlers[event] ?? []).forEach((fn) => fn(payload)),
      on: register,
      once: register,
      addSource: jest.fn(),
      addLayer: jest.fn(),
      hasImage: () => false,
      addImage: () => {},
      getSource: jest.fn(() => undefined),
      getLayer: jest.fn(() => undefined),
      getStyle: () => ({ layers: [] }),
      setTerrain: jest.fn(),
      setSky: jest.fn(),
      setStyle: jest.fn(),
      resize: jest.fn(),
      getCenter: () => ({ lng: 7.448, lat: 46.949 }),
      getZoom: () => 13,
      getBearing: () => 0,
      getPitch: () => 60,
      getBounds: () => ({
        getWest: () => 7.4,
        getEast: () => 7.5,
        getNorth: () => 47,
        getSouth: () => 46.9,
      }),
      fitBounds: jest.fn(),
      easeTo: jest.fn(),
      jumpTo: jest.fn(),
      queryTerrainElevation: jest.fn(queryTerrainElevation ?? (() => 0)),
      transform: { fov: 36.87, height: 600 },
      remove: jest.fn(),
    } as unknown as FakeMap;
  };

  const sandbox: Record<string, unknown> = {
    JSON,
    Math,
    Date,
    String,
    Number,
    Array,
    Object,
    Promise,
    Error,
    console: { log: () => {}, warn: () => {} },
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0),
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    caches: {
      open: () =>
        Promise.resolve({
          match: () => Promise.resolve(undefined),
          put: () => {},
          keys: () => Promise.resolve([]),
          delete: () => {},
        }),
    },
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
    Image: function Image(this: Record<string, unknown>) {
      this.src = '';
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  (sandbox as { window: Record<string, unknown> }).window.ReactNativeWebView = {
    postMessage: (raw: string) => {
      posted.push(JSON.parse(raw) as Posted);
    },
  };
  (sandbox as { window: Record<string, unknown> }).window.addEventListener = () => {};

  if (withMapLibre) {
    sandbox.maplibregl = {
      addProtocol: () => {},
      prewarm: () => {
        prewarms += 1;
      },
      Map: function MapCtor(this: unknown, options: Record<string, unknown>) {
        map = makeMap();
        map.options = options;
        maps.push(map);
        return map;
      },
    };
  }

  let threw: Error | null = null;
  const context = vm.createContext(sandbox);
  try {
    vm.runInContext(extractPageScript(html), context);
  } catch (e) {
    threw = e as Error;
  }
  return {
    posted,
    get map() {
      return map;
    },
    maps,
    get prewarms() {
      return prewarms;
    },
    threw,
    run: (script: string) => vm.runInContext(script, context),
    window: sandbox,
  };
}

const typesOf = (posted: Posted[]) => posted.map((m) => m.type);

/** A style whose vector tiles come from the loopback listener on two shards. */
const LISTENER_STYLE = {
  sources: {
    streets: {
      type: 'vector',
      tiles: [
        'http://127.0.0.1:41001/tok/streets/{z}/{x}/{y}.pbf',
        'http://127.0.0.1:41002/tok/streets/{z}/{x}/{y}.pbf',
      ],
    },
  },
};

describe('3D map ready signal', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('posts mapReady once the style loads and the sources settle', () => {
    const { posted, map } = runPage(buildMap3DHtml(buildConfig()));

    expect(map).not.toBeNull();
    map!.fire('load');
    map!.fire('sourcedata', { sourceId: 'terrain', isSourceLoaded: true });
    map!.fire('sourcedata', { sourceId: 'route', isSourceLoaded: true });
    jest.runOnlyPendingTimers();

    expect(typesOf(posted)).toContain('mapReady');
    expect(typesOf(posted)).not.toContain('mapFailed');
  });

  it('posts mapReady for a terrain-only page with no route coordinates', () => {
    const { posted, map } = runPage(
      buildMap3DHtml(buildConfig({ coordinates: [], bounds: null, centerOverride: [7.44, 46.94] }))
    );

    map!.fire('load');
    map!.fire('sourcedata', { sourceId: 'terrain', isSourceLoaded: true });
    jest.runOnlyPendingTimers();

    expect(typesOf(posted)).toContain('mapReady');
  });

  it('posts mapFailed when the style never fires load', () => {
    const { posted, map } = runPage(buildMap3DHtml(buildConfig()));

    expect(map).not.toBeNull();
    jest.advanceTimersByTime(60_000);

    expect(typesOf(posted)).toContain('mapFailed');
    expect(typesOf(posted)).not.toContain('mapReady');
  });

  it('posts mapFailed when the map constructor throws', () => {
    const { posted } = runPage(buildMap3DHtml(buildConfig()), {
      mapFactory: () => {
        throw new Error('WebGL context creation failed');
      },
    });
    jest.advanceTimersByTime(60_000);

    expect(typesOf(posted)).toContain('mapFailed');
  });

  it('posts mapFailed when maplibregl never defined itself', () => {
    const { posted } = runPage(buildMap3DHtml(buildConfig()), { withMapLibre: false });
    jest.advanceTimersByTime(60_000);

    expect(typesOf(posted)).toContain('mapFailed');
  });

  it('does not post mapFailed after the map has already reported ready', () => {
    const { posted, map } = runPage(buildMap3DHtml(buildConfig()));

    map!.fire('load');
    map!.fire('idle');
    jest.advanceTimersByTime(60_000);

    expect(posted.filter((m) => m.type === 'mapReady')).toHaveLength(1);
    expect(typesOf(posted)).not.toContain('mapFailed');
  });
});

describe('3D page opening camera', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  // A 3 km ridge in the ground south of the route's northern half, so a camera
  // looking north from the south hides that half.
  const ridge = (lngLat: [number, number]) => (lngLat[1] > 46.9 && lngLat[1] < 46.9488 ? 3000 : 0);
  const longRoute: [number, number][] = Array.from({ length: 40 }, (_, i) => [
    7.447,
    46.948 + i * 0.00005,
  ]);
  const longConfig = (overrides: Partial<Map3DHtmlConfig> = {}) =>
    buildConfig({
      coordinates: longRoute,
      bounds: { sw: [7.447, 46.948], ne: [7.447, 46.95] },
      ...overrides,
    });

  const openAndSettle = (html: string, gestureFirst = false) => {
    const run = runPage(html, { queryTerrainElevation: ridge });
    run.map!.fire('load');
    if (gestureFirst) run.map!.fire('movestart', { originalEvent: {} });
    run.map!.fire('idle');
    jest.runOnlyPendingTimers();
    return run;
  };

  it('turns the opening camera on the first idle and posts it as no gesture', () => {
    const { map, posted } = openAndSettle(buildMap3DHtml(longConfig()));

    expect(map!.queryTerrainElevation).toHaveBeenCalled();
    expect(map!.jumpTo).toHaveBeenCalledTimes(1);
    expect(map!.jumpTo.mock.calls[0][0]).not.toEqual(
      expect.objectContaining({ bearing: 0, pitch: 60 })
    );
    map!.fire('moveend', undefined);
    const camera = posted.filter((m) => m.type === 'cameraState');
    expect(camera.length).toBeGreaterThan(0);
    expect(camera.every((m) => m.gesture === false)).toBe(true);
  });

  it('never queries the terrain when the athlete saved a camera', () => {
    const { map } = openAndSettle(buildMap3DHtml(longConfig({ hasSavedCamera: true })));

    expect(map!.queryTerrainElevation).not.toHaveBeenCalled();
    expect(map!.jumpTo).not.toHaveBeenCalled();
  });

  it('does not jump on an idle after a gesture moved the camera', () => {
    const { map } = openAndSettle(buildMap3DHtml(longConfig()), true);

    expect(map!.jumpTo).not.toHaveBeenCalled();
  });

  it('turns only once however many idles follow', () => {
    const { map } = openAndSettle(buildMap3DHtml(longConfig()));
    map!.fire('idle');
    map!.fire('idle');

    expect(map!.jumpTo).toHaveBeenCalledTimes(1);
  });
});

describe('3D page rebuilt in place for a new mount', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  const readyCount = (posted: Posted[]) => posted.filter((m) => m.type === 'mapReady').length;
  const settle = (map: FakeMap) => {
    map.fire('load');
    map.fire('idle');
    jest.runOnlyPendingTimers();
  };
  const otherRoute: [number, number][] = [
    [8.1, 45.9],
    [8.2, 45.95],
  ];

  it('builds its first map through the function a later mount calls', () => {
    const page = runPage(buildMap3DHtml(buildConfig()));

    expect(typeof page.window._veloqBuildMap).toBe('function');
    expect(page.maps).toHaveLength(1);
    expect(page.maps[0].options.bounds).toEqual([
      [7.447, 46.948],
      [7.449, 46.95],
    ]);
  });

  it('holds the worker pool for the life of the page, so a released map keeps it', () => {
    const page = runPage(buildMap3DHtml(buildConfig()));
    settle(page.maps[0]);

    page.run(buildReleaseMapScript());
    page.run(
      buildMap3DBuildScript(
        buildConfig({ coordinates: otherRoute, bounds: null, centerOverride: [8.15, 45.92] })
      )
    );

    expect(page.prewarms).toBe(1);
  });

  it('builds a released page again at the new camera and route, and reports ready again', () => {
    const page = runPage(buildMap3DHtml(buildConfig()));
    settle(page.maps[0]);
    expect(readyCount(page.posted)).toBe(1);

    page.run(buildReleaseMapScript());
    expect(page.window.map).toBeNull();
    page.run(
      buildMap3DBuildScript(
        buildConfig({
          coordinates: otherRoute,
          bounds: null,
          centerOverride: [8.15, 45.92],
          zoom: 14,
          bearing: 45,
          pitch: 50,
          hasSavedCamera: true,
          initStyle: 'dark',
          mapStyle: 'dark',
        })
      )
    );

    expect(page.maps).toHaveLength(2);
    const rebuilt = page.maps[1];
    expect(page.window.map).toBe(rebuilt);
    expect(rebuilt.options).toEqual(
      expect.objectContaining({ center: [8.15, 45.92], zoom: 14, bearing: 45, pitch: 50 })
    );
    expect(rebuilt.options.bounds).toBeUndefined();

    settle(rebuilt);
    const route = rebuilt.addSource.mock.calls.find(([id]) => id === 'route');
    expect(route?.[1].data.features[0].geometry.coordinates).toEqual(otherRoute);
    expect(page.window._routeCoords).toEqual(otherRoute);
    expect(readyCount(page.posted)).toBe(2);
  });

  it('removes a map still standing when it is built again', () => {
    const page = runPage(buildMap3DHtml(buildConfig()));
    settle(page.maps[0]);

    page.run(buildMap3DBuildScript(buildConfig({ coordinates: otherRoute })));

    expect(page.maps[0].remove).toHaveBeenCalledTimes(1);
    expect(page.window.map).toBe(page.maps[1]);
  });

  it('posts nothing into the rebuilt map from a timer the released one left', () => {
    const page = runPage(buildMap3DHtml(buildConfig()));
    page.maps[0].fire('load');

    jest.advanceTimersByTime(1000);
    page.run(buildReleaseMapScript());
    page.run(buildMap3DBuildScript(buildConfig({ coordinates: otherRoute })));
    // Past the released build's deadlines, short of the rebuilt one's.
    jest.advanceTimersByTime(MAP_3D_READY_TIMEOUT_MS - 500);

    expect(page.posted.map((m) => m.type)).not.toContain('mapFailed');
    expect(readyCount(page.posted)).toBe(0);

    settle(page.maps[1]);
    expect(readyCount(page.posted)).toBe(1);
  });

  it('names one revision in the head of every page it builds', () => {
    const revision = map3DPageRevision();
    const meta = `<meta name="veloq-page-revision" content="${revision}">`;

    expect(revision).toMatch(/^[0-9a-f]{8}$/);
    expect(buildMap3DHtml(buildConfig())).toContain(meta);
    expect(
      buildMap3DHtml(buildConfig({ coordinates: otherRoute, initStyle: 'satellite', pitch: 10 }))
    ).toContain(meta);
  });

  it('asks the listener to warm its tile host when a pan starts', () => {
    const page = runPage(buildMap3DHtml(buildConfig()));
    const fetch = jest.fn(() => Promise.resolve({ ok: true }));
    page.window.fetch = fetch;
    (page.map as unknown as { getStyle: () => unknown }).getStyle = () => LISTENER_STYLE;

    page.map!.fire('movestart');

    expect(fetch.mock.calls).toEqual([
      ['http://127.0.0.1:41001/tok/streets/warm', { cache: 'no-store' }],
    ]);
  });
});
