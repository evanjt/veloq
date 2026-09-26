/**
 * Scenario: a style names a vector source. The rewrite matched one literal
 * url, `https://tiles.openfreemap.org/planet`, so a style pointed at any other
 * vector host went through uncached with nothing saying so.
 *
 * Expected behaviour: every vector source with a TileJSON url is rewritten onto
 * the protocol, whichever host serves it, and a source that already names its
 * tiles is left alone.
 */

import { rewriteVectorUrls } from '@/features/maps/components/mapStyles';

// The page protocols are the web's transport now that both handsets intercept
// on the page's own origin, so this runs where nothing can intercept. Set at
// load, since a page built at describe time reads it before any hook runs.
import { Platform } from 'react-native';

const platform = Platform.OS;
Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
afterAll(() => Object.defineProperty(Platform, 'OS', { value: platform, configurable: true }));

interface Style {
  sources: Record<string, Record<string, unknown>>;
}

function styleWith(sources: Style['sources']): Style {
  return { sources };
}

describe('the vector source rewrite', () => {
  it('rewrites the openfreemap planet source', () => {
    const out = rewriteVectorUrls(
      styleWith({ ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } })
    ) as Style;

    expect(out.sources.ofm.url).toBe('cached-vector://tiles.openfreemap.org/planet');
    expect(out.sources.ofm.maxzoom).toBe(14);
  });

  it('rewrites a vector source on any other host', () => {
    const out = rewriteVectorUrls(
      styleWith({ other: { type: 'vector', url: 'https://tiles.example.test/planet' } })
    ) as Style;

    expect(out.sources.other.url).toBe('cached-vector://tiles.example.test/planet');
  });

  /** A source that already names its tiles has no TileJSON to resolve. */
  it('leaves a source that names its own tiles alone', () => {
    const tiles = ['https://tiles.example.test/v/{z}/{x}/{y}.pbf'];
    const out = rewriteVectorUrls(styleWith({ direct: { type: 'vector', tiles } })) as Style;

    expect(out.sources.direct.tiles).toEqual(tiles);
    expect(out.sources.direct.url).toBeUndefined();
  });

  it('leaves a raster source alone', () => {
    const out = rewriteVectorUrls(
      styleWith({ sat: { type: 'raster', url: 'https://tiles.example.test/sat' } })
    ) as Style;

    expect(out.sources.sat.url).toBe('https://tiles.example.test/sat');
  });

  /** A url already on the protocol must not be rewritten twice. */
  it('leaves a source already on the protocol alone', () => {
    const out = rewriteVectorUrls(
      styleWith({ ofm: { type: 'vector', url: 'cached-vector://tiles.openfreemap.org/planet' } })
    ) as Style;

    expect(out.sources.ofm.url).toBe('cached-vector://tiles.openfreemap.org/planet');
  });

  it('does not mind a style with no sources', () => {
    expect(() => rewriteVectorUrls({} as object)).not.toThrow();
  });
});
