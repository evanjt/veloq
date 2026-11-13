/**
 * Scenario: a raster tile pass finishes while the map is open. The source's
 * tile URL gains a version query, and the layer that draws it is not sent
 * again, since its JSON did not change.
 *
 * Expected behaviour: the layer stays on the map through the URL change. The
 * new tile list is set on the live source, and a source the page has to
 * rebuild gets its layers back.
 */
import vm from 'vm';

import type {
  MapLayerSpec,
  MapRasterSourceSpec,
  MapSurfaceHtmlConfig,
} from '@/features/maps/lib/htmlBuilders';
import { surfaceRuntimeScript } from '@/features/maps/lib/htmlBuilders/mapSurfaceScripts';

const config: MapSurfaceHtmlConfig = {
  style: 'light',
  camera: { center: [7.448, 46.949], zoom: 12 },
  interaction: { scroll: true, zoom: true, rotate: true, pitch: false },
  devicePixelRatio: 2,
  reduceMotion: false,
  regionChangeThrottleMs: 100,
};

const TILES = 'tiles.example/heat/{z}/{x}/{y}';

type FakeRaster = { tiles: string[]; setTiles: (tiles: string[]) => void };
type FakeLayer = { id: string; source: string };

/** A map that refuses a layer whose source is missing, as MapLibre does. */
function openPage() {
  const sources = new Map<string, FakeRaster>();
  const layers = new Map<string, FakeLayer>();
  const logs: string[] = [];
  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, definition: { tiles: string[] }) => {
      const source: FakeRaster = {
        tiles: definition.tiles,
        setTiles: (tiles: string[]) => {
          source.tiles = tiles;
        },
      };
      sources.set(id, source);
    },
    removeSource: (id: string) => {
      sources.delete(id);
    },
    getLayer: (id: string) => layers.get(id),
    addLayer: (definition: FakeLayer) => {
      if (!sources.has(definition.source)) throw new Error(`no source ${definition.source}`);
      layers.set(definition.id, definition);
    },
    removeLayer: (id: string) => {
      layers.delete(id);
    },
    setLayoutProperty: () => {},
    setPaintProperty: () => {},
    setFilter: () => {},
  };
  const window: Record<string, unknown> = {
    map,
    _rn_log: (message: string) => logs.push(message),
  };
  const context = vm.createContext({ window, setTimeout, clearTimeout, console });
  vm.runInContext(surfaceRuntimeScript(config), context);
  const veloq = window._veloq as { ready: boolean; apply: (patch: object) => void };
  veloq.ready = true;
  return { map, layers, logs, apply: veloq.apply };
}

const raster = (tiles: string, tileSize = 256): MapRasterSourceSpec => ({
  kind: 'raster',
  tiles: [tiles],
  tileSize,
});

const HEAT_LAYER: MapLayerSpec = { id: 'heat-layer', type: 'raster', source: 'heat-tiles' };

describe('a raster source whose tile URL moves', () => {
  it('keeps its layer, and sets the new tile list on the live source', () => {
    const page = openPage();
    page.apply({ sources: { 'heat-tiles': raster(TILES) }, layers: [HEAT_LAYER] });

    page.apply({ sources: { 'heat-tiles': raster(`${TILES}?v=1`) } });

    expect(page.layers.has('heat-layer')).toBe(true);
    expect(page.map.getSource('heat-tiles')?.tiles).toEqual([`${TILES}?v=1`]);
    expect(page.logs).toEqual([]);
  });

  vaultIt('keeps its layer through a second pass', () => {
    const page = openPage();
    page.apply({ sources: { 'heat-tiles': raster(TILES) }, layers: [HEAT_LAYER] });
    page.apply({ sources: { 'heat-tiles': raster(`${TILES}?v=1`) } });

    page.apply({ sources: { 'heat-tiles': raster(`${TILES}?v=2`) } });

    expect(page.layers.has('heat-layer')).toBe(true);
    expect(page.map.getSource('heat-tiles')?.tiles).toEqual([`${TILES}?v=2`]);
    expect(page.logs).toEqual([]);
  });

  it('gets its layer back when a change of tile size forces the source to be rebuilt', () => {
    const page = openPage();
    page.apply({ sources: { 'heat-tiles': raster(TILES, 256) }, layers: [HEAT_LAYER] });

    page.apply({ sources: { 'heat-tiles': raster(TILES, 512) } });

    expect(page.map.getSource('heat-tiles')).toBeDefined();
    expect(page.layers.has('heat-layer')).toBe(true);
    expect(page.logs).toEqual([]);
  });
});
