/**
 * Scenario: after a 3D page settles it prefetches the DEM tiles for the
 * adjacent zoom levels, so zooming in or out has terrain to hand.
 *
 * Expected behaviour: those bytes land in `veloq-terrain-dem-v1`, the cache the
 * `cached-terrain` protocol reads and the eviction budget bounds. A prefetch
 * that only warms the WebView HTTP cache buys nothing: it is not surveyable,
 * not bounded, and gone whenever the platform decides.
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
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
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
  seed.forEach((url) => seeded.set(url, { seeded: true }));
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
  return { map: map!, posted, recorder };
}

/** Fires the events the prefetch waits on, then drains its one second delay. */
async function settle(map: FakeMap): Promise<void> {
  map.fire('load');
  map.fire('idle');
  await jest.advanceTimersByTimeAsync(2000);
}

const demTilesOf = (urls: string[]) => urls.filter((u) => u.startsWith(DEM_PREFIX));
const zoomOf = (url: string) => Number(url.slice(DEM_PREFIX.length).split('/')[0]);

describe('3D terrain prefetch', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes every prefetched DEM tile into the cache the terrain protocol reads', async () => {
    const { map, recorder } = runPage();
    await settle(map);

    const fetchedTiles = demTilesOf(recorder.fetched);
    expect(fetchedTiles.length).toBeGreaterThan(0);

    const stored = recorder.cachePuts.filter((p) => p.cache === TERRAIN_CACHE).map((p) => p.url);
    expect(new Set(stored)).toEqual(new Set(fetchedTiles));
  });

  it('keys the stored tile by the URL the cached-terrain protocol resolves to', async () => {
    const { map, recorder } = runPage();
    await settle(map);

    // `cached-terrain://s3.amazonaws.com/...` resolves by swapping the scheme,
    // so a prefetch keyed any other way is a permanent miss.
    expect(recorder.cachePuts.length).toBeGreaterThan(0);
    recorder.cachePuts.forEach((put) => expect(put.url.startsWith(DEM_PREFIX)).toBe(true));
  });

  it('does not request DEM tiles outside the cache', async () => {
    const { map, recorder } = runPage();
    await settle(map);

    expect(demTilesOf(recorder.imageSrcs)).toEqual([]);
  });

  it('prefetches the zoom levels either side, and none past the DEM maximum', async () => {
    const { map, recorder } = runPage({ zoom: 15 });
    await settle(map);

    const zooms = new Set(demTilesOf(recorder.fetched).map(zoomOf));
    expect(zooms).toEqual(new Set([14]));
  });

  it('skips a tile the cache already holds', async () => {
    const first = runPage();
    await settle(first.map);
    const alreadyCached = demTilesOf(first.recorder.fetched);
    expect(alreadyCached.length).toBeGreaterThan(0);

    const second = runPage({ seed: alreadyCached });
    await settle(second.map);

    expect(demTilesOf(second.recorder.fetched)).toEqual([]);
    expect(second.recorder.cachePuts).toEqual([]);
  });

  it('survives a prefetch that cannot reach the network', async () => {
    const { map, posted, recorder } = runPage({ fetchFails: true });
    await settle(map);

    expect(demTilesOf(recorder.fetched).length).toBeGreaterThan(0);
    expect(recorder.cachePuts).toEqual([]);
    expect(posted.map((m) => m.type)).toContain('mapReady');
    expect(posted.map((m) => m.type)).not.toContain('mapFailed');
  });
});
