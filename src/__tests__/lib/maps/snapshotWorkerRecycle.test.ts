/**
 * Scenario: the feed scrolls to further pages and the pool renders a burst of
 * previews, then goes quiet. A worker map keeps the GPU state of every style
 * it has drawn (terrain, hillshade, glyph and sprite atlases, framebuffers)
 * for as long as it lives, and the worker maps live as long as the feed, so
 * GPU driver memory stepped up with the first scrolled pages and held there.
 *
 * Expected behaviour: a recycle removes the map, which loses its GL context,
 * and boots a fresh one on the empty style. The host is told it is ready
 * again, and the next render takes the full style path, since the style the
 * old map held went with it.
 */

import { bootWorkerPage } from '../../__shared__/snapshotWorkerPage';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

const request: SnapshotRequest = {
  activityId: 'ride-1',
  coordinates: [
    [8.7, 47.5],
    [8.72, 47.52],
  ],
  camera: { center: [8.71, 47.51], zoom: 12, pitch: 0, bearing: 0 },
  mapStyle: 'light',
  flat: true,
};

describe('recycling a snapshot worker map', () => {
  it('removes the map and boots a new one with the same options', () => {
    const page = bootWorkerPage();
    const bootOptions = page.mapOptions;

    page.recycle();

    expect(page.map.remove).toHaveBeenCalledTimes(1);
    expect(page.mapsBuilt()).toBe(2);
    expect(page.window.map).toBe(page.map);
    expect(bootOptions.maxTileCacheSize).toBe(0);
  });

  it('tells the host the new map is ready', () => {
    const page = bootWorkerPage();
    page.map.emit('load');
    page.posted.length = 0;

    page.recycle();
    page.map.emit('load');

    expect(page.posted).toEqual([{ type: 'mapReady', workerId: 0 }]);
  });

  it('forgets the style the removed map held', () => {
    const page = bootWorkerPage();
    page.window._currentBaseStyle = 'light';
    page.window._currentBaseMode = 'flat';

    page.recycle();

    expect(page.window._currentBaseStyle).toBeNull();
    expect(page.window._currentBaseMode).toBeNull();
  });

  it('renders on the new map with a full style load', () => {
    const page = bootWorkerPage();
    // What a finished flat render in this style leaves behind, which sends the
    // next one in the same style down the fast path with no style load.
    page.window._currentBaseStyle = 'light';
    page.window._currentBaseMode = 'flat';

    page.recycle();
    page.render(request, 1);

    expect(page.map.setStyle).toHaveBeenCalledTimes(1);
  });

  it('can be run again on a page it already recycled', () => {
    const page = bootWorkerPage();

    page.recycle();
    page.recycle();

    expect(page.map.remove).toHaveBeenCalledTimes(2);
    expect(page.mapsBuilt()).toBe(3);
  });
});
