/**
 * Scenario: the heatmap raster layer is mounted on every 3D page and hidden by
 * setting `raster-opacity` to zero. A raster layer at zero opacity is still
 * visible to MapLibre, so it requests every tile in the viewport and paints
 * them invisibly. The activity map mounts with the heatmap off, which is every
 * activity open.
 *
 * Expected behaviour: the layer is mounted with `visibility: none` when the
 * heatmap is off, so no tile is requested at all, and it keeps its tuned
 * opacity for the case where it is on.
 */

import vm from 'vm';

import { buildMap3DHtml, type Map3DHtmlConfig } from '@/features/maps/lib/htmlBuilders';

type LayerSpec = {
  id: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
};

function buildConfig(showHeatmap: boolean): Map3DHtmlConfig {
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
    showHeatmap,
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

/** The layers the page adds on its way up, in the order it adds them. */
function layersAddedBy(showHeatmap: boolean): LayerSpec[] {
  const added: LayerSpec[] = [];
  const handlers: Record<string, ((payload?: unknown) => void)[]> = {};
  const register = (event: string, fn: (payload?: unknown) => void) => {
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
  sandbox.ReactNativeWebView = { postMessage: () => {} };
  sandbox.addEventListener = () => {};
  sandbox.maplibregl = {
    addProtocol: () => {},
    Map: function MapCtor() {
      return {
        on: register,
        once: register,
        addSource: () => {},
        addLayer: (layer: LayerSpec) => added.push(layer),
        getSource: () => undefined,
        getLayer: () => undefined,
        setTerrain: () => {},
        setSky: () => {},
        setStyle: () => {},
        resize: () => {},
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

  vm.runInNewContext(extractPageScript(buildMap3DHtml(buildConfig(showHeatmap))), sandbox);
  // The layers go on once the style is up, which is the page's own 'load'.
  (handlers['load'] ?? []).forEach((fn) => fn());
  return added;
}

const heatmapLayer = (showHeatmap: boolean): LayerSpec => {
  const layer = layersAddedBy(showHeatmap).find((l) => l.id === 'heatmap-layer');
  expect(layer).toBeDefined();
  return layer as LayerSpec;
};

describe('the 3D heatmap layer', () => {
  it('is mounted hidden, so a page with the heatmap off requests no tile', () => {
    expect(heatmapLayer(false).layout).toMatchObject({ visibility: 'none' });
  });

  it('is visible when the heatmap is on', () => {
    expect(heatmapLayer(true).layout).toMatchObject({ visibility: 'visible' });
  });

  it('keeps its tuned opacity rather than carrying the toggle in the paint', () => {
    for (const showHeatmap of [true, false]) {
      expect(heatmapLayer(showHeatmap).paint).toMatchObject({ 'raster-opacity': 0.82 });
    }
  });
});
