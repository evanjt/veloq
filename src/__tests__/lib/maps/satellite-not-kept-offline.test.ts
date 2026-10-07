/**
 * Scenario: the athlete browses the satellite style, then loses signal.
 *
 * Expected behaviour: no page keeps a satellite raster, so it spends none of
 * the pool the vector basemap needs, and the map falls back to the vector
 * basemap rather than drawing a grey grid.
 */

import {
  TILE_CACHE_NAMES,
  LEGACY_SATELLITE_CACHE,
  dropRetiredTileCachesScript,
} from '@/features/maps/lib/tileCacheBudget';
import { tileProtocolsScript } from '@/features/maps/lib/htmlBuilders/shared';
import { offlineMapStyle } from '@/features/maps/lib/offlineStyleFallback';

describe('the satellite cache', () => {
  it('is not one of the caches the pages keep', () => {
    expect(TILE_CACHE_NAMES).not.toContain(LEGACY_SATELLITE_CACHE);
    expect(TILE_CACHE_NAMES.some((name) => name.includes('satellite'))).toBe(false);
  });

  it('is dropped on any install that still holds one', () => {
    expect(dropRetiredTileCachesScript()).toContain(`caches.delete('${LEGACY_SATELLITE_CACHE}')`);
    expect(tileProtocolsScript()).toContain(`caches.delete('${LEGACY_SATELLITE_CACHE}')`);
  });
});

describe('offlineMapStyle', () => {
  it('sends satellite back to the vector basemap with no radio', () => {
    expect(offlineMapStyle('satellite', false, 'dark')).toBe('dark');
    expect(offlineMapStyle('satellite', false, 'light')).toBe('light');
  });

  it('returns to the chosen style when the connection comes back', () => {
    expect(offlineMapStyle('satellite', true, 'dark')).toBe('satellite');
  });

  it('leaves a vector style alone either way, since it is already offline-capable', () => {
    for (const online of [true, false]) {
      expect(offlineMapStyle('light', online, 'dark')).toBe('light');
      expect(offlineMapStyle('dark', online, 'light')).toBe('dark');
    }
  });

  it('never falls back onto satellite itself', () => {
    expect(offlineMapStyle('satellite', false, 'satellite')).toBe('light');
  });
});
