/**
 * Scenario: every satellite source serves 256-pixel tiles.
 * Expected behaviour: each declares the one shared tile size, which asks for
 * a quarter of the tiles a 64 declaration does, and the combined style
 * carries it through to every raster source.
 */

import {
  SATELLITE_SOURCES,
  SATELLITE_TILE_SIZE,
  getCombinedSatelliteStyle,
} from '@/features/maps/components/mapStyles';

describe('satellite tile size', () => {
  it('declares 128 for the 2x oversample', () => {
    expect(SATELLITE_TILE_SIZE).toBe(128);
  });

  it('has every satellite source read the shared constant', () => {
    for (const source of Object.values(SATELLITE_SOURCES)) {
      expect(source.tileSize).toBe(SATELLITE_TILE_SIZE);
    }
  });

  it('carries the constant into every source of the combined style', () => {
    const sources = Object.values(getCombinedSatelliteStyle().sources);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source.tileSize).toBe(SATELLITE_TILE_SIZE);
    }
  });
});
