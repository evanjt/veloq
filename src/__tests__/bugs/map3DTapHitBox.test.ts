/**
 * Scenario: the 3D page tested a tap against the single pixel under the finger.
 * A section line there is a 2.4 px dashed stroke, so most taps missed it and
 * posted a bare map click.
 *
 * Expected behaviour: activity points and sections are both queried with a box
 * around the tap, sized by the one constant the 2D page uses, and a point still
 * wins over a section.
 */

import vm from 'vm';

import { buildMap3DHtml, type Map3DHtmlConfig } from '@/features/maps/lib/htmlBuilders';
import { SURFACE_HIT_TEST_RADIUS_PX } from '@/features/maps/lib/htmlBuilders/mapSurface';

type Query = { geometry: unknown; layers: string[] };

const config: Map3DHtmlConfig = {
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

function pageScript(html: string): string {
  const blocks = [
    ...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*maplibre-gl)[^>]*>([\s\S]*?)<\/script>/g),
  ];
  expect(blocks.length).toBe(1);
  return blocks[0][1];
}

function tap(features: Record<string, unknown[]>) {
  const queries: Query[] = [];
  const posted: Record<string, unknown>[] = [];
  const handlers: Record<string, ((payload?: unknown) => void)[]> = {};
  const register = (event: string, a: unknown, b?: unknown) => {
    const fn = (typeof a === 'function' ? a : b) as (payload?: unknown) => void;
    (handlers[event] ??= []).push(fn);
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
    ArrayBuffer,
    console: { log: () => {}, warn: () => {} },
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0),
    fetch: () => Promise.reject(new Error('offline')),
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
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.ReactNativeWebView = {
    postMessage: (m: string) => posted.push(JSON.parse(m)),
  };
  sandbox.addEventListener = () => {};
  sandbox.maplibregl = {
    addProtocol: () => {},
    Map: function MapCtor() {
      return {
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
        queryRenderedFeatures: (geometry: unknown, opts: { layers: string[] }) => {
          queries.push({ geometry, layers: opts.layers });
          return features[opts.layers[0]] ?? [];
        },
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
        fitBounds: () => {},
        easeTo: () => {},
      };
    },
  };
  vm.runInNewContext(pageScript(buildMap3DHtml(config)), sandbox);
  (handlers['load'] ?? []).forEach((fn) => fn());
  (handlers['click'] ?? []).forEach((fn) =>
    fn({ point: { x: 100, y: 200 }, lngLat: { lng: 1, lat: 2 } })
  );
  return { queries, posted: posted.filter((m) => m.type !== 'console') };
}

const point = { type: 'Point', coordinates: [7.45, 46.95] };

const box = [
  [100 - SURFACE_HIT_TEST_RADIUS_PX, 200 - SURFACE_HIT_TEST_RADIUS_PX],
  [100 + SURFACE_HIT_TEST_RADIUS_PX, 200 + SURFACE_HIT_TEST_RADIUS_PX],
];

describe('the 3D page tap hit test', () => {
  it('queries sections with a box around the tap and selects the section', () => {
    const { queries, posted } = tap({ 'sections-layer': [{ properties: { sectionId: 's1' } }] });
    const q = queries.find((x) => x.layers[0] === 'sections-layer');
    expect(q?.geometry).toEqual(box);
    expect(posted).toContainEqual({ type: 'sectionClick', sectionId: 's1' });
  });

  it('queries activity points with a box and lets a point win over a section', () => {
    const { queries, posted } = tap({
      'activity-points-layer': [{ properties: { id: 'a1' }, geometry: point }],
      'sections-layer': [{ properties: { sectionId: 's1' } }],
    });
    expect(queries[0].layers).toEqual(['activity-points-layer']);
    expect(queries[0].geometry).toEqual(box);
    expect(posted).toEqual([
      {
        type: 'activityClick',
        activityId: 'a1',
        features: [{ type: 'Feature', properties: { id: 'a1' }, geometry: point }],
      },
    ]);
  });

  it('posts every activity point under the tap, so stacked starts can fan out', () => {
    const at = (id: string) => ({
      type: 'Feature',
      properties: { id },
      geometry: { type: 'Point', coordinates: [7.45, 46.95] },
    });
    const { posted } = tap({ 'activity-points-layer': [at('a1'), at('a2'), at('a3')] });
    expect(posted).toEqual([
      { type: 'activityClick', activityId: 'a1', features: [at('a1'), at('a2'), at('a3')] },
    ]);
  });
});
