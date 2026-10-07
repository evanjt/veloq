/**
 * Scenario: the activity map draws section markers in 3D as circle and
 * trophy layers carrying a `sectionId`. The page hit-tested only the global
 * point layer and the section line layer, so a marker tap fell through to a
 * bare map click, which places a creation point while creating a section.
 *
 * Expected behaviour: a tap on a marker posts `sectionClick` with its id and
 * never a `mapClick`, as the 2D map does.
 */

import vm from 'vm';

import { buildMap3DHtml } from '@/features/maps/lib/htmlBuilders';

type Posted = { type: string; [key: string]: unknown };
type Hit = { properties: Record<string, unknown> };

function runPage(hitsByLayer: Record<string, Hit[]>) {
  const posted: Posted[] = [];
  const handlers: Record<string, ((payload?: unknown) => void)[]> = {};
  const register = (event: string, fn: (payload?: unknown) => void) => {
    (handlers[event] ??= []).push(fn);
  };
  const map = {
    on: register,
    once: register,
    addSource: () => {},
    addLayer: () => {},
    getSource: () => undefined,
    getLayer: () => ({}),
    getStyle: () => ({ layers: [] }),
    setTerrain: () => {},
    setSky: () => {},
    setStyle: () => {},
    resize: () => {},
    queryRenderedFeatures: (_point: unknown, opts: { layers: string[] }) =>
      opts.layers.flatMap((id) => hitsByLayer[id] ?? []),
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
    fitBounds: () => {},
    easeTo: () => {},
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
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0),
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    caches: { open: () => Promise.resolve({ match: () => Promise.resolve(undefined) }) },
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
    Image: function Image(this: Record<string, unknown>) {
      this.src = '';
    },
    addEventListener: () => {},
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.ReactNativeWebView = {
    postMessage: (raw: string) => posted.push(JSON.parse(raw) as Posted),
  };
  sandbox.maplibregl = {
    addProtocol: () => {},
    Map: function MapCtor() {
      return map;
    },
  };

  const html = buildMap3DHtml({
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
  });
  const blocks = [
    ...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*maplibre-gl)[^>]*>([\s\S]*?)<\/script>/g),
  ];
  vm.runInNewContext(blocks[0][1], sandbox);
  (handlers.load ?? []).forEach((fn) => fn());
  const click = () =>
    (handlers.click ?? []).forEach((fn) =>
      fn({ point: { x: 1, y: 2 }, lngLat: { lng: 7.4, lat: 46.9 } })
    );
  return { posted, click };
}

describe('a tap on a 3D section marker', () => {
  it.each(['section-marker-circle-3d', 'section-marker-pr-icon-3d'])(
    'opens the section from %s and places no creation point',
    (layer) => {
      const { posted, click } = runPage({ [layer]: [{ properties: { sectionId: 's7' } }] });

      click();

      expect(posted.filter((m) => m.type === 'sectionClick')).toEqual([
        { type: 'sectionClick', sectionId: 's7' },
      ]);
      expect(posted.some((m) => m.type === 'mapClick')).toBe(false);
    }
  );

  it('still reports a map click when nothing is under the tap', () => {
    const { posted, click } = runPage({});

    click();

    expect(posted.map((m) => m.type)).toContain('mapClick');
  });
});
