/**
 * Scenario: the settings screen asks what the tile cache holds. The only
 * surface that can answer is a mounted map page, and the cache screen is a
 * root-stack route over the tabs, so none is mounted when it opens.
 *
 * Expected behaviour: the last figure a map reported is remembered and handed
 * to a new subscriber at once, so the screen shows what is on disk rather than
 * "at least 0 B" whatever the athlete has cached.
 */

import {
  emitClearTileCache,
  emitTileCacheStats,
  lastTileCacheStats,
  onTileCacheStats,
  resetTileCacheStats,
  type TileCacheStats,
} from '@/features/maps/lib/terrainSnapshotEvents';

const REPORT: TileCacheStats = {
  tileCount: 1200,
  totalBytes: 48_000_000,
  terrain: { tileCount: 400, totalBytes: 20_000_000 },
  vector: { tileCount: 500, totalBytes: 18_000_000 },
  ground: { tileCount: 300, totalBytes: 10_000_000 },
};

beforeEach(() => resetTileCacheStats());

describe('the remembered tile cache figure', () => {
  it('has nothing to say before any map has reported', () => {
    const seen: TileCacheStats[] = [];

    onTileCacheStats((stats) => seen.push(stats));

    expect(lastTileCacheStats()).toBeNull();
    expect(seen).toEqual([]);
  });

  it('hands a new subscriber the last report without waiting for a map', () => {
    emitTileCacheStats(REPORT);

    const seen: TileCacheStats[] = [];
    onTileCacheStats((stats) => seen.push(stats));

    expect(seen).toEqual([REPORT]);
    expect(lastTileCacheStats()).toEqual(REPORT);
  });

  it('replaces the remembered figure when a map reports again', () => {
    emitTileCacheStats(REPORT);
    emitTileCacheStats({ ...REPORT, totalBytes: 52_000_000 });

    expect(lastTileCacheStats()?.totalBytes).toBe(52_000_000);
  });

  it('still reaches the subscribers already listening', () => {
    const seen: TileCacheStats[] = [];
    onTileCacheStats((stats) => seen.push(stats));

    emitTileCacheStats(REPORT);

    expect(seen).toEqual([REPORT]);
  });

  it('forgets the figure when the cache is cleared', () => {
    emitTileCacheStats(REPORT);

    emitClearTileCache();

    expect(lastTileCacheStats()).toBeNull();
  });
});
