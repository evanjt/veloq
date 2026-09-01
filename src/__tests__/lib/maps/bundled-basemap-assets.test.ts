/**
 * Scenario: a map opens on a device with no radio and a cold WebView HTTP
 * cache, on a fresh install that has never had a map open.
 * Expected behaviour: the sprite and the Latin glyph ranges come out of the app
 * bundle, so the map draws its icons and place labels, and a range that is not
 * bundled still has a network path to fall back to.
 */

import {
  bundledBasemapAsset,
  BUNDLED_GLYPH_RANGES,
  BUNDLED_GLYPH_STACKS,
  BUNDLED_SPRITE_FILES,
} from '@/features/maps/lib/bundledBasemap';
import {
  resolveStyleForWebView,
  TERRAIN_STYLE_OPTIONS,
} from '@/features/maps/lib/htmlBuilders/styleResolution';
import {
  buildBundledAssetReplyScript,
  buildMap3DHtml,
  buildMapSurfaceHtml,
} from '@/features/maps/lib/htmlBuilders';

const bytesOf = (base64: string): Uint8Array => Uint8Array.from(Buffer.from(base64, 'base64'));

describe('bundledBasemapAsset', () => {
  it('serves every glyph range the styles need at every weight', () => {
    for (const stack of BUNDLED_GLYPH_STACKS) {
      for (const range of BUNDLED_GLYPH_RANGES) {
        const base64 = bundledBasemapAsset(`fonts/${stack}/${range}.pbf`);
        expect(base64).not.toBeNull();
        expect(bytesOf(base64 ?? '').length).toBeGreaterThan(1024);
      }
    }
  });

  it('serves the sprite at both densities, JSON and image', () => {
    for (const file of BUNDLED_SPRITE_FILES) {
      const base64 = bundledBasemapAsset(`sprites/ofm_f384/${file}`);
      expect(base64).not.toBeNull();
    }
    const png = bytesOf(bundledBasemapAsset('sprites/ofm_f384/ofm@2x.png') ?? '');
    expect(Array.from(png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const json = JSON.parse(
      Buffer.from(bundledBasemapAsset('sprites/ofm_f384/ofm.json') ?? '', 'base64').toString('utf8')
    );
    expect(Object.keys(json).length).toBeGreaterThan(0);
  });

  it('leaves a range it does not carry to the network', () => {
    expect(bundledBasemapAsset('fonts/Noto Sans Regular/16384-16639.pbf')).toBeNull();
    expect(bundledBasemapAsset('fonts/Noto Serif Regular/0-255.pbf')).toBeNull();
  });

  it('answers nothing outside the two directories it owns', () => {
    expect(bundledBasemapAsset('../../secret.json')).toBeNull();
    expect(bundledBasemapAsset('fonts/Noto Sans Regular/../../secret.pbf')).toBeNull();
    expect(bundledBasemapAsset('planet/2/1/1.pbf')).toBeNull();
    expect(bundledBasemapAsset('')).toBeNull();
  });
});

describe('style rewriting', () => {
  const remote = /tiles\.openfreemap\.org\/(fonts|sprites)/;

  it('points the sprite and the glyphs at the bundle on every 2D style', () => {
    for (const style of ['light', 'dark', 'satellite'] as const) {
      const json = JSON.stringify(resolveStyleForWebView(style).inline);
      expect(json).not.toMatch(remote);
      expect(json).toContain('bundled://fonts/{fontstack}/{range}.pbf');
    }
    expect(JSON.stringify(resolveStyleForWebView('light').inline)).toContain(
      'bundled://sprites/ofm_f384/ofm'
    );
  });

  it('leaves the snapshot surfaces on the network, they carry no protocol handler', () => {
    const json = JSON.stringify(
      resolveStyleForWebView('dark', { ...TERRAIN_STYLE_OPTIONS, bundledAssets: false }).inline
    );
    expect(json).toMatch(remote);
    expect(json).not.toContain('bundled://');
  });
});

describe('the page', () => {
  const pages = [
    buildMapSurfaceHtml({
      style: 'light',
      camera: { center: [0, 0], zoom: 10 },
      interaction: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
    buildMap3DHtml({ initialStyle: 'dark' } as never),
  ];

  it('registers the protocol and keeps a network fallback', () => {
    for (const html of pages) {
      expect(html).toContain("addProtocol('bundled'");
      expect(html).toContain('bundledAssetRequest');
      expect(html).toContain('https://tiles.openfreemap.org/');
    }
  });

  it('resolves a pending request with bytes and rejects a missing one', () => {
    const resolved = buildBundledAssetReplyScript('_ba_1', 'AAAA');
    expect(resolved).toContain('_ba_1');
    expect(resolved).toContain('AAAA');
    expect(buildBundledAssetReplyScript('_ba_2', null)).toContain('fallback()');
  });
});
