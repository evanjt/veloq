/**
 * Scenario: the renderer now ships in the app, so a 3D view opened with no
 * radio boots and draws. The DEM tiles still come off the network, so the
 * terrain is flat and nothing says why.
 *
 * Expected behaviour: the page reports that it has no terrain, so the caller
 * can drop back to 2D with a reason rather than leaving a flat map that looks
 * like 3D is broken. A page whose terrain loads never reports it, and a page
 * that has already reported does not report twice.
 */

import vm from 'vm';

import { buildMap3DHtml, type Map3DHtmlConfig } from '@/features/maps/lib/htmlBuilders';

const DEM_TILE = 'cached-terrain://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/1/1.png';

function buildConfig(): Map3DHtmlConfig {
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
  };
}

function extractPageScript(html: string): string {
  const blocks = [
    ...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*maplibre-gl)[^>]*>([\s\S]*?)<\/script>/g),
  ];
  expect(blocks.length).toBe(1);
  return blocks[0][1];
}

type Posted = { type: string; [key: string]: unknown };
type Protocol = (params: { url: string; type?: string }) => Promise<unknown>;

interface PageRun {
  fire: (event: string, payload?: unknown) => void;
  posted: Posted[];
  protocols: Record<string, Protocol>;
}

/** `offline` makes every network fetch reject, which is the case under test. */
function runPage(options: { offline: boolean }): PageRun {
  const posted: Posted[] = [];
  const protocols: Record<string, Protocol> = {};
  const handlers: Record<string, ((payload?: unknown) => void)[]> = {};
  const register = (event: string, fn: (payload?: unknown) => void) => {
    (handlers[event] ??= []).push(fn);
  };

  const makeResponse = () => ({
    ok: true,
    headers: { get: () => '1024' },
    clone: () => makeResponse(),
    blob: () => Promise.resolve({ size: 1024 }),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
  });

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
    fetch: () =>
      options.offline ? Promise.reject(new Error('offline')) : Promise.resolve(makeResponse()),
    caches: {
      open: () =>
        Promise.resolve({
          match: () => Promise.resolve(undefined),
          put: () => Promise.resolve(),
          keys: () => Promise.resolve([]),
          delete: () => Promise.resolve(true),
        }),
    },
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
    Image: function Image(this: Record<string, unknown>) {
      const self = this;
      // A microtask, not a timer: the tests run on fake timers and the decode
      // has to settle before the page is driven.
      Object.defineProperty(this, 'src', {
        set: () => {
          void Promise.resolve().then(() => (self.onload as (() => void) | undefined)?.());
        },
      });
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.ReactNativeWebView = {
    postMessage: (raw: string) => posted.push(JSON.parse(raw) as Posted),
  };
  sandbox.addEventListener = () => {};
  sandbox.maplibregl = {
    addProtocol: (name: string, fn: Protocol) => {
      protocols[name] = fn;
    },
    Map: function MapCtor() {
      return {
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
        getZoom: () => 12,
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
      };
    },
  };

  vm.runInNewContext(extractPageScript(buildMap3DHtml(buildConfig())), sandbox);
  return {
    fire: (event, payload) => (handlers[event] ?? []).forEach((fn) => fn(payload)),
    posted,
    protocols,
  };
}

async function requestTerrain(run: PageRun): Promise<void> {
  await run.protocols['cached-terrain']({ url: DEM_TILE, type: 'image' }).catch(() => {});
}

const typesOf = (posted: Posted[]) => posted.map((m) => m.type);

describe('a 3D page with no terrain', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reports that it has no terrain, with a reason', async () => {
    const run = runPage({ offline: true });
    await requestTerrain(run);

    run.fire('load');
    run.fire('idle');
    await jest.advanceTimersByTimeAsync(2000);

    expect(typesOf(run.posted)).toContain('terrainUnavailable');
    const report = run.posted.find((m) => m.type === 'terrainUnavailable');
    expect(typeof report?.reason).toBe('string');
    expect((report?.reason as string).length).toBeGreaterThan(0);
  });

  it('still reports ready, so the caller stops waiting on a spinner', async () => {
    const run = runPage({ offline: true });
    await requestTerrain(run);

    run.fire('load');
    run.fire('idle');
    await jest.advanceTimersByTimeAsync(2000);

    expect(typesOf(run.posted)).toContain('mapReady');
    expect(typesOf(run.posted)).not.toContain('mapFailed');
  });

  it('reports once, however many DEM tiles fail', async () => {
    const run = runPage({ offline: true });
    for (let i = 0; i < 5; i++) await requestTerrain(run);

    run.fire('load');
    run.fire('idle');
    await jest.advanceTimersByTimeAsync(5000);

    expect(run.posted.filter((m) => m.type === 'terrainUnavailable')).toHaveLength(1);
  });

  it('says nothing when no DEM tile was ever asked for', async () => {
    const run = runPage({ offline: true });

    run.fire('load');
    run.fire('idle');
    await jest.advanceTimersByTimeAsync(2000);

    expect(typesOf(run.posted)).not.toContain('terrainUnavailable');
  });
});

describe('a 3D page whose terrain loads', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('never reports terrain unavailable', async () => {
    const run = runPage({ offline: false });
    await requestTerrain(run);

    run.fire('load');
    run.fire('idle');
    await jest.advanceTimersByTimeAsync(5000);

    expect(typesOf(run.posted)).not.toContain('terrainUnavailable');
    expect(typesOf(run.posted)).toContain('mapReady');
  });
});
