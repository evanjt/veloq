/**
 * Scenario: a recording ships each GPS fix to the page as a one-point append,
 * and the page pushed it onto the cached line and handed the whole line to
 * MapLibre's `setData`, which copies it to the worker and re-tiles it. At one
 * fix a second, a two-hour ride copied about 26 million points by its end.
 *
 * Expected behaviour: the page keeps every point in its cached line at once,
 * but redraws a growing line at most once per redraw window. The first point
 * after a quiet window draws at once, the rest are coalesced into one redraw at
 * the window's end, and that redraw carries every point appended so far.
 */

import vm from 'vm';

import { buildApplyScript, buildMapSurfaceHtml } from '@/features/maps/lib/htmlBuilders/mapSurface';
import type {
  MapSourceSpec,
  MapSurfaceHtmlConfig,
} from '@/features/maps/lib/htmlBuilders/mapSurface';
import { GROWING_LINE_REDRAW_MS } from '@/features/maps/lib/mapBudgets';

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

type Line = GeoJSON.FeatureCollection<GeoJSON.LineString>;

interface FakeSource {
  added: Line;
  setData: jest.Mock;
  /** The page grows the object it handed over, so the count is taken at the call. */
  drawn: number[];
}

const pointCount = (data: Line) => data.features[0].geometry.coordinates.length;

interface Page {
  fire: (event: string, payload?: unknown) => void;
  run: (script: string) => void;
  sources: Record<string, FakeSource>;
  /** How many points each `setData` on a source carried, in order. */
  drawn: (id: string) => number[];
}

function runPage(): Page {
  const handlers: Record<string, ((payload?: unknown) => void)[]> = {};
  const register = (event: string, fn: (payload?: unknown) => void) => {
    (handlers[event] ??= []).push(fn);
  };
  const sources: Record<string, FakeSource> = {};
  const map = {
    on: register,
    once: register,
    off: jest.fn(),
    addSource: (id: string, definition: { data: Line }) => {
      const drawn: number[] = [];
      sources[id] = {
        added: JSON.parse(JSON.stringify(definition.data)),
        setData: jest.fn((data: Line) => drawn.push(pointCount(data))),
        drawn,
      };
    },
    removeSource: (id: string) => {
      delete sources[id];
    },
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    getSource: (id: string) => sources[id],
    getLayer: () => undefined,
    hasImage: () => true,
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
    ReactNativeWebView: { postMessage: () => {} },
    maplibregl: {
      addProtocol: () => {},
      Map: function MapCtor() {
        return map;
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(extractPageScript(buildMapSurfaceHtml(config())), context);

  return {
    fire: (event, payload) => (handlers[event] ?? []).forEach((fn) => fn(payload)),
    run: (script) => vm.runInContext(script, context),
    sources,
    drawn: (id) => sources[id]?.drawn ?? [],
  };
}

const ROUTE = 'trail-line';

function line(count: number): MapSourceSpec {
  return {
    kind: 'geojson',
    growing: true,
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: Array.from({ length: count }, (_, i) => [8 + i * 1e-4, 47]),
          },
        },
      ],
    },
  };
}

let next = 1000;
const fix = (): GeoJSON.Position => [9 + next++ * 1e-5, 47];

function loadedPage(initial = 2): Page {
  const page = runPage();
  page.fire('load');
  page.run(buildApplyScript({ images: [], sources: { [ROUTE]: line(initial) } }));
  return page;
}

describe('the page redraws a growing line at most once per window', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('redraws a hundred one-second fixes a handful of times, not a hundred', () => {
    const page = loadedPage(2);

    for (let i = 0; i < 100; i++) {
      page.run(buildApplyScript({ appends: { [ROUTE]: [fix()] } }));
      jest.advanceTimersByTime(1000);
    }
    jest.advanceTimersByTime(GROWING_LINE_REDRAW_MS);

    const drawn = page.drawn(ROUTE);
    expect(drawn.length).toBeLessThanOrEqual(Math.ceil(100_000 / GROWING_LINE_REDRAW_MS) + 1);
    expect(drawn.length).toBeGreaterThan(1);
    expect(drawn[drawn.length - 1]).toBe(102);
  });

  it('draws the first fix after a quiet window at once', () => {
    const page = loadedPage(2);

    page.run(buildApplyScript({ appends: { [ROUTE]: [fix()] } }));

    expect(page.drawn(ROUTE)).toEqual([3]);
  });

  it('coalesces a burst into one redraw at the end of the window', () => {
    const page = loadedPage(2);

    for (let i = 0; i < 50; i++) {
      page.run(buildApplyScript({ appends: { [ROUTE]: [fix()] } }));
    }
    expect(page.drawn(ROUTE)).toEqual([3]);

    jest.advanceTimersByTime(GROWING_LINE_REDRAW_MS - 1);
    expect(page.drawn(ROUTE)).toEqual([3]);

    jest.advanceTimersByTime(1);
    expect(page.drawn(ROUTE)).toEqual([3, 52]);

    jest.advanceTimersByTime(GROWING_LINE_REDRAW_MS * 3);
    expect(page.drawn(ROUTE)).toEqual([3, 52]);
  });

  it('keeps every point in the cached line before it is drawn, so a style swap replays them', () => {
    const page = loadedPage(2);

    for (let i = 0; i < 10; i++) {
      page.run(buildApplyScript({ appends: { [ROUTE]: [fix()] } }));
    }
    expect(page.drawn(ROUTE)).toEqual([3]);
    page.run('window._veloq.rehydrate();');

    expect(page.sources[ROUTE].added.features[0].geometry.coordinates).toHaveLength(12);
    jest.advanceTimersByTime(GROWING_LINE_REDRAW_MS * 2);
    expect(page.drawn(ROUTE).every((count) => count === 12)).toBe(true);
  });

  it('drops a pending redraw once the line is sent whole', () => {
    const page = loadedPage(2);

    page.run(buildApplyScript({ appends: { [ROUTE]: [fix()] } }));
    page.run(buildApplyScript({ appends: { [ROUTE]: [fix()] } }));
    page.run(buildApplyScript({ sources: { [ROUTE]: line(5) } }));
    jest.advanceTimersByTime(GROWING_LINE_REDRAW_MS * 2);

    expect(page.drawn(ROUTE)).toEqual([3, 5]);
  });

  it('does nothing when the line is removed with a redraw pending', () => {
    const page = loadedPage(2);

    page.run(buildApplyScript({ appends: { [ROUTE]: [fix()] } }));
    page.run(buildApplyScript({ appends: { [ROUTE]: [fix()] } }));
    const removed = page.sources[ROUTE];
    page.run(buildApplyScript({ sources: { [ROUTE]: null } }));
    jest.advanceTimersByTime(GROWING_LINE_REDRAW_MS * 2);

    expect(page.sources[ROUTE]).toBeUndefined();
    expect(removed.setData).toHaveBeenCalledTimes(1);
  });

  it('redraws each growing line on its own window', () => {
    const page = loadedPage(2);
    page.run(buildApplyScript({ sources: { other: line(4) } }));

    page.run(buildApplyScript({ appends: { [ROUTE]: [fix()] } }));
    page.run(buildApplyScript({ appends: { other: [fix()] } }));

    expect(page.drawn(ROUTE)).toEqual([3]);
    expect(page.drawn('other')).toEqual([5]);
  });
});
