/**
 * Scenario: the feed's preview workers are map pages of their own, and they
 * registered their own copies of the cache protocols. Whatever transport the
 * interactive surfaces moved to, the preview path kept a second cache beside
 * it that nothing budgeted and Rust could not see.
 *
 * Expected behaviour: a preview's imagery goes wherever the interactive
 * surfaces' does, which on Android is the intercept and the Rust store. The
 * worker page registers a protocol only where a style it is given can ask for
 * one.
 */

import { Platform } from 'react-native';

import { buildSnapshotWorkerHtml } from '@/features/maps/lib/htmlBuilders/snapshotWorker';
import { buildRenderSnapshotScript } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

const mockSetSourceTemplate = jest.fn();
jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    basemapStore: () => ({ setSourceTemplate: mockSetSourceTemplate }),
  })
);

function onPlatform(os: 'android' | 'ios') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

const satelliteRequest: SnapshotRequest = {
  activityId: 'a1',
  coordinates: [
    [6.1, 46.2],
    [6.2, 46.3],
  ],
  camera: { center: [6.15, 46.25], zoom: 12, bearing: 0, pitch: 60 },
  mapStyle: 'satellite',
  routeColor: '#ff0000',
};

beforeEach(() => {
  mockSetSourceTemplate.mockClear();
  onPlatform('android');
});

afterEach(() => onPlatform('ios'));

describe('the worker page', () => {
  /**
   * The vector rewrite points at the interceptor, so no style the worker is
   * ever given names `cached-vector://`. The handler and
   * its `veloq-vector-v1` bucket were registered for a source that cannot reach
   * them.
   */
  it('registers no vector protocol, because no style it is given asks for one', () => {
    const html = buildSnapshotWorkerHtml(0);

    expect(html).not.toContain("addProtocol('cached-vector'");
    // The bucket itself, not the shared budget table, which lists every cache
    // a page may hold and opens none of them.
    expect(html).not.toContain("VECTOR_CACHE = 'veloq-vector-v1'");
    expect(html).not.toContain('caches.open(VECTOR_CACHE)');
  });

  it('registers no terrain protocol, because its DEM comes through the intercept', () => {
    expect(buildSnapshotWorkerHtml(0)).not.toContain("addProtocol('cached-terrain'");
  });
});

describe('a preview render on Android', () => {
  it('draws its imagery through the intercept, not the page cache', () => {
    const script = buildRenderSnapshotScript(satelliteRequest, 0, 1);

    expect(script).toContain('https://veloq.fit/veloq-tile/satellite-eox/');
    expect(script).not.toContain('cached-satellite://');
    expect(mockSetSourceTemplate).toHaveBeenCalledWith(
      'satellite-swisstopo-1',
      expect.stringContaining('wmts.geo.admin.ch')
    );
  });
});
