/**
 * Scenario: the satellite style used to mount a raster source per region and
 * per box, and MapLibre asked every one of them for the viewport's tiles
 * whether or not another covered the same ground.
 *
 * Expected behaviour: the style carries two raster sources and one layer each,
 * and the engine chooses a region's tile per position. The providers handed to
 * the engine keep the style's priority order, each with its own zoom range and
 * boxes.
 */

import { Platform } from 'react-native';

import {
  SATELLITE_SOURCES,
  getCombinedSatelliteStyle,
  regionalSatelliteSourceIds,
  rewriteSatelliteUrls,
  satelliteProviders,
} from '@/features/maps/components/mapStyles';

const mockSetSourceTemplate = jest.fn();
const mockSetCompositeSource = jest.fn();
jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    basemapStore: () => ({
      setSourceTemplate: mockSetSourceTemplate,
      setCompositeSource: mockSetCompositeSource,
      tileListener: () => ({ ports: [41001], token: 'a1b2c3d4' }),
    }),
  })
);

beforeEach(() => {
  mockSetSourceTemplate.mockClear();
  mockSetCompositeSource.mockClear();
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
});

afterEach(() => Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true }));

describe('the satellite style', () => {
  it('draws through one raster layer per composite source', () => {
    const style = getCombinedSatelliteStyle();

    const rasters = style.layers.filter((layer) => layer.type === 'raster');
    expect(rasters.map((layer) => layer.id)).toEqual([
      'satellite-layer-global',
      'satellite-layer-regions',
    ]);
    expect(Object.keys(style.sources)).toEqual(['satellite-global', 'satellite-regions']);
  });

  it('caps the global source at the global imagery and starts the regions source below it', () => {
    const { sources, layers } = getCombinedSatelliteStyle();

    expect(sources['satellite-global'].maxzoom).toBe(SATELLITE_SOURCES.eox.maxzoom);
    expect(sources['satellite-regions'].minzoom).toBe(SATELLITE_SOURCES.eox.maxzoom + 1);
    expect(sources['satellite-regions'].maxzoom).toBe(
      Math.max(...Object.values(SATELLITE_SOURCES).map((s) => s.maxzoom))
    );
    // The tile size is 128, so MapLibre asks for tile zoom = map zoom + 2: the
    // regions layer appears exactly where the global source stops.
    const regions = layers.find((layer) => layer.id === 'satellite-layer-regions');
    expect(regions && 'minzoom' in regions ? regions.minzoom : null).toBe(13);
  });

  it('treats a 404 from the regions source alone as out of coverage', () => {
    expect(regionalSatelliteSourceIds()).toEqual(['satellite-regions']);
  });
});

describe('the providers a composite answers from', () => {
  it('lists the regions topmost first and ends the global composite on the world imagery', () => {
    const names = satelliteProviders('satellite-global').map((p) => p.source);

    expect(names[0]).toBe('satellite-swisstopo');
    expect(names.indexOf('satellite-swisstopo')).toBeLessThan(names.indexOf('satellite-ign'));
    expect(names.indexOf('satellite-ign')).toBeLessThan(names.indexOf('satellite-spain'));
    expect(names.at(-1)).toBe('satellite-eox');
    expect(satelliteProviders('satellite-regions').map((p) => p.source)).toEqual(
      names.slice(0, -1)
    );
  });

  it('gives every provider its own maxzoom, and the world imagery no boxes', () => {
    const providers = satelliteProviders('satellite-global');

    expect(providers.find((p) => p.source === 'satellite-naip')?.maxZoom).toBe(17);
    expect(providers.find((p) => p.source === 'satellite-luxembourg')?.maxZoom).toBe(21);
    const world = providers.at(-1);
    expect(world).toMatchObject({ source: 'satellite-eox', minZoom: 0, maxZoom: 14, boxes: [] });
    for (const provider of providers.slice(0, -1)) {
      expect(provider.boxes.length).toBeGreaterThan(0);
    }
  });

  it('asks the regions composite only for tiles deeper than the global imagery', () => {
    for (const provider of satelliteProviders('satellite-regions')) {
      expect(provider.minZoom).toBeGreaterThan(SATELLITE_SOURCES.eox.maxzoom);
    }
  });

  it('hands the engine every provider template and both composites', () => {
    rewriteSatelliteUrls(getCombinedSatelliteStyle());

    const templated = mockSetSourceTemplate.mock.calls.map(([name]) => name);
    for (const provider of satelliteProviders('satellite-global')) {
      expect(templated).toContain(provider.source);
    }
    const [name, members] = mockSetCompositeSource.mock.calls[0];
    expect(name).toBe('satellite-global');
    expect(members[0]).toMatchObject({ source: 'satellite-swisstopo', minZoom: 10, maxZoom: 20 });
    expect(members[0].boxes[0]).toEqual({
      west: expect.any(Number),
      south: expect.any(Number),
      east: expect.any(Number),
      north: expect.any(Number),
    });
  });
});
