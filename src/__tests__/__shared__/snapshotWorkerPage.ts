import {
  buildRecycleSnapshotMapScript,
  buildSnapshotWorkerHtml,
} from '@/features/maps/lib/htmlBuilders/snapshotWorker';
import { buildRenderSnapshotScript } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

type Handler = (event: Record<string, unknown>) => void;

export interface FakeMap {
  setStyle: jest.Mock;
  /** No terrain is mounted unless a test says otherwise. */
  getTerrain: jest.Mock;
  setTerrain: jest.Mock;
  jumpTo: jest.Mock;
  remove: jest.Mock;
  /** Whether every tile of the mounted style has arrived. True unless a test says otherwise. */
  isStyleLoaded: jest.Mock;
  /** Answers no source unless a test says otherwise, so a 3D render takes the full path. */
  getSource: jest.Mock;
  queryTerrainElevation?: jest.Mock;
  /** Fire a map event the way MapLibre would, to every listener on it. */
  emit: (name: string, event?: Record<string, unknown>) => void;
}

export interface WorkerPage {
  window: Record<string, unknown>;
  map: FakeMap;
  /** What the page constructed its map with. */
  mapOptions: Record<string, unknown>;
  /** How many maps the page has constructed, the boot one included. */
  mapsBuilt: () => number;
  /** Every result the page has posted to the host, parsed, without its log lines. */
  posted: Record<string, unknown>[];
  render: (request: SnapshotRequest, gen: number) => void;
  /** Runs the host's recycle command in the page, as `injectJavaScript` does. */
  recycle: () => void;
}

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 720;

/** A WebGL context whose `readPixels` reads one pixel, its row counted from the bottom as GL does. */
function webglReading(pixelAt: (x: number, y: number) => [number, number, number]) {
  return {
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    readPixels: (
      x: number,
      glY: number,
      _w: number,
      _h: number,
      _f: number,
      _t: number,
      out: Uint8Array
    ) => {
      const [r, g, b] = pixelAt(x, CANVAS_HEIGHT - glY - 1);
      out.set([r, g, b, 255]);
    },
  };
}

/**
 * Boots the worker page's own script against a fake MapLibre, so its map
 * event handlers are the production ones, then runs render scripts into the
 * same window the way `injectJavaScript` does on the device.
 */
export function bootWorkerPage(
  options: {
    fetch?: jest.Mock;
    /** Rendered terrain height at a [lng, lat], exaggeration included, as MapLibre answers it. */
    queryTerrainElevation?: jest.Mock;
    /**
     * The colour drawn at a canvas pixel, `y` counted down from the top as on
     * screen. Given, the canvas answers `readPixels` from it; absent, it has
     * no WebGL context and the page probes nothing.
     */
    pixelAt?: (x: number, y: number) => [number, number, number];
  } = {}
): WorkerPage {
  const listeners: Record<string, Handler[]> = {};
  const map = {
    on: (name: string, handler: Handler) => {
      (listeners[name] ??= []).push(handler);
    },
    once: (name: string, handler: Handler) => {
      (listeners[name] ??= []).push(handler);
    },
    off: jest.fn(),
    setStyle: jest.fn(),
    getTerrain: jest.fn(() => null),
    setTerrain: jest.fn(),
    jumpTo: jest.fn(),
    // A removed map fires nothing more, so its listeners go with it.
    remove: jest.fn(() => {
      for (const name of Object.keys(listeners)) delete listeners[name];
    }),
    isStyleLoaded: jest.fn(() => true),
    transform: { fov: 36.87, width: 360, height: 240 },
    ...(options.queryTerrainElevation
      ? { queryTerrainElevation: options.queryTerrainElevation }
      : {}),
    getSource: jest.fn(() => null),
    getLayer: () => null,
    addSource: jest.fn(),
    addLayer: jest.fn(),
    getCanvas: () => ({
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      getContext: () => (options.pixelAt ? webglReading(options.pixelAt) : null),
      toDataURL: () => 'data:image/jpeg;base64,AAAA',
    }),
    emit: (name: string, event: Record<string, unknown> = {}) => {
      (listeners[name] ?? []).forEach((handler) => handler(event));
    },
  };
  const posted: Record<string, unknown>[] = [];
  let mapOptions: Record<string, unknown> = {};
  let built = 0;
  const win: Record<string, unknown> = {
    // A frame is a timer, since the heartbeat asks for one from inside each.
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 16),
    ReactNativeWebView: {
      postMessage: (payload: string) => {
        const message = JSON.parse(payload);
        if (message.type !== 'console') posted.push(message);
      },
    },
    maplibregl: {
      addProtocol: jest.fn(),
      Map: function FakeMapConstructor(options: Record<string, unknown>) {
        mapOptions = options;
        built += 1;
        return map;
      },
    },
    fetch: options.fetch ?? jest.fn(() => new Promise(() => {})),
    console: { log: () => {}, warn: () => {}, error: () => {} },
    // An empty Cache API, so the boot's eviction pass finds nothing to evict.
    caches: {
      delete: () => Promise.resolve(false),
      open: () => Promise.resolve({ keys: () => Promise.resolve([]) }),
    },
    devicePixelRatio: 2,
  };
  // The page addresses its globals bare and through `window`, as a browser
  // does. `has` answers only for what the page owns, so `JSON`, `Date` and the
  // fake timers still resolve to the real ones.
  const sandbox: Record<string, unknown> = new Proxy(win, {
    has: (target, key) => key === 'window' || key in target,
    get: (target, key) => (key === 'window' ? sandbox : target[key as string]),
    set: (target, key, value) => {
      target[key as string] = value;
      return true;
    },
  });
  const run = (script: string) => new Function('sandbox', `with (sandbox) { ${script} }`)(sandbox);

  const html = buildSnapshotWorkerHtml(0);
  const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), (m) => m[1]);
  run(scripts[scripts.length - 1]);

  return {
    window: win,
    map,
    mapOptions,
    mapsBuilt: () => built,
    posted,
    render: (request, gen) => run(buildRenderSnapshotScript(request, 0, gen)),
    recycle: () => run(buildRecycleSnapshotMapScript()),
  };
}
