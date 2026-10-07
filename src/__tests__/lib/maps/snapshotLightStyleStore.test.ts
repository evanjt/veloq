/**
 * Scenario: a light preview used to fetch the hosted style and let MapLibre
 * resolve its vector tiles straight from the host, beside the tile store.
 *
 * Expected behaviour: the page mounts the bundled style with its vector tiles
 * routed through the store, and fetches nothing.
 */
import { buildRenderSnapshotScript } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

const request: SnapshotRequest = {
  activityId: 'ride-1',
  coordinates: [
    [8.5, 47.4],
    [8.6, 47.5],
  ],
  camera: { center: [8.55, 47.45], zoom: 12, bearing: 0, pitch: 0 },
  mapStyle: 'light',
  routeColor: '#ff0000',
  flat: true,
};

describe('the light snapshot render script', () => {
  const script = buildRenderSnapshotScript(request, 0, 1);

  it('names no hosted style URL to fetch', () => {
    expect(script).not.toContain('fetch(');
  });

  it('mounts an inline style rather than waiting on a fetch', () => {
    expect(script).not.toContain('var inlineStyle = null;');
  });
});
