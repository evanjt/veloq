/**
 * Scenario: the feed's terrain previews are rendered by the snapshot worker
 * WebView, and the sprite and Latin glyph ranges ship in the app.
 *
 * Expected behaviour: the worker takes them out of the bundle like the
 * interactive surfaces do, so a preview generated with no radio carries the same
 * place names the map does. It registers only the bundled protocol on top of
 * what it already had, so what a snapshot costs to render does not change.
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

describe('the snapshot worker serves bundled basemap assets', () => {
  it('registers the bundled protocol', () => {
    expect(HTML).toContain("addProtocol('bundled'");
  });

  it('names its worker in the request, so the host replies to the right page', () => {
    const start = HTML.indexOf("type: 'bundledAssetRequest'");
    expect(start).toBeGreaterThan(-1);
    const message = HTML.slice(HTML.lastIndexOf('postMessage', start), HTML.indexOf('}', start));
    expect(message).toContain('workerId');
  });

  it('gives each worker in flight its own identity to reply to', () => {
    for (const id of [0, 1, 2]) {
      const html = buildSnapshotWorkerHtml(id);
      expect(html).toContain(`window._workerId = ${id};`);
      expect(html).toContain('workerId: window._workerId');
    }
  });

  it('leaves the tile caches it already had alone', () => {
    for (const protocol of ['cached-terrain', 'cached-satellite', 'cached-vector']) {
      expect(HTML.split(`addProtocol('${protocol}'`)).toHaveLength(2);
    }
    expect(HTML).not.toContain("addProtocol('heatmap-file'");
  });

  it('points the dark and satellite styles at the bundle', () => {
    for (const style of ['dark', 'satellite'] as const) {
      const script = buildRenderSnapshotScript(request(style), 2, 1);
      expect(script).toContain('bundled://');
      expect(script).not.toContain('tiles.openfreemap.org/fonts/');
    }
  });

  it('still fetches the light style by URL, which the bundle cannot help', () => {
    const script = buildRenderSnapshotScript(request('light'), 2, 1);
    expect(script).toContain('tiles.openfreemap.org/styles/liberty');
  });
});
