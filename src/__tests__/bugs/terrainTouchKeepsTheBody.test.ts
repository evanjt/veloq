/**
 * Scenario: the `cached-ground` protocol serves a shaded-relief tile out of
 * the Cache API and moves it to the back of the eviction order on the way
 * past. The terrain handler this was first found on is gone, the DEM comes
 * through the intercept now, and the ground handler carries the same touch.
 *
 * Expected behaviour: the tile still decodes. The touch reads the body to
 * re-stamp it, so it has to be handed a clone, which is what the vector and
 * snapshot paths do too.
 */

import vm from 'vm';

import { buildMap3DHtml, type Map3DHtmlConfig } from '@/features/maps/lib/htmlBuilders';

const GROUND_CACHE = 'veloq-ground-v1';
const TILE_URL = 'https://tiles.openfreemap.org/natural_earth/ne2sr/4/8/5.png';

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

type ProtocolHandler = (params: { url: string }) => Promise<{ data: unknown }>;

/** A stored tile whose body reads once, the way a real Response does. */
function cachedTile(stampedAt: number | null) {
  let read = false;
  const headers = {
    get: (name: string) =>
      name === 'x-veloq-touched' && stampedAt !== null ? String(stampedAt) : null,
    forEach: () => {},
  };
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers,
    clone() {
      return cachedTile(stampedAt);
    },
    blob() {
      if (read) return Promise.reject(new TypeError('body stream already read'));
      read = true;
      return Promise.resolve({ size: 1024 });
    },
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
  };
}

function runPage(
  seeded: boolean,
  stampedAt: number | null = null
): {
  protocols: Record<string, ProtocolHandler>;
  fetched: string[];
} {
  const protocols: Record<string, ProtocolHandler> = {};
  const fetched: string[] = [];
  const store = new Map<string, unknown>(seeded ? [[TILE_URL, cachedTile(stampedAt)]] : []);

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
    TypeError,
    ArrayBuffer,
    console: { log: () => {}, warn: () => {} },
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0),
    Response: function ResponseCtor() {
      return cachedTile(Date.now());
    },
    fetch: (url: string) => {
      fetched.push(url);
      return Promise.resolve(cachedTile(null));
    },
    caches: {
      open: (name: string) =>
        Promise.resolve({
          match: (url: string) =>
            Promise.resolve(name === GROUND_CACHE ? store.get(url) : undefined),
          put: (url: string, response: unknown) => {
            store.set(url, response);
            return Promise.resolve();
          },
          keys: () => Promise.resolve([...store.keys()]),
          delete: (url: string) => Promise.resolve(store.delete(url)),
        }),
    },
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
    Image: function ImageCtor(this: Record<string, unknown>) {
      let src = '';
      Object.defineProperty(this, 'src', {
        get: () => src,
        set: (value: string) => {
          src = value;
          setTimeout(() => (this.onload as () => void)?.(), 0);
        },
      });
    },
    addEventListener: () => {},
    maplibregl: {
      addProtocol: (scheme: string, handler: ProtocolHandler) => {
        protocols[scheme] = handler;
      },
      Map: function MapCtor() {
        return {
          on: () => {},
          once: () => {},
          addSource: () => {},
          addLayer: () => {},
          getSource: () => undefined,
          getLayer: () => undefined,
          setTerrain: () => {},
          setSky: () => {},
          resize: () => {},
          getCenter: () => ({ lng: 7.448, lat: 46.949 }),
          getZoom: () => 12,
          getBearing: () => 0,
          getPitch: () => 60,
          fitBounds: () => {},
        };
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.ReactNativeWebView = { postMessage: () => {} };

  vm.runInNewContext(extractPageScript(buildMap3DHtml(buildConfig())), sandbox);
  return { protocols, fetched };
}

const requestTile = (protocols: Record<string, ProtocolHandler>) =>
  protocols['cached-ground']({ url: `cached-ground://${TILE_URL.slice('https://'.length)}` });

describe('cached-ground', () => {
  it('still decodes a hit that is due a touch', async () => {
    const { protocols, fetched } = runPage(true);

    await expect(requestTile(protocols)).resolves.toEqual({ data: expect.anything() });
    expect(fetched).toEqual([]);
  });

  it('decodes a hit that was touched too recently to touch again', async () => {
    const { protocols, fetched } = runPage(true, Date.now());

    await expect(requestTile(protocols)).resolves.toEqual({ data: expect.anything() });
    expect(fetched).toEqual([]);
  });

  it('decodes a miss off the network and keeps it', async () => {
    const { protocols, fetched } = runPage(false);

    await expect(requestTile(protocols)).resolves.toEqual({ data: expect.anything() });
    expect(fetched).toEqual([TILE_URL]);
  });
});
