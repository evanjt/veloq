/**
 * Scenario: the WebView request interceptor ships on Android, so a map page can
 * ask for an ordinary URL on its own origin and have Rust answer it from the
 * tile store. Until this, only the satellite rasters were pointed at it and the
 * flag that does the pointing was off, so every basemap still went through the
 * page's own `cached-*` protocols into Cache API buckets Rust cannot see.
 *
 * Expected behaviour: on Android the satellite, ground and vector sources all
 * ask the intercept and hand Rust their upstream template. On iOS they ask the
 * scheme handler the same way, on the custom-scheme origin the page loads on,
 * since `WKURLSchemeHandler` will not claim https. Where neither exists, every
 * one of them keeps the protocol it had.
 */

import { Platform } from 'react-native';

import {
  getCombinedSatelliteStyle,
  rewriteGroundRasterUrls,
  rewriteSatelliteUrls,
  rewriteVectorUrls,
  terrain3DSource,
  TERRAIN_UPSTREAM_TEMPLATE,
} from '@/features/maps/components/mapStyles';
import { LIBERTY_SOURCES, NATURAL_EARTH_ORIGIN } from '@/features/maps/styles/liberty/sources';
import { mapPageBaseUrl, nativeTileUrl } from '@/features/maps/lib/tileTransport';

const mockSetSourceTemplate = jest.fn();
jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    basemapStore: () => ({ setSourceTemplate: mockSetSourceTemplate }),
  })
);

interface Style {
  sources: Record<string, Record<string, unknown>>;
}

const lightStyle = (): Style => ({ sources: JSON.parse(JSON.stringify(LIBERTY_SOURCES)) });

function onPlatform(os: 'android' | 'ios' | 'web') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

beforeEach(() => {
  mockSetSourceTemplate.mockClear();
  onPlatform('android');
});

afterEach(() => onPlatform('ios'));

describe('on Android, where the interceptor ships', () => {
  it('points every satellite raster at the intercept and tells Rust where it comes from', () => {
    const out = rewriteSatelliteUrls(getCombinedSatelliteStyle());

    for (const [key, source] of Object.entries(out.sources)) {
      if (source.type !== 'raster' || !source.tiles) continue;
      expect(source.tiles).toHaveLength(1);
      expect(source.tiles[0]).toMatch(
        new RegExp(`^https://veloq\\.fit/veloq-tile/${key}/\\{z\\}/\\{x\\}/\\{y\\}\\.[a-z0-9]+$`)
      );
    }
    // The extension is the upstream template's own, which is what the store
    // files the bytes under and what the interceptor types them from. A host
    // that carries z/x/y in query parameters names none, so it falls back.
    expect(out.sources['satellite-swisstopo-1'].tiles?.[0].endsWith('.jpeg')).toBe(true);
    // IGN is several sources, one per box of its eastern staircase, and each
    // of them carries the same template and so the same fallback extension.
    expect(out.sources['satellite-ign-1'].tiles?.[0].endsWith('.bin')).toBe(true);
    expect(mockSetSourceTemplate).toHaveBeenCalledWith(
      'satellite-swisstopo-1',
      expect.stringContaining('wmts.geo.admin.ch')
    );
  });

  it('points the shaded-relief ground at the intercept under its own source name', () => {
    const out = rewriteGroundRasterUrls(lightStyle());

    expect(out.sources.ne2_shaded.tiles).toEqual([
      'https://veloq.fit/veloq-tile/ne2_shaded/{z}/{x}/{y}.png',
    ]);
    expect(mockSetSourceTemplate).toHaveBeenCalledWith(
      'ne2_shaded',
      `${NATURAL_EARTH_ORIGIN}/ne2sr/{z}/{x}/{y}.png`
    );
  });

  /**
   * The TileJSON is what Rust is handed, not a tile template: the origin serves
   * tiles from a dated snapshot segment only that document names, and Rust
   * resolves it. So the page states the extension, which a TileJSON url has not
   * got, and a vector tile is always `pbf`.
   */
  it('hands Rust the vector TileJSON and asks for pbf tiles', () => {
    const out = rewriteVectorUrls(lightStyle()) as Style;

    expect(out.sources.openmaptiles.tiles).toEqual([
      'https://veloq.fit/veloq-tile/openmaptiles/{z}/{x}/{y}.pbf',
    ]);
    expect(out.sources.openmaptiles.url).toBeUndefined();
    expect(out.sources.openmaptiles.maxzoom).toBe(14);
    expect(mockSetSourceTemplate).toHaveBeenCalledWith(
      'openmaptiles',
      'https://tiles.openfreemap.org/planet'
    );
  });

  it('leaves a vector source that already names its own tiles alone', () => {
    const tiles = ['https://tiles.example.test/v/{z}/{x}/{y}.pbf'];
    const out = rewriteVectorUrls({ sources: { direct: { type: 'vector', tiles } } }) as Style;

    expect(out.sources.direct.tiles).toEqual(tiles);
    expect(mockSetSourceTemplate).not.toHaveBeenCalled();
  });

  /**
   * The DEM is the one source a 3D open cannot do without: a miss leaves the
   * page reporting terrain unavailable and dropping to 2D, and the Cache API
   * bucket it used to read is one Rust can neither pre-seed nor evict from.
   */
  it('points the terrain DEM at the intercept and tells Rust where it comes from', () => {
    const source = terrain3DSource();

    expect(source.tiles).toEqual(['https://veloq.fit/veloq-tile/terrain/{z}/{x}/{y}.png']);
    expect(source.encoding).toBe('terrarium');
    expect(mockSetSourceTemplate).toHaveBeenCalledWith('terrain', TERRAIN_UPSTREAM_TEMPLATE);
  });

  it('leaves a raster that is not the shaded ground on the network', () => {
    const tiles = ['https://tiles.example.test/r/{z}/{x}/{y}.png'];
    const out = rewriteGroundRasterUrls({ sources: { other: { type: 'raster', tiles } } }) as Style;

    expect(out.sources.other.tiles).toEqual(tiles);
    expect(mockSetSourceTemplate).not.toHaveBeenCalled();
  });
});

describe('on iOS, where the scheme handler answers the page own origin', () => {
  beforeEach(() => onPlatform('ios'));

  it('loads the page on the scheme the handler owns, so a tile is same-origin', () => {
    expect(mapPageBaseUrl()).toBe('veloq-tile://map/');
    expect(nativeTileUrl('terrain', TERRAIN_UPSTREAM_TEMPLATE)).toBe(
      'veloq-tile://map/veloq-tile/terrain/{z}/{x}/{y}.png'
    );
  });

  it('points every satellite raster at the handler', () => {
    const out = rewriteSatelliteUrls(getCombinedSatelliteStyle());

    for (const [key, source] of Object.entries(out.sources)) {
      if (source.type !== 'raster' || !source.tiles) continue;
      expect(source.tiles[0]).toMatch(
        new RegExp(`^veloq-tile://map/veloq-tile/${key}/\\{z\\}/\\{x\\}/\\{y\\}\\.[a-z0-9]+$`)
      );
    }
    expect(mockSetSourceTemplate).toHaveBeenCalledWith(
      'satellite-swisstopo-1',
      expect.stringContaining('wmts.geo.admin.ch')
    );
  });

  it('points the shaded-relief ground and the vector tiles at the handler', () => {
    const out = rewriteVectorUrls(rewriteGroundRasterUrls(lightStyle())) as Style;

    expect(out.sources.ne2_shaded.tiles).toEqual([
      'veloq-tile://map/veloq-tile/ne2_shaded/{z}/{x}/{y}.png',
    ]);
    expect(out.sources.openmaptiles.tiles).toEqual([
      'veloq-tile://map/veloq-tile/openmaptiles/{z}/{x}/{y}.pbf',
    ]);
    expect(out.sources.openmaptiles.url).toBeUndefined();
  });

  it('points the terrain DEM at the handler', () => {
    expect(terrain3DSource().tiles).toEqual([
      'veloq-tile://map/veloq-tile/terrain/{z}/{x}/{y}.png',
    ]);
  });
});

describe('on Android, the page keeps the https origin the interceptor already claims', () => {
  it('loads on the origin the intercept prefix shares', () => {
    expect(mapPageBaseUrl()).toBe('https://veloq.fit/');
  });
});

describe('where nothing can intercept, which is the web', () => {
  beforeEach(() => onPlatform('web'));

  it('keeps the ground on its own protocol', () => {
    const out = rewriteGroundRasterUrls(lightStyle());

    expect(out.sources.ne2_shaded.tiles).toEqual([
      `${NATURAL_EARTH_ORIGIN.replace(/^https:\/\//, 'cached-ground://')}/ne2sr/{z}/{x}/{y}.png`,
    ]);
    expect(mockSetSourceTemplate).not.toHaveBeenCalled();
  });

  it('keeps the vector source on its own protocol, TileJSON and all', () => {
    const out = rewriteVectorUrls(lightStyle()) as Style;

    expect(out.sources.openmaptiles.url).toBe('cached-vector://tiles.openfreemap.org/planet');
    expect(out.sources.openmaptiles.tiles).toBeUndefined();
    expect(mockSetSourceTemplate).not.toHaveBeenCalled();
  });

  it('leaves the terrain DEM on its upstream host, since the page keeps no DEM cache', () => {
    const source = terrain3DSource();

    expect(source.tiles).toEqual([TERRAIN_UPSTREAM_TEMPLATE]);
    expect(mockSetSourceTemplate).not.toHaveBeenCalled();
  });

  it('keeps the satellite rasters on theirs', () => {
    const out = rewriteSatelliteUrls(getCombinedSatelliteStyle());

    expect(out.sources['satellite-swisstopo-1'].tiles?.[0]).toMatch(/^cached-satellite:\/\//);
    expect(mockSetSourceTemplate).not.toHaveBeenCalled();
  });
});
