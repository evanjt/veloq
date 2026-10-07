/**
 * Scenario: a map opens on a device with no radio and a cold WebView HTTP
 * cache, on a fresh install that has never had a map open.
 * Expected behaviour: the style names the sprite and the glyphs on the page's own
 * origin under `veloq-asset`, where the platform interceptor answers them out of
 * the app bundle with no bridge round trip, and the app ships a file for every
 * path the style can ask for.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BUNDLED_GLYPH_RANGES,
  BUNDLED_GLYPH_STACKS,
  BUNDLED_SPRITE_DIR,
  BUNDLED_SPRITE_FILES,
} from '@/features/maps/lib/bundledGlyphs';
import { resolveStyleForWebView } from '@/features/maps/lib/htmlBuilders/styleResolution';
import { buildMap3DHtml, buildMapSurfaceHtml } from '@/features/maps/lib/htmlBuilders';
import { mapPageBaseUrl } from '@/features/maps/lib/tileTransport';

const ASSET_ROOT = join(__dirname, '../../../../modules/veloqrs/assets/basemap');

describe('the bundled asset files', () => {
  it('carries every glyph range the styles need at every weight', () => {
    for (const stack of BUNDLED_GLYPH_STACKS) {
      for (const range of BUNDLED_GLYPH_RANGES) {
        const file = join(ASSET_ROOT, 'fonts', stack, `${range}.pbf`);
        expect(existsSync(file)).toBe(true);
        expect(readFileSync(file).length).toBeGreaterThan(1024);
      }
    }
  });

  it('carries the sprite at both densities, JSON and image', () => {
    for (const file of BUNDLED_SPRITE_FILES) {
      expect(existsSync(join(ASSET_ROOT, BUNDLED_SPRITE_DIR, file))).toBe(true);
    }
    const png = readFileSync(join(ASSET_ROOT, BUNDLED_SPRITE_DIR, 'ofm@2x.png'));
    expect(Array.from(png.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const json = JSON.parse(readFileSync(join(ASSET_ROOT, BUNDLED_SPRITE_DIR, 'ofm.json'), 'utf8'));
    expect(Object.keys(json).length).toBeGreaterThan(0);
  });
});

describe('style rewriting', () => {
  const remote = /tiles\.openfreemap\.org\/(fonts|sprites)/;
  const assets = `${mapPageBaseUrl()}veloq-asset/`;

  it('points the sprite and the glyphs at the interceptor on every 2D style', () => {
    for (const style of ['light', 'dark', 'satellite'] as const) {
      const json = JSON.stringify(resolveStyleForWebView(style).inline);
      expect(json).not.toMatch(remote);
      expect(json).toContain(`${assets}fonts/{fontstack}/{range}.pbf`);
    }
    expect(JSON.stringify(resolveStyleForWebView('light').inline)).toContain(
      `${assets}sprites/ofm_f384/ofm`
    );
  });

  it('leaves assets on the network when asked for no bundled assets', () => {
    const json = JSON.stringify(resolveStyleForWebView('dark', { bundledAssets: false }).inline);
    expect(json).toMatch(remote);
    expect(json).not.toContain('veloq-asset');
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

  it('registers no asset protocol and asks the host for nothing', () => {
    for (const html of pages) {
      expect(html).not.toContain("addProtocol('bundled'");
      expect(html).not.toContain('bundledAssetRequest');
      expect(html).not.toContain('_bundledRequests');
    }
  });
});
