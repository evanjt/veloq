/**
 * Scenario: the light style paints the `ne2_shaded` raster below z7, which is
 * the whole visible ground at world zoom.
 *
 * Expected behaviour: it is fetched through the cache protocol like every other
 * basemap tile, so a map opened with the radio off still has ground.
 */

import {
  resolveStyleForWebView,
  TERRAIN_STYLE_OPTIONS,
} from '@/features/maps/lib/htmlBuilders/styleResolution';
import { tileProtocolsScript } from '@/features/maps/lib/htmlBuilders/shared';
import { buildMapSurfaceHtml } from '@/features/maps/lib/htmlBuilders';
import {
  TILE_CACHE_NAMES,
  tileCacheBudgets,
  DEFAULT_TILE_CACHE_BUDGET_MB,
  clearTileCachesScript,
  tileCacheStatsScript,
} from '@/features/maps/lib/tileCacheBudget';

const RASTER_ORIGIN = 'https://tiles.openfreemap.org/natural_earth';

describe('the light style ground raster', () => {
  it('is rewritten onto the ground cache protocol', () => {
    const style = JSON.stringify(resolveStyleForWebView('light').inline);
    expect(style).toContain('cached-ground://tiles.openfreemap.org/natural_earth');
    expect(style).not.toContain(RASTER_ORIGIN);
  });

  it('stays on the network for the 3D paths, which register no protocol for it', () => {
    const resolved = resolveStyleForWebView('light', TERRAIN_STYLE_OPTIONS);
    expect(resolved.url).not.toBeNull();
    expect(JSON.stringify(resolved.inline)).not.toContain('cached-ground://');
  });

  it('leaves the dark style alone, which never carried the raster', () => {
    const style = JSON.stringify(resolveStyleForWebView('dark').inline);
    expect(style).not.toContain('cached-ground://');
    expect(style).not.toContain(RASTER_ORIGIN);
  });

  it('keeps satellite rasters on their own protocol', () => {
    const style = JSON.stringify(resolveStyleForWebView('satellite').inline);
    expect(style).not.toContain('cached-ground://');
  });
});

describe('the ground cache', () => {
  it('is registered by the pages that take the rewritten style', () => {
    const script = tileProtocolsScript();
    expect(script).toContain("addProtocol('cached-ground'");
    expect(script).toContain('veloq-ground-v1');
  });

  it('has a budget of its own that leaves the total unchanged', () => {
    expect(TILE_CACHE_NAMES).toContain('veloq-ground-v1');
    const budgets = tileCacheBudgets(DEFAULT_TILE_CACHE_BUDGET_MB);
    expect(budgets['veloq-ground-v1']).toBeGreaterThan(0);
    const sum = TILE_CACHE_NAMES.reduce((n, name) => n + budgets[name], 0);
    expect(sum).toBe(DEFAULT_TILE_CACHE_BUDGET_MB * 1024 * 1024);
  });
});

describe('the injected cache scripts', () => {
  it('clear and measure every cache, not a list that drifts', () => {
    const clear = clearTileCachesScript();
    const stats = tileCacheStatsScript();
    for (const name of TILE_CACHE_NAMES) {
      expect(clear).toContain(`caches.delete('${name}')`);
      expect(stats).toContain(name);
    }
  });

  it('give the ground cache a bucket the storage panel can draw', () => {
    expect(tileCacheStatsScript()).toContain('ground: combined.ground');
  });
});

describe('the built 2D surface', () => {
  const html = buildMapSurfaceHtml({
    style: 'light',
    camera: { center: [0, 0], zoom: 3 },
    interaction: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  it('registers the ground protocol and names no raw raster URL', () => {
    expect(html).toContain("addProtocol('cached-ground'");
    expect(html).toContain('cached-ground://tiles.openfreemap.org/natural_earth');
    expect(html).not.toContain('https://tiles.openfreemap.org/natural_earth');
  });
});
