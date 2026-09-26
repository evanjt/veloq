/**
 * Scenario: the athlete browses the satellite style, then loses signal.
 *
 * Expected behaviour: no satellite raster was ever kept, so it spent none of
 * the pool the vector basemap needs, and the map falls back to the vector
 * basemap rather than drawing a grey grid.
 */

import {
  TILE_CACHE_NAMES,
  LEGACY_SATELLITE_CACHE,
  tileCacheBudgets,
  DEFAULT_TILE_CACHE_BUDGET_MB,
} from '@/features/maps/lib/tileCacheBudget';
import { tileProtocolsScript } from '@/features/maps/lib/htmlBuilders/shared';
import { offlineMapStyle } from '@/features/maps/lib/offlineStyleFallback';

const MB = 1024 * 1024;

describe('the satellite cache', () => {
  it('is not one of the caches the pages keep', () => {
    expect(TILE_CACHE_NAMES).not.toContain(LEGACY_SATELLITE_CACHE);
    expect(TILE_CACHE_NAMES.some((name) => name.includes('satellite'))).toBe(false);
  });

  it('carries no share of the budget, which the others still spend in full', () => {
    const budgets = tileCacheBudgets(DEFAULT_TILE_CACHE_BUDGET_MB);
    expect(budgets).not.toHaveProperty(LEGACY_SATELLITE_CACHE);
    const sum = TILE_CACHE_NAMES.reduce((n, name) => n + budgets[name], 0);
    expect(sum).toBe(DEFAULT_TILE_CACHE_BUDGET_MB * MB);
  });

  it('is dropped on any install that still holds one', () => {
    expect(tileProtocolsScript()).toContain(`caches.delete('${LEGACY_SATELLITE_CACHE}')`);
  });
});

describe('the satellite protocol', () => {
  const handler = () => {
    const script = tileProtocolsScript();
    const start = script.indexOf("addProtocol('cached-satellite'");
    const end = script.indexOf('addProtocol(', start + 1);
    return script.slice(start, end);
  };

  it('fetches through without keeping the bytes', () => {
    expect(handler()).not.toContain('cache.put');
    expect(handler()).not.toContain('caches.open');
  });

  it('still counts its hits and misses, which the page logs', () => {
    expect(tileProtocolsScript()).toContain('satMisses');
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
