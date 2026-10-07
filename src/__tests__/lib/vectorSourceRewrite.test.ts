/**
 * Scenario: a style names a vector source. The rewrite matched one literal
 * url, `https://tiles.openfreemap.org/planet`, so a style pointed at any other
 * vector host went through uncached with nothing saying so.
 *
 * Expected behaviour: every vector source with a TileJSON url is handed to the
 * tile store, whichever host serves it, and a source that already names its
 * tiles is left alone.
 */

import { rewriteVectorUrls } from '@/features/maps/components/mapStyles';

const mockSetSourceTemplate = jest.fn();
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    basemapStore: () => ({ setSourceTemplate: mockSetSourceTemplate }),
  })
);

interface Style {
  sources: Record<string, Record<string, unknown>>;
}

function styleWith(sources: Style['sources']): Style {
  return { sources };
}

beforeEach(() => mockSetSourceTemplate.mockClear());

describe('the vector source rewrite', () => {
  it('rewrites the openfreemap planet source', () => {
    const out = rewriteVectorUrls(
      styleWith({ ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } })
    ) as Style;

    expect(out.sources.ofm.tiles).toEqual(['veloq-tile://map/veloq-tile/ofm/{z}/{x}/{y}.pbf']);
    expect(out.sources.ofm.url).toBeUndefined();
    expect(out.sources.ofm.maxzoom).toBe(14);
    expect(mockSetSourceTemplate).toHaveBeenCalledWith(
      'ofm',
      'https://tiles.openfreemap.org/planet'
    );
  });

  it('rewrites a vector source on any other host', () => {
    const out = rewriteVectorUrls(
      styleWith({ other: { type: 'vector', url: 'https://tiles.example.test/planet' } })
    ) as Style;

    expect(out.sources.other.tiles).toEqual(['veloq-tile://map/veloq-tile/other/{z}/{x}/{y}.pbf']);
    expect(mockSetSourceTemplate).toHaveBeenCalledWith(
      'other',
      'https://tiles.example.test/planet'
    );
  });

  /** A source that already names its tiles has no TileJSON to resolve. */
  it('leaves a source that names its own tiles alone', () => {
    const tiles = ['https://tiles.example.test/v/{z}/{x}/{y}.pbf'];
    const out = rewriteVectorUrls(styleWith({ direct: { type: 'vector', tiles } })) as Style;

    expect(out.sources.direct.tiles).toEqual(tiles);
    expect(out.sources.direct.url).toBeUndefined();
    expect(mockSetSourceTemplate).not.toHaveBeenCalled();
  });

  it('leaves a raster source alone', () => {
    const out = rewriteVectorUrls(
      styleWith({ sat: { type: 'raster', url: 'https://tiles.example.test/sat' } })
    ) as Style;

    expect(out.sources.sat.url).toBe('https://tiles.example.test/sat');
  });

  it('does not mind a style with no sources', () => {
    expect(() => rewriteVectorUrls({} as object)).not.toThrow();
  });
});
