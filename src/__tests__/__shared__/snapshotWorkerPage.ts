import { buildSnapshotWorkerHtml } from '@/features/maps/lib/htmlBuilders/snapshotWorker';
import { buildRenderSnapshotScript } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

type Handler = (event: Record<string, unknown>) => void;

export interface FakeMap {
  setStyle: jest.Mock;
  jumpTo: jest.Mock;
  queryTerrainElevation?: jest.Mock;
  /** Fire a map event the way MapLibre would, to every listener on it. */
  emit: (name: string, event?: Record<string, unknown>) => void;
}

export interface WorkerPage {
  window: Record<string, unknown>;
  map: FakeMap;
  /** Every result the page has posted to the host, parsed, without its log lines. */
  posted: Record<string, unknown>[];
  render: (request: SnapshotRequest, gen: number) => void;
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
    jumpTo: jest.fn(),
    isStyleLoaded: () => true,
    transform: { fov: 36.87, width: 360, height: 240 },
    ...(options.queryTerrainElevation
      ? { queryTerrainElevation: options.queryTerrainElevation }
      : {}),
    getSource: () => null,
    getLayer: () => null,
    addSource: jest.fn(),
    addLayer: jest.fn(),
    getCanvas: () => ({
      width: 1080,
      height: 720,
      getContext: () => null,
      toDataURL: () => 'data:image/jpeg;base64,AAAA',
    }),
    emit: (name: string, event: Record<string, unknown> = {}) => {
      (listeners[name] ?? []).forEach((handler) => handler(event));
    },
  };
  const posted: Record<string, unknown>[] = [];
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
      Map: function FakeMapConstructor() {
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
    posted,
    render: (request, gen) => run(buildRenderSnapshotScript(request, 0, gen)),
  };
}
