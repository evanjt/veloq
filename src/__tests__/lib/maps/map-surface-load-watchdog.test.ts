/**
 * Scenario: every 2D surface is MapLibre GL JS fetched from a CDN. With the
 * radio off and a cold WebView cache the renderer never arrives, the page
 * script throws before it can build a map, and the surface is a blank
 * rectangle with nothing to say for itself.
 *
 * Expected behaviour: the page reports its own failure. The watchdog is armed
 * before anything touches `maplibregl`, so a missing renderer, a throwing
 * constructor and a style that never loads all end in `mapFailed`. A load that
 * lands after the watchdog fired still posts `mapReady`, so the surface
 * recovers rather than staying stuck.
 */

import vm from 'vm';

import { buildMapSurfaceHtml } from '@/features/maps/lib/htmlBuilders/mapSurface';
import type { MapSurfaceHtmlConfig } from '@/features/maps/lib/htmlBuilders/mapSurface';
import { MAP_SURFACE_READY_TIMEOUT_MS } from '@/features/maps/lib/mapBudgets';

function buildConfig(overrides: Partial<MapSurfaceHtmlConfig> = {}): MapSurfaceHtmlConfig {
  return {
    style: 'light',
    camera: { center: [7.448, 46.949], zoom: 12 },
    interaction: { scroll: true, zoom: true, rotate: true, pitch: false },
    devicePixelRatio: 2,
    regionChangeThrottleMs: 100,
    longPressMs: 500,
    ...overrides,
  };
}

function extractPageScript(html: string): string {
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  expect(blocks.length).toBe(1);
  return blocks[0][1];
}

type Posted = { type: string; [key: string]: unknown };

interface FakeMap {
  fire: (event: string, payload?: unknown) => void;
}

interface RunResult {
  posted: Posted[];
  map: FakeMap | null;
  errorListeners: ((event: { message: string }) => void)[];
}

/**
 * Runs the page script in a sandbox. `withMapLibre: false` models the CDN
 * bundle never arriving, which is the case the watchdog exists for.
 */
function runPage(options: { withMapLibre?: boolean; mapFactory?: () => FakeMap } = {}): RunResult {
  const { withMapLibre = true, mapFactory } = options;
  const posted: Posted[] = [];
  const errorListeners: ((event: { message: string }) => void)[] = [];
  let map: FakeMap | null = null;

  const makeMap = (): FakeMap => {
    if (mapFactory) return mapFactory();
    const handlers: Record<string, ((payload?: unknown) => void)[]> = {};
    const register = (event: string, fn: (payload?: unknown) => void) => {
      (handlers[event] ??= []).push(fn);
    };
    return {
      fire: (event: string, payload?: unknown) =>
        (handlers[event] ?? []).forEach((fn) => fn(payload)),
      on: register,
      once: register,
      off: jest.fn(),
      addSource: jest.fn(),
      addLayer: jest.fn(),
      getSource: jest.fn(() => undefined),
      getLayer: jest.fn(() => undefined),
      resize: jest.fn(),
      getCanvas: () => ({ style: {} }),
      getCanvasContainer: () => ({ addEventListener: () => {}, style: {} }),
      getCenter: () => ({ lng: 7.448, lat: 46.949 }),
      getZoom: () => 12,
      getBearing: () => 0,
      getPitch: () => 0,
      getBounds: () => ({
        getWest: () => 7.4,
        getEast: () => 7.5,
        getNorth: () => 47,
        getSouth: () => 46.9,
        toArray: () => [
          [7.4, 46.9],
          [7.5, 47],
        ],
      }),
      touchZoomRotate: { disableRotation: jest.fn(), enable: jest.fn(), disable: jest.fn() },
      dragRotate: { disable: jest.fn(), enable: jest.fn() },
      fitBounds: jest.fn(),
      easeTo: jest.fn(),
      setStyle: jest.fn(),
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
    setInterval: (fn: () => void, ms?: number) => setInterval(fn, ms),
    clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
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
    document: { getElementById: () => ({ addEventListener: () => {}, style: {} }) },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.ReactNativeWebView = {
    postMessage: (raw: string) => posted.push(JSON.parse(raw) as Posted),
  };
  sandbox.addEventListener = (event: string, fn: (e: { message: string }) => void) => {
    if (event === 'error') errorListeners.push(fn);
  };

  if (withMapLibre) {
    sandbox.maplibregl = {
      addProtocol: () => {},
      Map: function MapCtor(this: unknown) {
        map = makeMap();
        return map;
      },
    };
  }

  try {
    vm.runInNewContext(extractPageScript(buildMapSurfaceHtml(buildConfig())), sandbox);
  } catch {
    // A page that cannot reach maplibregl throws at the top level, exactly as
    // it does in the WebView. The window error handler is what has to report it.
    errorListeners.forEach((fn) => fn({ message: 'maplibregl is not defined' }));
  }
  return { posted, map, errorListeners };
}

/** Console bridge traffic shares the channel, so only lifecycle posts count. */
const typesOf = (posted: Posted[]) =>
  posted.map((m) => m.type).filter((t) => t === 'mapReady' || t === 'mapFailed');

describe('2D map surface load watchdog', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('posts mapReady once the style loads, and never mapFailed', () => {
    const { posted, map } = runPage();

    expect(map).not.toBeNull();
    map!.fire('load');
    jest.advanceTimersByTime(MAP_SURFACE_READY_TIMEOUT_MS * 2);

    expect(typesOf(posted)).toContain('mapReady');
    expect(typesOf(posted)).not.toContain('mapFailed');
  });

  it('posts mapFailed when the renderer never loaded from the CDN', () => {
    const { posted } = runPage({ withMapLibre: false });
    jest.advanceTimersByTime(MAP_SURFACE_READY_TIMEOUT_MS * 2);

    expect(typesOf(posted)).toContain('mapFailed');
    expect(typesOf(posted)).not.toContain('mapReady');
  });

  it('posts mapFailed when the map constructor throws', () => {
    const { posted } = runPage({
      mapFactory: () => {
        throw new Error('WebGL context creation failed');
      },
    });
    jest.advanceTimersByTime(MAP_SURFACE_READY_TIMEOUT_MS * 2);

    expect(typesOf(posted)).toContain('mapFailed');
  });

  it('posts mapFailed when the style never fires load', () => {
    const { posted, map } = runPage();

    expect(map).not.toBeNull();
    expect(typesOf(posted)).not.toContain('mapFailed');
    jest.advanceTimersByTime(MAP_SURFACE_READY_TIMEOUT_MS);

    expect(typesOf(posted)).toContain('mapFailed');
  });

  it('posts mapReady for a load that lands after the watchdog fired', () => {
    const { posted, map } = runPage();

    jest.advanceTimersByTime(MAP_SURFACE_READY_TIMEOUT_MS);
    expect(typesOf(posted)).toEqual(['mapFailed']);

    map!.fire('load');

    expect(typesOf(posted)).toEqual(['mapFailed', 'mapReady']);
  });

  it('posts mapFailed once, however many page errors arrive', () => {
    const { posted, errorListeners } = runPage({ withMapLibre: false });
    errorListeners.forEach((fn) => fn({ message: 'second failure' }));
    jest.advanceTimersByTime(MAP_SURFACE_READY_TIMEOUT_MS * 2);

    expect(posted.filter((m) => m.type === 'mapFailed')).toHaveLength(1);
  });

  it('carries the reason it failed', () => {
    const { posted } = runPage({ withMapLibre: false });

    const failure = posted.find((m) => m.type === 'mapFailed');
    expect(typeof failure?.reason).toBe('string');
    expect((failure?.reason as string).length).toBeGreaterThan(0);
  });
});
