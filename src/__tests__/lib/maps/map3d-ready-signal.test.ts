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
  fire: (event: string, payload?: unknown) => void;
  handlers: Record<string, ((payload?: unknown) => void)[]>;
}

interface RunResult {
  posted: Posted[];
  map: FakeMap | null;
  threw: Error | null;
}

/**
 * Runs the page script in a sandbox. `mapFactory` decides what
 * `new maplibregl.Map()` does, so a run can simulate a throwing constructor,
 * a map that never loads, or a healthy one.
 */
function runPage(
  html: string,
  options: { withMapLibre?: boolean; mapFactory?: () => FakeMap } = {}
): RunResult {
  const { withMapLibre = true, mapFactory } = options;
  const posted: Posted[] = [];
  let map: FakeMap | null = null;

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
      getSource: jest.fn(() => undefined),
      getLayer: jest.fn(() => undefined),
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
      Map: function MapCtor(this: unknown) {
        map = makeMap();
        return map;
      },
    };
  }

  let threw: Error | null = null;
  try {
    vm.runInNewContext(extractPageScript(html), sandbox);
  } catch (e) {
    threw = e as Error;
  }
  return { posted, map, threw };
}

const typesOf = (posted: Posted[]) => posted.map((m) => m.type);

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
