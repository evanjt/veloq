/**
 * Scenario: on Android the engine serves basemap tiles from a loopback
 * listener on several ports, because the WebView opens at most six connections
 * per host and port and the interceptor would hold a WebView thread per miss.
 *
 * Expected behaviour: on Android the satellite, ground, vector and terrain
 * sources each carry one URL per listener port, every one with the listener's
 * token, and hand Rust their upstream template. On iOS they ask the scheme
 * handler on the custom-scheme origin the page loads on, since
 * `WKURLSchemeHandler` will not claim https. Where Rust cannot be reached, or
 * the listener could not be bound, every one of them keeps its upstream URL.
 */

import { AppState, Platform } from 'react-native';

import {
  getCombinedSatelliteStyle,
  rewriteGroundRasterUrls,
  rewriteSatelliteUrls,
  rewriteVectorUrls,
  terrain3DSource,
  TERRAIN_UPSTREAM_TEMPLATE,
} from '@/features/maps/components/mapStyles';
import { LIBERTY_SOURCES, NATURAL_EARTH_ORIGIN } from '@/features/maps/styles/liberty/sources';
import {
  mapPageBaseUrl,
  nativeTileUrls,
  registerTileListenerResume,
} from '@/features/maps/lib/tileTransport';

const mockSetSourceTemplate = jest.fn();
const LISTENER = { ports: [41001, 41002, 41003, 41004], token: 'a1b2c3d4' };
const mockTileListener = jest.fn<typeof LISTENER | undefined, []>(() => LISTENER);
jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    basemapStore: () => ({
      setSourceTemplate: mockSetSourceTemplate,
      tileListener: mockTileListener,
    }),
  })
);

/** The URLs one source is asked for on Android, one per listener port. */
function shards(source: string, extension: string): string[] {
  return LISTENER.ports.map(
    (port) => `http://127.0.0.1:${port}/${LISTENER.token}/${source}/{z}/{x}/{y}.${extension}`
  );
}

interface Style {
  sources: Record<string, Record<string, unknown>>;
}

const lightStyle = (): Style => ({ sources: JSON.parse(JSON.stringify(LIBERTY_SOURCES)) });

function onPlatform(os: 'android' | 'ios') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

beforeEach(() => {
  mockSetSourceTemplate.mockClear();
  mockTileListener.mockClear();
  onPlatform('android');
});

afterEach(() => onPlatform('ios'));

describe('on Android, where the loopback listener serves the tiles', () => {
  it('points every satellite raster at every listener port and tells Rust where it comes from', () => {
    const out = rewriteSatelliteUrls(getCombinedSatelliteStyle());

    let rewritten = 0;
    for (const [key, source] of Object.entries(out.sources)) {
      if (source.type !== 'raster' || !source.tiles) continue;
      const extension = source.tiles[0].split('.').pop() ?? '';
      expect(source.tiles).toEqual(shards(key, extension));
      rewritten++;
    }
    expect(rewritten).toBeGreaterThan(1);
    // The extension is the upstream template's own, which is what the store
    // files the bytes under and what the listener types them from. A host
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

  it('points the shaded-relief ground at every listener port under its own source name', () => {
    const out = rewriteGroundRasterUrls(lightStyle());

    expect(out.sources.ne2_shaded.tiles).toEqual(shards('ne2_shaded', 'png'));
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

    expect(out.sources.openmaptiles.tiles).toEqual(shards('openmaptiles', 'pbf'));
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
  it('points the terrain DEM at every listener port and tells Rust where it comes from', () => {
    const source = terrain3DSource();

    expect(source.tiles).toEqual(shards('terrain', 'png'));
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
    expect(nativeTileUrls('terrain', TERRAIN_UPSTREAM_TEMPLATE)).toEqual([
      'veloq-tile://map/veloq-tile/terrain/{z}/{x}/{y}.png',
    ]);
    expect(mockTileListener).not.toHaveBeenCalled();
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
  it('loads on the origin the listener admits', () => {
    expect(mapPageBaseUrl()).toBe('https://veloq.fit/');
  });
});

describe('on Android, where the listener could not be bound', () => {
  beforeEach(() => mockTileListener.mockReturnValue(undefined));
  afterEach(() => mockTileListener.mockImplementation(() => LISTENER));

  it('keeps every source on its upstream URL and hands Rust nothing', () => {
    const out = rewriteVectorUrls(rewriteGroundRasterUrls(lightStyle())) as Style;

    expect(out.sources.ne2_shaded.tiles).toEqual([`${NATURAL_EARTH_ORIGIN}/ne2sr/{z}/{x}/{y}.png`]);
    expect(out.sources.openmaptiles.url).toBe('https://tiles.openfreemap.org/planet');
    expect(terrain3DSource().tiles).toEqual([TERRAIN_UPSTREAM_TEMPLATE]);
    expect(mockSetSourceTemplate).not.toHaveBeenCalled();
  });
});

describe('where the store cannot be reached, which is the test bench', () => {
  beforeEach(() => {
    mockSetSourceTemplate.mockImplementation(() => {
      throw new Error('no store');
    });
  });
  afterEach(() => mockSetSourceTemplate.mockReset());

  it('keeps the ground on its upstream URL', () => {
    const out = rewriteGroundRasterUrls(lightStyle());

    expect(out.sources.ne2_shaded.tiles).toEqual([`${NATURAL_EARTH_ORIGIN}/ne2sr/{z}/{x}/{y}.png`]);
  });

  it('keeps the vector source on its TileJSON URL', () => {
    const out = rewriteVectorUrls(lightStyle()) as Style;

    expect(out.sources.openmaptiles.url).toBe('https://tiles.openfreemap.org/planet');
  });

  it('keeps the terrain DEM on its upstream host', () => {
    expect(terrain3DSource().tiles).toEqual([TERRAIN_UPSTREAM_TEMPLATE]);
  });

  it('keeps the satellite rasters on theirs', () => {
    const out = rewriteSatelliteUrls(getCombinedSatelliteStyle());

    expect(out.sources['satellite-swisstopo-1'].tiles?.[0]).toMatch(/^https:\/\//);
  });
});

/**
 * A long stay in the background can take the listener's sockets while a map
 * page already holds their URLs, so the engine has to probe and bind again
 * before the page's next tile.
 */
describe('a return to the foreground', () => {
  let changes: ((state: string) => void)[];
  beforeEach(() => {
    changes = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
      changes.push(handler as (state: string) => void);
      return { remove: jest.fn() };
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('asks the engine for its listener on Android, which probes and binds again', () => {
    const off = registerTileListenerResume();
    changes.forEach((change) => change('background'));
    expect(mockTileListener).not.toHaveBeenCalled();

    changes.forEach((change) => change('active'));
    expect(mockTileListener).toHaveBeenCalledTimes(1);
    off();
  });

  it('registers nothing on iOS, which has no listener', () => {
    onPlatform('ios');
    registerTileListenerResume();
    expect(changes).toHaveLength(0);
  });
});
