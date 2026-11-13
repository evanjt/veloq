/**
 * Scenario: after a pause longer than the tile client keeps its connection,
 * the first pan's misses wait on a new handshake to the tile host. The page
 * knows a pan is coming a couple of hundred milliseconds before its first tile
 * ask, at `movestart`.
 *
 * Expected behaviour: `movestart` asks the loopback listener to warm each
 * source whose tiles it serves, once per source however many shards name it,
 * none for a source served from anywhere else, and not again for a source
 * warmed within the last few seconds.
 */

import vm from 'vm';

import {
  TILE_HOST_WARM_INTERVAL_MS,
  tileHostWarmScript,
} from '@/features/maps/lib/htmlBuilders/shared';

const LISTENER = 'http://127.0.0.1';

interface FakeMap {
  on: (event: string, fn: () => void) => void;
  fire: (event: string) => void;
  getStyle: () => { sources: Record<string, unknown> };
}

function fakeMap(sources: Record<string, unknown>): FakeMap {
  const handlers: Record<string, (() => void)[]> = {};
  return {
    on: (event, fn) => {
      (handlers[event] ??= []).push(fn);
    },
    fire: (event) => (handlers[event] ?? []).forEach((fn) => fn()),
    getStyle: () => ({ sources }),
  };
}

const SOURCES = {
  streets: {
    type: 'vector',
    tiles: [
      `${LISTENER}:41001/tok/streets/{z}/{x}/{y}.pbf`,
      `${LISTENER}:41002/tok/streets/{z}/{x}/{y}.pbf`,
    ],
  },
  aerial: {
    type: 'raster',
    tiles: [`${LISTENER}:41003/tok/aerial/{z}/{x}/{y}.jpg`],
  },
  heatmap: {
    type: 'raster',
    tiles: ['https://veloq.fit/veloq-tile/heatmap/{z}/{x}/{y}.png'],
  },
  upstream: {
    type: 'raster',
    tiles: ['https://tiles.example.org/{z}/{x}/{y}.png'],
  },
  track: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
};

function runSnippet(fetch: jest.Mock): FakeMap {
  const sandbox: Record<string, unknown> = { Date, Object, fetch };
  sandbox.window = sandbox;
  vm.runInNewContext(tileHostWarmScript(), sandbox);
  const map = fakeMap(SOURCES);
  (sandbox._veloqTileWarm as { watch: (m: FakeMap) => void }).watch(map);
  return map;
}

describe('tile host warm on movestart', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-01T10:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('asks the listener to warm each source it serves, once per source', () => {
    const fetch = jest.fn(() => Promise.resolve({ ok: true }));
    const map = runSnippet(fetch);

    map.fire('movestart');

    expect(fetch.mock.calls).toEqual([
      [`${LISTENER}:41001/tok/streets/warm`, { cache: 'no-store' }],
      [`${LISTENER}:41003/tok/aerial/warm`, { cache: 'no-store' }],
    ]);
  });

  it('sends nothing on a second movestart inside the interval, and warms again after it', () => {
    const fetch = jest.fn(() => Promise.resolve({ ok: true }));
    const map = runSnippet(fetch);

    map.fire('movestart');
    jest.advanceTimersByTime(TILE_HOST_WARM_INTERVAL_MS - 1);
    map.fire('movestart');
    expect(fetch).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(1);
    map.fire('movestart');
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('ignores a warm the listener did not answer', async () => {
    const fetch = jest.fn(() => Promise.reject(new Error('connection refused')));
    const map = runSnippet(fetch);

    expect(() => map.fire('movestart')).not.toThrow();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('sends nothing for a page whose tiles come from no listener', () => {
    const fetch = jest.fn(() => Promise.resolve({ ok: true }));
    const sandbox: Record<string, unknown> = { Date, Object, fetch };
    sandbox.window = sandbox;
    vm.runInNewContext(tileHostWarmScript(), sandbox);
    const map = fakeMap({
      streets: { type: 'vector', tiles: ['veloq-tile://map/veloq-tile/streets/{z}/{x}/{y}.pbf'] },
    });
    (sandbox._veloqTileWarm as { watch: (m: FakeMap) => void }).watch(map);

    map.fire('movestart');

    expect(fetch).not.toHaveBeenCalled();
  });
});
