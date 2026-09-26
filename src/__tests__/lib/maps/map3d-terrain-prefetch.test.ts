/**
 * Scenario: after a 3D page settles it used to prefetch the DEM tiles for the
 * adjacent zoom levels into a Cache API bucket of its own, `veloq-terrain-dem-v1`,
 * which the `cached-terrain` protocol read. The DEM now comes through the
 * intercept and the Rust store is the one tier that keeps it, so that bucket
 * would be a second DEM cache Rust cannot see, size or evict from.
 *
 * Expected behaviour: once the page has settled it has fetched no DEM tile of
 * its own and written nothing into any page cache, and it still reports ready.
 */

import vm from 'vm';

import { buildMap3DHtml, type Map3DHtmlConfig } from '@/features/maps/lib/htmlBuilders';

const TERRAIN_CACHE = 'veloq-terrain-dem-v1';
const DEM_PREFIX = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/';

function buildConfig(overrides: Partial<Map3DHtmlConfig> = {}): Map3DHtmlConfig {
  return {
    coordinates: [
      [7.447, 46.948],
      [7.449, 46.95],
    ],
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

function extractPageScript(html: string): string {
  const blocks = [
    ...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*maplibre-gl)[^>]*>([\s\S]*?)<\/script>/g),
  ];
  expect(blocks.length).toBe(1);
  return blocks[0][1];
}

interface FakeMap {
  fire: (event: string, payload?: unknown) => void;
}

interface Recorder {
  fetched: string[];
  imageSrcs: string[];
  cachePuts: { cache: string; url: string }[];
  cacheContents: Map<string, Map<string, object>>;
}

interface PageRun {
  map: FakeMap;
  posted: { type: string }[];
  recorder: Recorder;
  sandbox: Record<string, unknown>;
}

/**
 * Runs the page script against recording `fetch`, `caches` and `Image` stubs,
 * so a run can say where each tile request went.
 */
function runPage(
  options: {
    zoom?: number;
    seed?: string[];
    fetchFails?: boolean;
  } = {}
): PageRun {
  const { zoom = 13, seed = [], fetchFails = false } = options;

  const recorder: Recorder = {
    fetched: [],
    imageSrcs: [],
    cachePuts: [],
    cacheContents: new Map(),
  };
  const seeded = new Map<string, object>();
  // A real Cache entry carries headers, and the page's own eviction pass reads
  // content-length off them on load, so a bare marker object is not a stand-in
  // for one.
  seed.forEach((url) =>
    seeded.set(url, {
      seeded: true,
      headers: { get: () => '1024' },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
    })
  );
  recorder.cacheContents.set(TERRAIN_CACHE, seeded);

  const posted: { type: string }[] = [];
  let map: FakeMap | null = null;

  const openCache = (name: string) => {
    const store = recorder.cacheContents.get(name) ?? new Map<string, object>();
    recorder.cacheContents.set(name, store);
    return {
      match: (url: string) => Promise.resolve(store.get(url)),
      put: (url: string, response: object) => {
        recorder.cachePuts.push({ cache: name, url });
        store.set(url, response);
        return Promise.resolve();
      },
      keys: () => Promise.resolve([...store.keys()]),
      delete: (url: string) => Promise.resolve(store.delete(url)),
    };
  };

  const makeResponse = (url: string) => ({
    ok: true,
    url,
    headers: { get: () => '1024' },
    clone: () => makeResponse(url),
    blob: () => Promise.resolve({ size: 1024 }),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
  });

  const handlers: Record<string, ((payload?: unknown) => void)[]> = {};
  const register = (event: string, fn: (payload?: unknown) => void) => {
    (handlers[event] ??= []).push(fn);
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
    ArrayBuffer,
    console: { log: () => {}, warn: () => {} },
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0),
    fetch: (url: string) => {
      recorder.fetched.push(url);
      if (fetchFails) return Promise.reject(new Error('offline'));
      return Promise.resolve(makeResponse(url));
    },
    caches: { open: (name: string) => Promise.resolve(openCache(name)) },
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
    Image: function Image(this: Record<string, unknown>) {
      let src = '';
      Object.defineProperty(this, 'src', {
        get: () => src,
        set: (value: string) => {
          src = value;
          recorder.imageSrcs.push(value);
        },
      });
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.ReactNativeWebView = {
    postMessage: (raw: string) => posted.push(JSON.parse(raw)),
  };
  sandbox.addEventListener = () => {};
  sandbox.maplibregl = {
    addProtocol: () => {},
    Map: function MapCtor(this: unknown) {
      map = {
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
        getZoom: () => zoom,
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
      return map;
    },
  };

  vm.runInNewContext(extractPageScript(buildMap3DHtml(buildConfig())), sandbox);
  return { map: map!, posted, recorder, sandbox };
}

/** Fires the events the prefetch waits on, then drains its one second delay. */
async function settle(map: FakeMap): Promise<void> {
  map.fire('load');
  map.fire('idle');
  await jest.advanceTimersByTimeAsync(2000);
}

const demTilesOf = (urls: string[]) => urls.filter((u) => u.startsWith(DEM_PREFIX));

describe('3D terrain after the page settles', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fetches no DEM tile itself and writes none into a page cache', async () => {
    const { map, recorder } = runPage();
    await settle(map);

    expect(demTilesOf(recorder.fetched)).toEqual([]);
    expect(demTilesOf(recorder.imageSrcs)).toEqual([]);
    expect(recorder.cachePuts.filter((p) => p.cache === TERRAIN_CACHE)).toEqual([]);
  });

  it('has no prefetch hook for a caller to reach', async () => {
    const { map, sandbox } = runPage();
    await settle(map);

    expect(sandbox._prefetchTerrainTile).toBeUndefined();
  });

  it('still reports ready with the network down', async () => {
    const { map, posted } = runPage({ fetchFails: true });
    await settle(map);

    expect(posted.map((m) => m.type)).toContain('mapReady');
    expect(posted.map((m) => m.type)).not.toContain('mapFailed');
  });
});
