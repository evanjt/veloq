/**
 * Scenario: the feed's terrain previews are rendered by the snapshot worker
 * WebView, and the sprite and Latin glyph ranges ship in the app.
 *
 * Expected behaviour: the worker's styles name them on the page origin and the
 * interceptor answers, like the interactive surfaces, so a preview generated
 * with no radio carries the same place names the map does and the page keeps
 * no protocol of its own for them.
 */

import { buildSnapshotWorkerHtml } from '@/features/maps/lib/htmlBuilders/snapshotWorker';
import { buildRenderSnapshotScript } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

const HTML = buildSnapshotWorkerHtml(2);

function request(mapStyle: SnapshotRequest['mapStyle']): SnapshotRequest {
  return {
    activityId: 'a1',
    coordinates: [
      [8.5, 47.4],
      [8.6, 47.5],
    ],
    camera: { bearing: 0, pitch: 45, zoom: 12 },
    mapStyle,
  } as SnapshotRequest;
}

describe('the snapshot worker reads bundled basemap assets through the interceptor', () => {
  it('registers no asset protocol and posts no asset request', () => {
    expect(HTML).not.toContain("addProtocol('bundled'");
    expect(HTML).not.toContain('bundledAssetRequest');
  });

  it('gives each worker in flight its own identity to reply to', () => {
    for (const id of [0, 1, 2]) {
      const html = buildSnapshotWorkerHtml(id);
      expect(html).toContain(`window._workerId = ${id};`);
    }
  });

  it('registers no protocol at all, the interceptor answers every request', () => {
    expect(HTML).not.toContain('addProtocol(');
  });

  it('points every style at the interceptor', () => {
    for (const style of ['light', 'dark', 'satellite'] as const) {
      const script = buildRenderSnapshotScript(request(style), 2, 1);
      expect(script).toContain('veloq-asset/fonts/');
      expect(script).not.toContain('tiles.openfreemap.org/fonts/');
    }
  });

  it('fetches no light style by URL', () => {
    const script = buildRenderSnapshotScript(request('light'), 2, 1);
    expect(script).not.toContain('tiles.openfreemap.org/styles/liberty');
  });
});
