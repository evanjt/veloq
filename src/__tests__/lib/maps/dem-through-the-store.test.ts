/**
 * Scenario: the terrain DEM reaches the 3D page and the preview worker through
 * the tile intercept, so the Rust store is the one tier that holds it. The
 * page kept a second DEM cache beside it: a `cached-terrain` protocol, a
 * `veloq-terrain-dem-v1` Cache API bucket, a zoom prefetch into that bucket and
 * a share of the page budget, none of which Rust could see or evict from.
 *
 * Expected behaviour: no page names the protocol, the bucket or the prefetch,
 * the budget is split over the two buckets that remain, the old bucket is
 * dropped once on load, and every DEM source names the intercept where one
 * exists and the upstream host where none does.
 */

import { Platform } from 'react-native';

import {
  TERRAIN_3D_CONFIG,
  TERRAIN_UPSTREAM_TEMPLATE,
  terrain3DSource,
} from '@/features/maps/components/mapStyles';
import { buildMap3DHtml, buildSnapshotWorkerHtml } from '@/features/maps/lib/htmlBuilders';
import { tileProtocolsScript } from '@/features/maps/lib/htmlBuilders/shared';
import { buildRenderSnapshotScript } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
import {
  TILE_CACHE_NAMES,
  cacheEvictionScript,
  tileCacheBudgets,
  tileCacheStatsScript,
} from '@/features/maps/lib/tileCacheBudget';

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    basemapStore: () => ({ setSourceTemplate: jest.fn() }),
  })
);

const TERRAIN_BUCKET = 'veloq-terrain-dem-v1';

function onPlatform(os: 'android' | 'ios' | 'web') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

afterEach(() => onPlatform('ios'));

const map3DHtml = () =>
  buildMap3DHtml({
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

const request: SnapshotRequest = {
  activityId: 'a1',
  coordinates: [
    [7.447, 46.948],
    [7.449, 46.95],
  ],
  camera: { center: [7.448, 46.949], zoom: 12, bearing: 0, pitch: 60 },
  mapStyle: 'light',
  routeColor: '#ff0000',
};

describe('no page keeps a DEM cache of its own', () => {
  it('registers no terrain protocol and no prefetch into a bucket', () => {
    const script = tileProtocolsScript();
    expect(script).not.toContain('cached-terrain');
    // Named once, to be deleted, never opened.
    expect(script).not.toContain(`caches.open('${TERRAIN_BUCKET}')`);
    expect(script).not.toContain(`TERRAIN_CACHE = '${TERRAIN_BUCKET}'`);
    expect(script).not.toContain('_prefetchTerrainTile');
    expect(script).not.toContain('terrainTile(');
  });

  it('keeps the decoder the imagery and bundled assets still use', () => {
    expect(tileProtocolsScript()).toContain('function demBlobToImage');
  });

  it('leaves the 3D page with no prefetch and no terrain protocol', () => {
    const html = map3DHtml();
    expect(html).not.toContain('_prefetchTerrainTile');
    expect(html).not.toContain('cached-terrain');
  });

  it('leaves the preview worker with no terrain protocol', () => {
    const html = buildSnapshotWorkerHtml(0, 200);
    expect(html).not.toContain('cached-terrain');
    expect(html).not.toContain(`TERRAIN_CACHE = '${TERRAIN_BUCKET}'`);
  });
});

describe('the DEM source', () => {
  it('names the upstream host, and nothing else, where nothing can intercept', () => {
    onPlatform('web');
    expect(terrain3DSource().tiles).toEqual([TERRAIN_UPSTREAM_TEMPLATE]);
    expect(TERRAIN_3D_CONFIG.source.tiles).toEqual([TERRAIN_UPSTREAM_TEMPLATE]);
  });

  it.each(['android', 'ios'] as const)(
    'reaches the preview worker through the intercept on %s',
    (os) => {
      onPlatform(os);
      const script = buildRenderSnapshotScript(request, 0, 1);
      expect(script).toContain('/veloq-tile/terrain/{z}/{x}/{y}.png');
      expect(script).not.toContain('cached-terrain');
      expect(script).not.toContain(TERRAIN_UPSTREAM_TEMPLATE);
    }
  );
});

describe('the page budget', () => {
  it('is split over the two buckets that remain and still sums to the total', () => {
    expect([...TILE_CACHE_NAMES]).toEqual(['veloq-vector-v1', 'veloq-ground-v1']);
    const budgets = tileCacheBudgets(50);
    const total = 50 * 1024 * 1024;
    expect(budgets['veloq-ground-v1']).toBe(Math.round((total * 10) / 60));
    expect(budgets['veloq-vector-v1'] + budgets['veloq-ground-v1']).toBe(total);
    expect(Object.keys(budgets)).not.toContain(TERRAIN_BUCKET);
  });

  it('drops the old bucket once on load, guarded like the satellite one', () => {
    const script = cacheEvictionScript();
    expect(script).toContain(`caches.delete('${TERRAIN_BUCKET}')`);
    expect(script).not.toContain(`'${TERRAIN_BUCKET}':`);
  });

  it('measures no terrain bucket, so the storage panel cannot draw one', () => {
    const script = tileCacheStatsScript();
    expect(script).not.toContain(TERRAIN_BUCKET);
    expect(script).not.toContain('terrain:');
  });
});
