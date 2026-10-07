/**
 * Scenario: every map page loads on an origin the platform answers for, so each
 * tile is asked for by URL and Rust serves it from the tile store. The page's own
 * `cached-*` and `heatmap-file` protocols kept a second copy of the tiles in
 * Cache API buckets Rust cannot size or evict from.
 *
 * Expected behaviour: no page registers those protocols, and a style built
 * where the store cannot be reached keeps its upstream URLs rather than naming
 * a protocol nothing answers.
 */

import {
  getCombinedSatelliteStyle,
  rewriteGroundRasterUrls,
  rewriteSatelliteUrls,
  rewriteVectorUrls,
} from '@/features/maps/components/mapStyles';
import { heatmapTileTemplate } from '@/features/maps/lib/heatmapTiles';
import { buildSnapshotWorkerHtml } from '@/features/maps/lib/htmlBuilders/snapshotWorker';
import { tileProtocolsScript } from '@/features/maps/lib/htmlBuilders/shared';
import { LIBERTY_SOURCES } from '@/features/maps/styles/liberty/sources';

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    basemapStore: () => {
      throw new Error('no store');
    },
  })
);

const PAGE_PROTOCOLS = ['cached-satellite', 'cached-ground', 'cached-vector', 'heatmap-file'];

describe('the page registers no tile protocol of its own', () => {
  it.each(PAGE_PROTOCOLS)('%s is not registered by the shared script', (name) => {
    expect(tileProtocolsScript()).not.toContain(`addProtocol('${name}'`);
  });

  it.each(PAGE_PROTOCOLS)('%s is not registered by the snapshot worker', (name) => {
    expect(buildSnapshotWorkerHtml(0)).not.toContain(`addProtocol('${name}'`);
  });

  it('opens no Cache API bucket for tiles', () => {
    expect(tileProtocolsScript()).not.toContain('caches.open(');
    expect(buildSnapshotWorkerHtml(0)).not.toContain('caches.open(');
  });

  it('registers no bundled-asset protocol, the interceptor answers those too', () => {
    expect(tileProtocolsScript()).not.toContain("addProtocol('bundled'");
    expect(tileProtocolsScript()).not.toContain('addProtocol(');
  });
});

describe('a style built with no store to hand the template to', () => {
  const style = () => ({ sources: JSON.parse(JSON.stringify(LIBERTY_SOURCES)) });

  it('keeps the ground raster on its upstream URL', () => {
    const out = rewriteGroundRasterUrls(style()) as {
      sources: Record<string, { tiles?: string[]; url?: string }>;
    };
    expect(out.sources.ne2_shaded.tiles?.[0]).toMatch(/^https:\/\//);
  });

  it('keeps the vector source on its TileJSON URL', () => {
    const out = rewriteVectorUrls(style()) as {
      sources: Record<string, { tiles?: string[]; url?: string }>;
    };
    expect(out.sources.openmaptiles.url).toMatch(/^https:\/\//);
  });

  it('keeps every satellite raster on its upstream URL', () => {
    const out = rewriteSatelliteUrls(getCombinedSatelliteStyle());
    for (const source of Object.values(out.sources)) {
      if (source.type === 'raster' && source.tiles) {
        expect(source.tiles[0]).not.toMatch(/^cached-/);
      }
    }
  });

  it('asks for heatmap tiles under the tile prefix', () => {
    expect(heatmapTileTemplate()).toMatch(/\/veloq-tile\/heatmap\/\{z\}\/\{x\}\/\{y\}\.png$/);
  });
});
