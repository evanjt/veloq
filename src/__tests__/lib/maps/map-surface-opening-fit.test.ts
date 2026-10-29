/**
 * Scenario: a surface page builds its map while its WebView has no size yet, as a slotted page
 * does before the host lays it out. MapLibre cannot fit bounds into a 0 by 0 container.
 *
 * Expected behaviour: the opening fit is made once the container first has a size, so the route
 * sits in the part of the map the sheet leaves visible rather than at world zoom.
 */

import vm from 'vm';

import { buildMapSurfaceHtml } from '@/features/maps/lib/htmlBuilders/mapSurface';
import type { MapCameraSpec } from '@/features/maps/lib/htmlBuilders/mapSurface';

const BOUNDS = { sw: [7.2, 46.1] as [number, number], ne: [7.4, 46.3] as [number, number] };
const PADDING = { top: 90, right: 40, bottom: 430, left: 40 };
const FIT = { center: { lng: 7.3, lat: 46.2 }, zoom: 11 };

type Size = { clientWidth: number; clientHeight: number };

function runPage(camera: MapCameraSpec, size: Size) {
  const handlers: Record<string, ((payload?: unknown) => void)[]> = {};
  const container = { ...size };
  const calls = {
    jumpTo: [] as Record<string, unknown>[],
    fitBounds: [] as unknown[][],
    cameraForBounds: 0,
  };
  const map = {
    on: (event: string, fn: () => void) => (handlers[event] ??= []).push(fn),
    once: (event: string, fn: () => void) => (handlers[event] ??= []).push(fn),
    off: (event: string, fn: () => void) => {
      handlers[event] = (handlers[event] ?? []).filter((h) => h !== fn);
    },
    getContainer: () => container,
    getCenter: () => ({ lng: 0, lat: 0 }),
    getZoom: () => 0,
    getBearing: () => 0,
    getPitch: () => 0,
    unproject: () => ({ lng: 7.3, lat: 46.2 }),
    cameraForBounds: (_bounds: unknown, options: Record<string, unknown>) => {
      calls.cameraForBounds += 1;
      // The library's fit is NaN when a key it reads is present and undefined.
      return 'maxZoom' in options && options.maxZoom === undefined ? null : FIT;
    },
    jumpTo: (options: Record<string, unknown>) => calls.jumpTo.push(options),
    easeTo: jest.fn(),
    fitBounds: (...args: unknown[]) => calls.fitBounds.push(args),
    resize: jest.fn(),
    getCanvas: () => ({ style: {} }),
    getCanvasContainer: () => ({ addEventListener: () => {}, style: {} }),
    touchZoomRotate: { disableRotation: jest.fn() },
    dragRotate: { disable: jest.fn() },
    getStyle: () => ({ sources: {} }),
    addSource: jest.fn(),
    addLayer: jest.fn(),
    getSource: () => undefined,
    getLayer: () => undefined,
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
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    caches: { open: () => Promise.resolve({ match: () => Promise.resolve(undefined) }) },
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
    Image: function Image() {},
    document: { getElementById: () => ({ addEventListener: () => {}, style: {} }) },
    addEventListener: () => {},
    maplibregl: {
      addProtocol: () => {},
      Map: function MapCtor() {
        return map;
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.ReactNativeWebView = { postMessage: () => {} };

  const html = buildMapSurfaceHtml({
    style: 'light',
    camera,
    interaction: { scroll: true, zoom: true, rotate: true, pitch: false },
    devicePixelRatio: 2,
    reduceMotion: false,
    regionChangeThrottleMs: 100,
  });
  const script = [
    ...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*maplibre-gl)[^>]*>([\s\S]*?)<\/script>/g),
  ][0][1];
  vm.runInNewContext(script, sandbox);

  const resize = (next: Size) => {
    Object.assign(container, next);
    (handlers.resize ?? []).slice().forEach((fn) => fn());
  };
  return { calls, resize };
}

const sized = (calls: ReturnType<typeof runPage>['calls']) =>
  calls.jumpTo.filter((options) => options.zoom === FIT.zoom);

const EMPTY: Size = { clientWidth: 0, clientHeight: 0 };

describe('opening fit of a surface built before it has a size', () => {
  it('fits the padded bounds when the container first has a size', () => {
    const { calls, resize } = runPage({ bounds: BOUNDS, padding: PADDING, padCamera: true }, EMPTY);
    expect(sized(calls)).toHaveLength(0);

    resize({ clientWidth: 360, clientHeight: 800 });

    expect(sized(calls).length).toBeGreaterThan(0);
  });

  it('fits an unpadded camera with fitBounds when the container first has a size', () => {
    const { calls, resize } = runPage({ bounds: BOUNDS, padding: 40 }, EMPTY);
    const before = calls.fitBounds.length;

    resize({ clientWidth: 360, clientHeight: 800 });

    expect(calls.fitBounds.length).toBe(before + 1);
  });

  it('does not fit on a resize that leaves the container empty', () => {
    const { calls, resize } = runPage({ bounds: BOUNDS, padding: PADDING, padCamera: true }, EMPTY);

    resize({ clientWidth: 360, clientHeight: 0 });

    expect(sized(calls)).toHaveLength(0);
  });

  it('fits only once, so a later resize does not undo the athlete moving the map', () => {
    const { calls, resize } = runPage({ bounds: BOUNDS, padding: PADDING, padCamera: true }, EMPTY);
    resize({ clientWidth: 360, clientHeight: 800 });
    const afterFirst = sized(calls).length;

    resize({ clientWidth: 360, clientHeight: 700 });

    expect(sized(calls)).toHaveLength(afterFirst);
  });

  it('adds no extra fit when the container already had a size at build', () => {
    const { calls, resize } = runPage(
      { bounds: BOUNDS, padding: PADDING, padCamera: true },
      { clientWidth: 360, clientHeight: 800 }
    );
    const before = calls.cameraForBounds;

    resize({ clientWidth: 360, clientHeight: 700 });

    expect(calls.cameraForBounds).toBe(before);
  });
});
