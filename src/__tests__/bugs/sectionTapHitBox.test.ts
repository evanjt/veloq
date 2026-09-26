/**
 * Scenario: a section on the global map is drawn as a dashed line 1.2 px wide
 * at zoom 6 and 2.4 at zoom 14, a third of its length gap, and the page
 * hit-tested a tap against the single pixel under the finger. A finger covers
 * about 30 px. Most taps missed and ran the empty-space branch, which closes
 * whatever was open.
 *
 * Expected behaviour: the tap is tested against a box around the point, so a
 * line a few pixels away is hit. The layer precedence is untouched, and
 * sections sit last in it, so a box cannot steal a tap from a marker.
 */

import vm from 'vm';

import {
  buildMapSurfaceHtml,
  SURFACE_HIT_TEST_RADIUS_PX,
} from '@/features/maps/lib/htmlBuilders/mapSurface';
import type { MapSurfaceHtmlConfig } from '@/features/maps/lib/htmlBuilders/mapSurface';

type Geometry = [number, number] | [[number, number], [number, number]];

interface Fired {
  fire: (event: string, payload?: unknown) => void;
}

function extractPageScript(html: string): string {
  const blocks = [
    ...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*maplibre-gl)[^>]*>([\s\S]*?)<\/script>/g),
  ];
  expect(blocks.length).toBe(1);
  return blocks[0][1];
}

function config(): MapSurfaceHtmlConfig {
  return {
    style: 'light',
    camera: { center: [7.448, 46.949], zoom: 12 },
    interaction: { scroll: true, zoom: true, rotate: true, pitch: false },
    devicePixelRatio: 2,
    regionChangeThrottleMs: 100,
    longPressMs: 500,
  };
}

/** Runs the page and hands back the map, what it posted, and what it queried. */
function runPage() {
  const posted: Record<string, unknown>[] = [];
  const queried: Geometry[] = [];
  let map: Fired | null = null;

  const makeMap = (): Fired => {
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
      getLayer: jest.fn(() => ({})),
      queryRenderedFeatures: (geometry: Geometry) => {
        queried.push(geometry);
        return [{ layer: { id: 'sections-line' }, properties: { id: 's1' }, geometry: null }];
      },
      resize: jest.fn(),
      getCanvas: () => ({ style: {} }),
      getCanvasContainer: () => ({ addEventListener: () => {}, style: {} }),
      getCenter: () => ({ lng: 7.448, lat: 46.949 }),
      getZoom: () => 12,
      getBearing: () => 0,
      getPitch: () => 0,
      getBounds: () => ({
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
    } as unknown as Fired;
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
    addEventListener: () => {},
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.ReactNativeWebView = {
    postMessage: (raw: string) => posted.push(JSON.parse(raw) as Record<string, unknown>),
  };
  sandbox.maplibregl = {
    addProtocol: () => {},
    Map: function MapCtor(this: unknown) {
      map = makeMap();
      return map;
    },
  };

  vm.runInNewContext(extractPageScript(buildMapSurfaceHtml(config())), sandbox);
  // The page registers its map handlers once the style is up.
  (map as unknown as Fired).fire('load');
  const veloq = sandbox._veloq as { interactiveLayers?: string[] };
  veloq.interactiveLayers = ['sections-line'];
  return { posted, queried, map: map as unknown as Fired };
}

describe('the page hit-tests a tap against a box', () => {
  it('queries a box around the point rather than the pixel under the finger', () => {
    const { queried, map } = runPage();

    map.fire('click', { point: { x: 100, y: 200 }, lngLat: { lng: 7.4, lat: 46.9 } });

    expect(queried).toHaveLength(1);
    const r = SURFACE_HIT_TEST_RADIUS_PX;
    expect(queried[0]).toEqual([
      [100 - r, 200 - r],
      [100 + r, 200 + r],
    ]);
  });

  it('uses a radius a finger can miss by, not a pixel', () => {
    expect(SURFACE_HIT_TEST_RADIUS_PX).toBeGreaterThanOrEqual(8);
    expect(SURFACE_HIT_TEST_RADIUS_PX).toBeLessThanOrEqual(20);
  });

  it('still reports the feature it found', () => {
    const { posted, map } = runPage();

    map.fire('click', { point: { x: 100, y: 200 }, lngLat: { lng: 7.4, lat: 46.9 } });

    const press = posted.find((m) => m.type === 'mapClick');
    expect((press?.feature as { layerId?: string } | null)?.layerId).toBe('sections-line');
  });
});
