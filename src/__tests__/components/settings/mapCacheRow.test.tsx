/**
 * Scenario: the cache screen read `Map tiles 14.7 MB` with the legend under the
 * bar reading `3D previews 14.7 MB`. The same number under two names, because
 * the row sums three stores and on a real device two of them are zero.
 *
 * Expected behaviour: the row is named for everything it holds, and a store
 * that has not answered is unknown rather than a zero folded into the sum.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { StorageStatsPanel } from '@/features/settings/components/StorageStatsPanel';
import { mapCacheTotal, MAP_CACHE_SOURCES } from '@/features/settings/lib/mapCacheTotal';

describe('the map cache total', () => {
  it('sums every store when all three have answered', () => {
    const total = mapCacheTotal({
      terrainBytes: 3,
      heatmapBytes: 5,
      tileStats: { tileCount: 2, totalBytes: 7 },
    });
    expect(total).toEqual({ bytes: 15, complete: true });
  });

  it('reports a store that never answered as incomplete, not as zero', () => {
    const total = mapCacheTotal({ terrainBytes: 3, heatmapBytes: 5, tileStats: null });
    expect(total).toEqual({ bytes: 8, complete: false });
  });

  it('treats a real zero from a store that answered as a zero', () => {
    const total = mapCacheTotal({
      terrainBytes: 14,
      heatmapBytes: 0,
      tileStats: { tileCount: 0, totalBytes: 0 },
    });
    expect(total).toEqual({ bytes: 14, complete: true });
  });

  it('names every store the row folds in, so the label can be checked against it', () => {
    expect(MAP_CACHE_SOURCES).toEqual(['previews', 'heatmap', 'tiles']);
  });
});

/**
 * The row and the legend on the same render, which is what made `Map tiles
 * 14.7 MB` and `3D previews 14.7 MB` read as one number twice.
 */

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars && typeof vars.size === 'string' ? `${key}:${vars.size}` : key,
  }),
}));

jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

jest.mock('@/features/maps/lib/storage/tileCacheSettings', () => ({
  useTileCacheSettings: (pick: (s: { budgetMb: number; setBudgetMb: () => void }) => unknown) =>
    pick({ budgetMb: 200, setBudgetMb: jest.fn() }),
}));

jest.mock('@/features/settings/components/StreamHistoryRow', () => ({
  StreamHistoryRow: () => null,
}));

const baseProps = {
  isDark: false,
  totalActivities: 10,
  routeGroupCount: 2,
  totalSections: 3,
  routeMatchingEnabled: true,
  dateRangeText: 'range',
  lastSync: null,
  totalQueries: 1,
  databaseSize: 100,
  onClearMapCache: jest.fn(),
  routesSize: 100,
  freeStorage: 1000,
};

function renderPanel(over: Partial<React.ComponentProps<typeof StorageStatsPanel>>) {
  return render(<StorageStatsPanel {...baseProps} {...(over as never)} />);
}

describe('the map cache row against its legend', () => {
  it('names a store holding only previews for what it holds, not for tiles', () => {
    const { getByTestId } = renderPanel({
      terrainCacheSize: 15_400_000,
      heatmapCacheSize: 0,
      tileCacheStats: { tileCount: 0, totalBytes: 0 },
    });
    expect(getByTestId('settings-map-cache-label').props.children).toBe('settings.mapCache');
  });

  it('marks the total as a floor while a store has not answered', () => {
    const { getByTestId } = renderPanel({
      terrainCacheSize: 15_400_000,
      heatmapCacheSize: 0,
      tileCacheStats: null,
    });
    expect(getByTestId('settings-map-cache-value').props.children).toBe(
      'settings.sizeAtLeast:14.7 MB'
    );
  });

  it('prints a plain size once every store has answered', () => {
    const { getByTestId } = renderPanel({
      terrainCacheSize: 15_400_000,
      heatmapCacheSize: 0,
      tileCacheStats: { tileCount: 0, totalBytes: 0 },
    });
    expect(getByTestId('settings-map-cache-value').props.children).toBe('14.7 MB');
  });

  it('keeps the row and the legend from being the same number twice', () => {
    const { getByTestId } = renderPanel({
      terrainCacheSize: 4_000_000,
      heatmapCacheSize: 2_000_000,
      tileCacheStats: { tileCount: 9, totalBytes: 6_000_000 },
    });
    expect(getByTestId('settings-map-cache-value').props.children).toBe('11.4 MB');
    expect(getByTestId('settings-map-cache-label').props.children).not.toBe(
      'settings.storagePreviews'
    );
  });
});
