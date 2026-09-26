/**
 * Scenario: the 3D page logs every MapLibre `error` event as `map error: <msg>`
 * and suppresses only messages beginning `HTTP 4`. The app rejects its own
 * heatmap tile requests with bare prose, so a tile the store does not hold
 * reads as a map error with no source, no URL and nothing naming the app. That
 * cost a device session and an investigation.
 *
 * Expected behaviour: a rejection the app itself made is recognisable and is
 * suppressed like an expected 404, and an error that is not ours is logged
 * with its source id and its URL, so the next reader is not sent looking.
 */

import vm from 'vm';

import { buildMap3DHtml, type Map3DHtmlConfig } from '@/features/maps/lib/htmlBuilders';
import { APP_TILE_MISS, APP_TILE_READ_ERROR } from '@/features/maps/lib/htmlBuilders/map3D';

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

const logs = (posted: Posted[]) =>
  posted.filter((m) => m.type === 'console').map((m) => String(m.message));

describe('the 3D page error handler', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('says nothing about a tile the app itself declined', () => {
    const { posted, map } = runPage(buildMap3DHtml(buildConfig()));

    map!.fire('error', { error: new Error(APP_TILE_MISS) });
    map!.fire('error', { error: new Error(APP_TILE_READ_ERROR) });

    expect(logs(posted).filter((line) => line.startsWith('map error'))).toEqual([]);
  });

  it('still says nothing about an expected 404 from a regional source', () => {
    const { posted, map } = runPage(buildMap3DHtml(buildConfig()));

    map!.fire('error', { error: new Error('HTTP 404: not found') });

    expect(logs(posted).filter((line) => line.startsWith('map error'))).toEqual([]);
  });

  it('names the source and the url of an error that is not ours', () => {
    const { posted, map } = runPage(buildMap3DHtml(buildConfig()));

    map!.fire('error', {
      sourceId: 'openmaptiles',
      error: Object.assign(new Error('Unimplemented type: 3'), {
        url: 'https://veloq.fit/veloq-tile/openmaptiles/12/2145/1436.pbf',
      }),
    });

    const line = logs(posted).find((l) => l.startsWith('map error'));
    expect(line).toContain('Unimplemented type: 3');
    expect(line).toContain('openmaptiles');
    expect(line).toContain('https://veloq.fit/veloq-tile/openmaptiles/12/2145/1436.pbf');
  });

  it('logs an error carrying neither a source nor a url as the message alone', () => {
    const { posted, map } = runPage(buildMap3DHtml(buildConfig()));

    map!.fire('error', { error: new Error('style is not done loading') });

    expect(logs(posted)).toContain('map error: style is not done loading');
  });
});
