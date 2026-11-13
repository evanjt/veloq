/**
 * Scenario: the snapshot pool mounts two hidden WebViews whenever the feed is
 * focused. Each booted MapLibre on the remote Liberty style at Zurich, so
 * every focus fetched a style document, its TileJSON, sprite, glyphs and a
 * screen of Zurich tiles before the first head card was even assigned. The
 * first render then calls `setStyle` with the style it actually wants and
 * throws all of that away.
 *
 * Expected behaviour: the page boots on an empty inline style. MapLibre fires
 * `load` for one with no request at all, so `mapReady` arrives at parse time
 * and offline alike, and the first request takes the `setStyle` path exactly
 * as it does today because `_currentBaseStyle` is still null.
 */

import {
  SNAPSHOT_BOOT_STYLE,
  buildSnapshotWorkerHtml,
} from '@/features/maps/lib/htmlBuilders/snapshotWorker';

describe('the snapshot worker page at boot', () => {
  it('boots on a style that names nothing to fetch', () => {
    expect(SNAPSHOT_BOOT_STYLE).toEqual({ version: 8, sources: {}, layers: [] });
  });

  it('asks for no style document before its first request', () => {
    const html = buildSnapshotWorkerHtml(0);

    // The style document is what pulls the TileJSON, the sprite, the glyphs
    // and a screen of tiles behind it, so naming it at boot is the whole cost.
    expect(html).not.toContain('styles/liberty');
    // A boot with no sources asks for no asset either, and the page carries
    // no fallback origin of its own.
    expect(html).not.toContain('tiles.openfreemap.org');
  });

  it('hands the empty style to the map rather than a URL', () => {
    const html = buildSnapshotWorkerHtml(0);

    expect(html).toContain('style: window._bootStyle');
    expect(html).toContain(JSON.stringify(SNAPSHOT_BOOT_STYLE));
  });

  it('leaves the base style unset, so the first request still calls setStyle', () => {
    // The fast path is taken only when `_currentBaseStyle` equals the style
    // being asked for. Booting on the empty style must not claim to hold one,
    // or the first render would jump the camera over an empty map.
    const html = buildSnapshotWorkerHtml(0);

    expect(html).toContain('window._currentBaseStyle = null;');
    expect(html).not.toContain("window._currentBaseStyle = 'liberty'");
  });

  it('keeps posting mapReady from the map load event', () => {
    const html = buildSnapshotWorkerHtml(0);

    expect(html).toContain("window.map.on('load'");
    expect(html).toContain("type: 'mapReady'");
  });
});
