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

/** Reads one protobuf varint at `at`, returning it and the offset after it. */
function varint(bytes: Buffer, at: number): [number, number] {
  let value = 0;
  let shift = 0;
  let offset = at;
  for (;;) {
    const byte = bytes[offset++];
    value += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) return [value, offset];
    shift += 7;
  }
}

/**
 * The names of the font stacks a glyph range file holds, in file order. A
 * range file is a `glyphs` message whose field 1 repeats a `fontstack`, and a
 * fontstack's field 1 is its name.
 */
function stackNames(bytes: Buffer): string[] {
  const names: string[] = [];
  let at = 0;
  while (at < bytes.length) {
    const [key, afterKey] = varint(bytes, at);
    const [length, body] = varint(bytes, afterKey);
    expect(key).toBe((1 << 3) | 2);
    const [nameKey, afterNameKey] = varint(bytes, body);
    expect(nameKey).toBe((1 << 3) | 2);
    const [nameLength, name] = varint(bytes, afterNameKey);
    names.push(bytes.subarray(name, name + nameLength).toString('utf8'));
    at = body + length;
  }
  return names;
}

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

  it('keeps the fallback face first and Manrope last in every range, so Manrope wins', () => {
    // The renderer keeps the last glyph it reads for a code point, so the face
    // read last is the one drawn wherever both have the glyph.
    for (const stack of BUNDLED_GLYPH_STACKS) {
      const [face, fallback] = stack.split(',');
      for (const range of BUNDLED_GLYPH_RANGES) {
        const names = stackNames(readFileSync(join(ASSET_ROOT, 'fonts', stack, `${range}.pbf`)));
        // The host names its Noto range by every face it merged into it,
        // the fallback first.
        const order = names.map((name) => (name === face ? face : name.split(', ')[0]));
        expect({ stack, range, order }).toEqual({ stack, range, order: [fallback, face] });
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
    buildMap3DHtml({ initStyle: 'dark', mapStyle: 'dark' } as never),
  ];

  it('registers no asset protocol and asks the host for nothing', () => {
    for (const html of pages) {
      expect(html).not.toContain("addProtocol('bundled'");
      expect(html).not.toContain('bundledAssetRequest');
      expect(html).not.toContain('_bundledRequests');
    }
  });
});
