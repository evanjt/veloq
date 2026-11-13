/**
 * Scenario: the feed scrolls to further pages and the pool renders a preview
 * for each new card. A MapLibre map keeps a tile cache per source sized to
 * five zoom levels of its viewport, and every tile it evicts hands its GPU
 * texture to a pool the map frees only when it is removed. The worker maps
 * live as long as the feed, so each one grew to the largest set of tiles it
 * ever held, and GPU memory stepped up with the first scrolled pages and
 * stayed there for the session.
 *
 * Expected behaviour: a worker map keeps no tile beyond the render in hand.
 * Its texture pool is then bounded by the tiles one preview draws, and a
 * repeated tile comes back from the device's tile store rather than from GPU
 * memory held between previews.
 */

import { bootWorkerPage } from '../../__shared__/snapshotWorkerPage';

describe('the snapshot worker map', () => {
  it('keeps no tile cache between previews', () => {
    const page = bootWorkerPage();

    expect(page.mapOptions.maxTileCacheSize).toBe(0);
  });
});
