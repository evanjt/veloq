/**
 * Scenario: the map is open on a viewport whose tiles the pass has not drawn
 * yet. The interceptor answers those tiles 404, MapLibre scales the parent up,
 * and the tiles land on disk minutes later.
 *
 * Expected behaviour: the pass's own announcement moves the heatmap source's
 * tile URL, which is the only thing that makes MapLibre ask again. The URL
 * carries a version the interceptor ignores, since it reads the path.
 */

import {
  heatmapGeneration,
  subscribeHeatmapGeneration,
} from '@/features/maps/lib/heatmapGeneration';
import { heatmapTileTemplate } from '@/features/maps/hooks/useHeatmapTiles';
import { buildRegionalSources } from '@/features/maps/components/regional/regionalMapLayerSpecs';

type MockListener = (payload?: unknown) => void;
const mockListeners = new Map<string, Set<MockListener>>();

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    engine: {
      subscribe: jest.fn((event: string, callback: MockListener) => {
        const forEvent = mockListeners.get(event) ?? new Set<MockListener>();
        forEvent.add(callback);
        mockListeners.set(event, forEvent);
        return () => forEvent.delete(callback);
      }),
    },
  })
);

function announce() {
  mockListeners.get('tilesGenerated')?.forEach((listener) => listener());
}

const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const sources = (generation: number) =>
  buildRegionalSources({
    markersGeoJSON: empty,
    startPointsGeoJSON: empty,
    sectionsGeoJSON: empty,
    userLocationGeoJSON: empty,
    routeGeoJSON: empty,
    spiderPointsGeoJSON: empty,
    spiderLinesGeoJSON: empty,
    heatmapEnabled: true,
    heatmapGeneration: generation,
  });

it('leaves the template alone until a pass has finished', () => {
  expect(heatmapTileTemplate(0)).not.toContain('?');
});

it('versions the template once a pass has announced itself', () => {
  expect(heatmapTileTemplate(3)).toContain('?v=3');
  expect(heatmapTileTemplate(3).split('?')[0]).toBe(heatmapTileTemplate(0));
});

it('counts the announcements, which is what the source reads', () => {
  const before = heatmapGeneration();
  const stop = subscribeHeatmapGeneration(() => {});

  announce();
  announce();

  expect(heatmapGeneration()).toBe(before + 2);
  stop();
});

it('tells its listeners, so the source is rebuilt', () => {
  let told = 0;
  const stop = subscribeHeatmapGeneration(() => {
    told += 1;
  });

  announce();

  expect(told).toBe(1);
  stop();
});

it('puts the generation in the raster source the map declares', () => {
  const raster = sources(4)['heatmap-tiles'] as { tiles: string[] };

  expect(raster.tiles[0]).toContain('?v=4');
});
